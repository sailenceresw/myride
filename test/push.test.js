const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/store');
const { createApp } = require('../src/app');
const { createPush, notificationFor } = require('../src/push');
const { estimateRoute } = require('../src/geo');

const TOKEN = 'ExponentPushToken[abc123]';
const trip = (status, extra = {}) => ({ id: 'trp_1', status, fare: 120, pin: '4321', riderName: 'Sita', pickup: { label: 'Lakeside' }, drop: { label: 'Mahendrapul' }, driver: { name: 'Ram', vehicle: { plate: 'GA 1 PA 4000' } }, ...extra });
const tick = () => new Promise((r) => setImmediate(r));

function setup(reply = { data: [{ status: 'ok' }] }) {
  const store = new Store(null);
  const sent = [];
  const fetchImpl = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { json: async () => reply }; };
  const push = createPush({ store, fetchImpl, log: () => {} });
  const user = store.put('users', { id: 'usr_1', phone: '9800000001', roles: ['driver'] });
  return { store, push, user, sent };
}

test('notifications map to the right portal and screen', () => {
  assert.deepEqual(notificationFor({ type: 'trip', role: 'rider', trip: trip('arrived') }), { portal: 'rider', title: 'Your driver has arrived', body: 'Meet at Lakeside. Your PIN is 4321', url: '/rider' });
  assert.equal(notificationFor({ type: 'offer', trip: { ...trip('searching'), pickupKm: 1.2 } }).url, '/driver');
  assert.equal(notificationFor({ type: 'face_check', status: 'required' }).url, '/driver/selfie');
  assert.equal(notificationFor({ type: 'trip', role: 'rider', trip: trip('in_progress') }), undefined); // rider is in the car
  assert.equal(notificationFor({ type: 'sos' }), null);
});

test('only valid Expo tokens register, per portal, newest five kept', () => {
  const { push, user } = setup();
  assert.equal(push.register(user, 'not-a-token', 'rider'), false);
  for (let i = 0; i < 7; i++) push.register(user, `ExpoPushToken[t${i}]`, 'rider');
  push.register(user, 'ExpoPushToken[t6]', 'driver'); // same device re-registers → moves, no duplicate
  assert.equal(user.pushTokens.length, 5);
  assert.deepEqual(user.pushTokens.at(-1), { token: 'ExpoPushToken[t6]', portal: 'driver', at: user.pushTokens.at(-1).at });
});

test('a status is pushed once even though trip events repeat on every GPS update', async () => {
  const { push, user, sent } = setup();
  push.register(user, TOKEN, 'rider');
  for (const s of ['accepted', 'accepted', 'accepted', 'arrived', 'in_progress', 'completed', 'completed']) push.deliver(user.id, { type: 'trip', role: 'rider', trip: trip(s) });
  await tick();
  assert.deepEqual(sent.map((m) => m[0].title), ['Driver on the way', 'Your driver has arrived', 'You have arrived']);
  assert.equal(sent[0][0].to, TOKEN);
  assert.equal(sent[0][0].channelId, 'trips');
});

test('the rider app token never receives driver offers', async () => {
  const { push, user, sent } = setup();
  push.register(user, TOKEN, 'rider');
  push.deliver(user.id, { type: 'offer', trip: { ...trip('searching'), pickupKm: 1 } });
  await tick();
  assert.equal(sent.length, 0);
});

test('uninstalled devices are forgotten', async () => {
  const { push, user } = setup({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] });
  push.register(user, TOKEN, 'driver');
  push.deliver(user.id, { type: 'face_check', status: 'required' });
  await tick(); await tick();
  assert.deepEqual(user.pushTokens, []);
});

test('API: register token; offers push only while the app has no live event stream', async () => {
  const store = new Store(null);
  const sent = [];
  const { app, svc, bus } = createApp({ store, routeFn: async (a, b) => estimateRoute(a, b), sms: async () => ({ ok: true, provider: 'console' }), pushFetch: async (u, o) => { sent.push(JSON.parse(o.body)); return { json: async () => ({ data: [] }) }; }, dev: true });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    const otp = await (await post('/api/auth/otp', { phone: '9811111111' })).json();
    const { token, user } = await (await post('/api/auth/verify', { phone: '9811111111', otp: otp.devOtp, name: 'Hari', portal: 'driver' })).json();
    assert.equal((await post('/api/push/token', { token: 'bad' }, token)).status, 400);
    assert.equal((await post('/api/push/token', { token: TOKEN }, token)).status, 200);
    assert.equal(store.get('users', user.id).pushTokens[0].portal, 'driver');

    const ctl = new AbortController();
    const stream = await fetch(`${base}/api/events?token=${token}`, { signal: ctl.signal });
    await stream.body.getReader().read(); // ": connected"
    bus.emit(user.id, { type: 'face_check', status: 'required' });
    await tick();
    assert.equal(sent.length, 0, 'live app gets SSE, not a push');

    ctl.abort();
    await new Promise((r) => setTimeout(r, 50));
    bus.emit(user.id, { type: 'face_check', status: 'required' });
    await tick();
    assert.equal(sent.length, 1);
    assert.equal(svc.profile(store.get('users', user.id)).pushTokens, undefined, 'tokens are not exposed in the profile');
  } finally { server.close(); }
});
