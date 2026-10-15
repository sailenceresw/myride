// A customer applies to become a rider from the customer app (photos only, no face data), ops approves, and the
// same number signs in to MyRide Drive, where the first live selfie check enrols the face.
process.env.OTP_IP_LIMIT = '1000';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/store');
const { createApp } = require('../src/app');
const { estimateRoute } = require('../src/geo');

const JPG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]).toString('base64')}`;
const desc = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 31 + i) * 0.1);

test('apply from the customer app, approve, then drive with MyRide Drive', async () => {
  let clock = Date.parse('2026-10-15T04:00:00Z');
  const sms = [];
  const { app } = createApp({ store: new Store(null), routeFn: async (a, b) => estimateRoute(a, b), now: () => clock, rand: () => 0.99, sms: async (phone, text) => { sms.push({ phone, text }); return { ok: true, provider: 'console' }; }, dev: true });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  const api = async (method, path, body, token) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const login = async (phone, name, portal) => {
    clock += 61000;
    const { devOtp } = (await api('POST', '/api/auth/otp', { phone })).body;
    return (await api('POST', '/api/auth/verify', { phone, otp: devOtp, name, portal })).body.token;
  };
  try {
    const customer = await login('9861234567', 'Kiran Adhikari', 'rider');
    assert.equal((await api('PUT', '/api/driver/application', {
      driverType: 'partner',
      personal: { fullName: 'Kiran Adhikari', dob: '1995-02-10', gender: 'male', address: 'Pokhara-17, Birauta', citizenshipNo: '45-01-70-33333', citizenshipDistrict: 'Kaski' },
      licence: { number: '04-06-33445566', categories: ['A'], expiry: '2031-01-01' },
      vehicle: { type: 'bike', fuel: 'petrol', plate: 'GA 1 PA 7001', model: 'Honda Shine', bluebookNo: 'BB-70', insuranceExpiry: '2027-08-01' },
      bank: { bank: 'Nabil Bank', branch: 'Lakeside', accountName: 'Kiran Adhikari', accountNumber: '01234567890777' },
      consent: true,
    }, customer)).status, 200, 'the customer app session can apply');
    for (const kind of ['citizenshipFront', 'citizenshipBack', 'licence', 'policeReport', 'selfie', 'bluebook', 'insurance']) {
      assert.equal((await api('POST', '/api/driver/application/documents', { kind, data: JPG }, customer)).status, 200);
    }
    const sub = await api('POST', '/api/driver/application/submit', {}, customer);
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal(sub.body.status, 'submitted', 'photo-only applications wait for a human reviewer');
    assert.equal(sub.body.checks.find((c) => c.check === 'selfie_vs_id_photo').ok, false);
    assert.equal((await api('GET', '/api/profile', null, customer)).body.driverApplication.status, 'submitted');

    const admin = await login('9800000000', 'Ops', 'admin');
    assert.equal((await api('POST', `/api/admin/applications/${sub.body.id}/review`, { decision: 'approve' }, admin)).status, 200);
    assert.match(sms.at(-1).text, /Install MyRide Drive/);
    assert.equal((await api('GET', '/api/profile', null, customer)).body.isDriver, true);

    // Same number in MyRide Drive: the first live selfie enrols the face, later ones must match it.
    const rider = await login('9861234567', '', 'driver');
    const first = await api('POST', '/api/driver/face-check', { descriptor: desc(4), photo: JPG }, rider);
    assert.equal(first.body.passed, true);
    assert.equal((await api('POST', '/api/driver/face-check', { descriptor: desc(9) }, rider)).body.passed, false, 'a different face is rejected');
    assert.equal((await api('POST', '/api/driver/face-check', { descriptor: desc(4).map((x) => x + 0.005) }, rider)).body.passed, true);
  } finally { server.close(); }
});
