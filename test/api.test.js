// End-to-end API tests: real HTTP server, in-memory store, deterministic routing, clock and randomness.
process.env.OTP_IP_LIMIT = '1000'; // all test logins come from 127.0.0.1
const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/store');
const { createApp } = require('../src/app');
const { estimateRoute, places, navigationRoute } = require('../src/geo');
const { esewaSign } = require('../src/payments');
const { LOGISTICS } = require('../src/config');

const P = (id) => { const p = places.find((x) => x.id === id); return { lat: p.lat, lng: p.lng, label: p.name }; };
const KTM = LOGISTICS.destinations.find((d) => d.id === 'kathmandu');
const JPG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]).toString('base64')}`;
const desc = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 31 + i) * 0.1);
const near = (d, eps = 0.01) => d.map((x, i) => x + (i % 2 ? eps : -eps));

let base, server, svc, store;
let clock = Date.parse('2026-10-14T04:00:00Z');
let randValue = 0.99; // > 0.3 → no random selfie unless a test lowers it
const smsSent = [];
const smsStub = async (phone, text) => { smsSent.push({ phone, text }); return { ok: true, provider: 'console' }; }; // dev: code echoed back
const api = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
};
const login = async (phone, name, portal = 'rider', extra = {}) => {
  clock += 61000; // OTP resend cooldown
  const otp = (await api('POST', '/api/auth/otp', { phone })).body.devOtp;
  const r = await api('POST', '/api/auth/verify', { phone, otp, name, portal, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};

// Walk a driver through the Drive portal KYC and return the approved driver.
async function onboard(token, app, adminToken, review = {}) {
  assert.equal((await api('PUT', '/api/driver/application', app, token)).status, 200);
  const docs = app.driverType === 'partner' ? ['citizenshipFront', 'citizenshipBack', 'licence', 'policeReport', 'selfie', 'bluebook', 'insurance'] : ['citizenshipFront', 'citizenshipBack', 'licence', 'policeReport', 'selfie'];
  for (const kind of docs) assert.equal((await api('POST', '/api/driver/application/documents', { kind, data: JPG }, token)).status, 200);
  const sub = await api('POST', '/api/driver/application/submit', {}, token);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const apps = (await api('GET', '/api/admin/applications', null, adminToken)).body;
  const mine = apps.find((a) => a.id === sub.body.id);
  const rv = await api('POST', `/api/admin/applications/${mine.id}/review`, { decision: 'approve', ...review }, adminToken);
  assert.equal(rv.status, 200, JSON.stringify(rv.body));
  return (await api('GET', '/api/driver/dashboard', null, token)).body.driver;
}
const person = (fullName, o = {}) => ({ fullName, dob: '1992-03-15', gender: 'male', address: 'Pokhara-8, Srijana Chowk', citizenshipNo: '45-01-70-11111', citizenshipDistrict: 'Kaski', ...o });
const bankOf = (name) => ({ bank: 'Nabil Bank', branch: 'Lakeside', accountName: name, accountNumber: '01234567890123' });
const face = (seed) => ({ selfieDescriptor: desc(seed), idDescriptor: near(desc(seed), 0.02), liveness: { passed: true } });

let admin, rider, bikeDrv, bikeDrvRecord;

test.before(async () => {
  store = new Store(null);
  const made = createApp({ store, routeFn: async (a, b) => estimateRoute(a, b), navRouteFn: (a, b) => navigationRoute(a, b, { fetchImpl: null }), now: () => clock, rand: () => randValue, sms: smsStub, dev: true });
  svc = made.svc;
  server = made.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('9800000000', 'Ops Admin', 'admin');
  rider = await login('9846000001', 'Aarati Rider');
  bikeDrv = await login('9856000002', 'Ram', 'driver');
});
test.after(() => server.close());

test('auth: invalid numbers, wrong OTP, non-admin cannot open the ops portal', async () => {
  assert.equal((await api('POST', '/api/auth/otp', { phone: '12345' })).status, 400);
  await api('POST', '/api/auth/otp', { phone: '9811111111' });
  assert.equal((await api('POST', '/api/auth/verify', { phone: '9811111111', otp: '000000' })).status, 400);
  const otp = (await api('POST', '/api/auth/otp', { phone: '9811111112' })).body.devOtp;
  assert.equal((await api('POST', '/api/auth/verify', { phone: '9811111112', otp, portal: 'admin' })).status, 403);
});

test('portals are separate: rider token cannot use Drive endpoints, driver token cannot book or open ops', async () => {
  const r1 = await api('GET', '/api/driver/dashboard', null, rider.token);
  assert.equal(r1.status, 403);
  assert.match(r1.body.error, /MyRide Drive app/);
  assert.equal((await api('GET', '/api/driver/application', null, rider.token)).status, 200, 'customers can apply to become a rider');
  assert.equal((await api('POST', '/api/trips', { service: 'bike', pickup: P('lakeside'), drop: P('damside') }, bikeDrv.token)).status, 403);
  assert.equal((await api('GET', '/api/admin/stats', null, bikeDrv.token)).status, 403);
  assert.equal((await api('GET', '/api/admin/stats', null, rider.token)).status, 403);
  assert.equal((await api('GET', '/api/admin/stats', null, admin.token)).status, 200);
});

test('a driver cannot go online before KYC approval', async () => {
  const r = await api('POST', '/api/driver/online', { online: true, loc: P('hallan-chowk') }, bikeDrv.token);
  assert.equal(r.status, 403);
  assert.match(r.body.error, /not approved/);
});

test('KYC: incomplete application is rejected with reasons; complete one is approved by ops', async () => {
  await api('PUT', '/api/driver/application', { driverType: 'partner', personal: person('Ram') }, bikeDrv.token);
  const bad = await api('POST', '/api/driver/application/submit', {}, bikeDrv.token);
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors.length > 3);
  assert.equal((await api('POST', '/api/driver/application/documents', { kind: 'licence', data: 'data:image/jpeg;base64,AAAA' }, bikeDrv.token)).status, 400, 'magic bytes checked');
  bikeDrvRecord = await onboard(bikeDrv.token, {
    driverType: 'partner', personal: person('Ram Bahadur Gurung'), licence: { number: '04-06-12345678', categories: ['A'], expiry: '2031-01-01' },
    vehicle: { type: 'bike', fuel: 'petrol', plate: 'GA 1 PA 4455', model: 'Honda Shine', bluebookNo: 'BB-1', insuranceExpiry: '2027-08-01' },
    bank: bankOf('Ram Bahadur Gurung'), face: face(1), consent: true,
  }, admin.token);
  assert.equal(bikeDrvRecord.driverType, 'partner');
  assert.equal(bikeDrvRecord.name, 'Ram Bahadur Gurung', 'legal name from KYC');
  assert.equal(bikeDrvRecord.faceDescriptor, undefined, 'biometrics never sent back to clients');
  const files = store.all('files');
  const f = files.find((x) => x.kind === 'kyc_licence');
  assert.equal((await api('GET', `/api/files/${f.id}`, null, rider.token)).status, 403, 'documents are private');
  assert.equal((await api('GET', `/api/files/${f.id}`, null, admin.token)).status, 200);
});

test('Real-Time ID check: random selfie required at go-online; matching selfie unlocks it', async () => {
  randValue = 0.1;
  const r = await api('POST', '/api/driver/online', { online: true, loc: P('hallan-chowk') }, bikeDrv.token);
  assert.equal(r.status, 428);
  assert.equal(r.body.faceCheck.pending, true);
  const ok = await api('POST', '/api/driver/face-check', { descriptor: near(desc(1)), photo: JPG }, bikeDrv.token);
  assert.equal(ok.body.passed, true);
  randValue = 0.99;
  assert.equal((await api('POST', '/api/driver/online', { online: true, loc: P('hallan-chowk') }, bikeDrv.token)).body.online, true);
});

test('quote shows ward labels; pickups outside Pokhara and rides beyond 20 km are refused', async () => {
  const q = await api('POST', '/api/quote', { pickup: P('talchowk'), drop: P('lakeside') }, rider.token);
  assert.equal(q.status, 200);
  assert.equal(q.body.pickupWard, 'Pokhara-27, Tal Chowk');
  assert.equal(q.body.dropWard, 'Pokhara-6, Baidam (Lakeside)');
  assert.equal((await api('POST', '/api/quote', { pickup: P('rupa-lake'), drop: P('lakeside') })).status, 422);
  assert.equal((await api('POST', '/api/quote', { pickup: P('lakeside'), drop: P('rupa-lake') })).status, 200, 'drop inside 20 km is fine');
  assert.equal((await api('POST', '/api/quote', { pickup: P('lakeside'), drop: KTM })).status, 422);
  const lg = await api('POST', '/api/quote', { pickup: P('lakeside'), drop: KTM, kind: 'logistics', parcel: { weightKg: 1000 } });
  assert.equal(lg.status, 200);
  assert.ok(lg.body.quotes.find((x) => x.service === 'truck').intercity);
});

test('first ride is free (up to Rs 100) while the driver is paid in full; PIN required; share link hides phones', async () => {
  const profile = (await api('GET', '/api/profile', null, rider.token)).body;
  assert.equal(profile.firstRideFree, true);
  assert.match(profile.referral.code, /^MR[A-Z2-9]{6}$/);
  const t = (await api('POST', '/api/trips', { service: 'bike', pickup: P('lakeside'), drop: P('prithvi-chowk'), payment: 'cash' }, rider.token)).body;
  assert.equal(t.fare, 0);
  assert.equal(t.quote.discounts[0].kind, 'free_ride');
  assert.equal((await api('POST', '/api/trips', { service: 'bike', pickup: P('lakeside'), drop: P('damside') }, rider.token)).status, 409);
  const offers = (await api('GET', '/api/driver/offers', null, bikeDrv.token)).body;
  assert.equal(offers.length, 1);
  assert.equal(offers[0].riderPhone, undefined);
  await api('POST', `/api/trips/${t.id}/accept`, {}, bikeDrv.token);
  await api('POST', `/api/trips/${t.id}/arrived`, {}, bikeDrv.token);
  assert.equal((await api('POST', `/api/trips/${t.id}/start`, { pin: t.pin === '1111' ? '2222' : '1111' }, bikeDrv.token)).status, 400);
  await api('POST', `/api/trips/${t.id}/start`, { pin: t.pin }, bikeDrv.token);
  const share = await api('GET', `/api/share/${t.shareToken}`);
  assert.equal(JSON.stringify(share.body).includes('9846000001'), false);
  await api('POST', `/api/trips/${t.id}/complete`, {}, bikeDrv.token);
  const final = (await api('GET', `/api/trips/${t.id}`, null, rider.token)).body;
  assert.equal(final.fare, 0);
  const dash = (await api('GET', '/api/driver/dashboard', null, bikeDrv.token)).body;
  assert.ok(Math.abs(dash.driver.wallet - final.quote.split.driver) < 0.02, 'platform owes the driver the whole earning');
  assert.equal((await api('GET', '/api/profile', null, rider.token)).body.firstRideFree, false);
});

test('chat: customer and rider can message only while the trip is on; others cannot read it', async () => {
  const t = (await api('POST', '/api/trips', { service: 'bike', pickup: P('lakeside'), drop: P('damside'), payment: 'cash' }, rider.token)).body;
  assert.equal((await api('POST', `/api/trips/${t.id}/messages`, { text: 'hello?' }, rider.token)).status, 409, 'no rider yet');
  await api('POST', `/api/trips/${t.id}/accept`, {}, bikeDrv.token);
  const sent = await api('POST', `/api/trips/${t.id}/messages`, { text: "  I'm at the blue gate  " }, rider.token);
  assert.equal(sent.status, 200);
  assert.deepEqual([sent.body.from, sent.body.text], ['rider', "I'm at the blue gate"]);
  assert.equal((await api('POST', `/api/trips/${t.id}/messages`, { text: 'Coming in 2 min' }, bikeDrv.token)).status, 200);
  assert.equal((await api('POST', `/api/trips/${t.id}/messages`, { text: '   ' }, rider.token)).status, 400);
  const outsider = await login('9846000099', 'Someone Else');
  assert.equal((await api('GET', `/api/trips/${t.id}/messages`, null, outsider.token)).status, 403);
  const thread = (await api('GET', `/api/trips/${t.id}/messages`, null, bikeDrv.token)).body;
  assert.deepEqual(thread.map((m) => m.from), ['rider', 'driver']);
  await api('POST', `/api/trips/${t.id}/arrived`, {}, bikeDrv.token);
  await api('POST', `/api/trips/${t.id}/start`, { pin: t.pin }, bikeDrv.token);
  await api('POST', `/api/trips/${t.id}/complete`, {}, bikeDrv.token);
  assert.equal((await api('POST', `/api/trips/${t.id}/messages`, { text: 'thanks!' }, rider.token)).status, 409, 'chat closes with the trip');
  assert.equal((await api('GET', `/api/trips/${t.id}/messages`, null, rider.token)).body.length, 2, 'history stays readable');
});

test('MyRide Plus: sandbox checkout activates membership; 5% (max Rs 25) applied; free cancellation after driver waits', async () => {
  const pay = await api('POST', '/api/membership/checkout', { plan: 'plus_yearly', payment: 'esewa' }, rider.token);
  assert.equal(pay.body.provider, 'esewa');
  assert.equal(pay.body.fields.total_amount, '1999.99');
  const sb = await api('POST', '/api/membership/checkout', { plan: 'plus_monthly', payment: 'sandbox' }, rider.token);
  assert.equal(sb.body.profile.membership.active, true);
  assert.equal((await api('POST', '/api/membership/trial', {}, rider.token)).status, 409, 'no trial after paying');

  await api('POST', '/api/driver/location', P('damside'), bikeDrv.token);
  const t = (await api('POST', '/api/trips', { service: 'bike', pickup: P('damside'), drop: P('lakeside') }, rider.token)).body;
  assert.equal(t.quote.discounts[0].kind, 'membership');
  await api('POST', `/api/trips/${t.id}/accept`, {}, bikeDrv.token);
  await api('POST', `/api/trips/${t.id}/arrived`, {}, bikeDrv.token);
  clock += 4 * 60000;
  const c = (await api('POST', `/api/trips/${t.id}/cancel`, { reason: 'changed plans' }, rider.token)).body;
  assert.equal(c.cancellation.fee, 20);
  assert.equal(c.cancellation.waivedByPlus, true);
  assert.equal((await api('GET', '/api/profile', null, rider.token)).body.dues, 0);
});

test('referral: friend signs up with code, rides free, referrer earns Rs 50 credit used on next ride', async () => {
  const code = (await api('GET', '/api/profile', null, rider.token)).body.referral.code;
  const friend = await login('9846000005', 'Friend', 'rider', { referralCode: code });
  await api('POST', '/api/driver/location', P('lakeside'), bikeDrv.token);
  const t = (await api('POST', '/api/trips', { service: 'bike', pickup: P('lakeside'), drop: P('tourist-bus-park') }, friend.token)).body;
  await api('POST', `/api/trips/${t.id}/accept`, {}, bikeDrv.token);
  await api('POST', `/api/trips/${t.id}/arrived`, {}, bikeDrv.token);
  await api('POST', `/api/trips/${t.id}/start`, { pin: t.pin }, bikeDrv.token);
  await api('POST', `/api/trips/${t.id}/complete`, {}, bikeDrv.token);
  assert.equal((await api('GET', '/api/profile', null, rider.token)).body.credits, 50);
});

test('salaried fleet employee: ops adds a fleet EV car, approves the employee with that car; earning hidden per trip', async () => {
  const emp = await login('9856000010', 'Sunita', 'driver');
  const fv = (await api('POST', '/api/admin/fleet', { type: 'car', fuel: 'ev', plate: 'GA 2 JA 7777', model: 'BYD Atto 3', seats: 5 }, admin.token)).body;
  const app = { driverType: 'employee', preferredVehicle: 'car', personal: person('Sunita Magar', { gender: 'female' }), licence: { number: '04-06-22223333', categories: ['B'], expiry: '2030-01-01' }, bank: bankOf('Sunita Magar'), face: face(5), consent: true };
  await api('PUT', '/api/driver/application', app, emp.token);
  for (const kind of ['citizenshipFront', 'citizenshipBack', 'licence', 'policeReport', 'selfie']) await api('POST', '/api/driver/application/documents', { kind, data: JPG }, emp.token);
  const sub = (await api('POST', '/api/driver/application/submit', {}, emp.token)).body;
  assert.equal((await api('POST', `/api/admin/applications/${sub.id}/review`, { decision: 'approve' }, admin.token)).status, 400, 'needs a fleet vehicle');
  const ok = await api('POST', `/api/admin/applications/${sub.id}/review`, { decision: 'approve', fleetVehicleId: fv.id, monthlyWage: 26000 }, admin.token);
  assert.equal(ok.status, 200);
  const d = (await api('GET', '/api/driver/dashboard', null, emp.token)).body;
  assert.equal(d.driver.driverType, 'employee');
  assert.equal(d.driver.vehicle.plate, 'GA 2 JA 7777');
  assert.equal(d.driver.employment.monthlyWage, 26000);
  assert.equal(d.thisWeek.type, 'employee');
  assert.equal((await api('GET', '/api/admin/fleet', null, admin.token)).body[0].assignedDriverId, d.driver.id);

  const rider2 = await login('9846000006', 'Tourist');
  await api('POST', '/api/driver/online', { online: true, loc: P('lakeside') }, emp.token);
  const t = (await api('POST', '/api/trips', { service: 'car_ev', pickup: P('lakeside'), drop: P('pokhara-intl-airport'), payment: 'cash' }, rider2.token)).body;
  const offer = (await api('GET', '/api/driver/offers', null, emp.token)).body[0];
  assert.equal(offer.earning, null, 'employees are on wages');
  await api('POST', `/api/trips/${t.id}/accept`, {}, emp.token);
  await api('POST', `/api/trips/${t.id}/arrived`, {}, emp.token);
  await api('POST', `/api/trips/${t.id}/start`, { pin: t.pin }, emp.token);
  clock += 30 * 60000;
  await api('POST', `/api/trips/${t.id}/complete`, {}, emp.token);
  const after = (await api('GET', '/api/driver/dashboard', null, emp.token)).body.driver;
  const fare = (await api('GET', `/api/trips/${t.id}`, null, rider2.token)).body.fare;
  assert.equal(after.cashHeld, fare);
  assert.equal(after.wallet, 0);
  assert.equal((await api('POST', `/api/admin/drivers/${after.id}/cash-deposit`, { amount: fare }, admin.token)).body.cashHeld, 0);
  await api('POST', '/api/driver/online', { online: false }, emp.token);
});

test('logistics: truck owner onboards (licence G, goods permit); intercity Pokhara → Kathmandu job with helpers, insurance, POD photo', async () => {
  const trucker = await login('9856000020', 'Hem', 'driver');
  await onboard(trucker.token, {
    driverType: 'partner', personal: person('Hem Raj Sapkota'), licence: { number: '04-06-55556666', categories: ['G'], expiry: '2032-01-01' },
    vehicle: { type: 'truck', fuel: 'diesel', plate: 'GA 3 KHA 101', model: 'Tata LPT 1109', bluebookNo: 'BB-9', insuranceExpiry: '2027-01-01', goodsPermit: true },
    bank: bankOf('Hem Raj Sapkota'), face: face(9), consent: true,
  }, admin.token);
  await api('POST', '/api/driver/online', { online: true, loc: P('budhibazar') }, trucker.token);
  const shop = await login('9846000030', 'Lekhnath Hardware');
  await api('PATCH', '/api/profile', { business: { name: 'Lekhnath Hardware Pvt Ltd', pan: '609876543' } }, shop.token);
  const t = await api('POST', '/api/trips', {
    service: 'truck', pickup: P('budhibazar'), drop: { ...KTM, label: 'Kalimati, Kathmandu' },
    parcel: { weightKg: 6000, goodsType: 'construction', helpers: 2, insure: true, declaredValue: 500000, description: 'Cement bags' },
    recipient: { name: 'Site office', phone: '9851000000' },
  }, shop.token);
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const trip = t.body;
  assert.equal(trip.business.pan, '609876543');
  assert.ok(trip.quote.intercity);
  assert.ok(trip.quote.lines.some((l) => /insurance/.test(l.label)));
  assert.equal(trip.quote.discounts[0]?.kind, 'free_ride', 'first ride free applies to any first trip (capped Rs 100)');
  await api('POST', `/api/trips/${trip.id}/accept`, {}, trucker.token);
  await api('POST', `/api/trips/${trip.id}/arrived`, {}, trucker.token);
  await api('POST', `/api/trips/${trip.id}/start`, { pin: trip.pin }, trucker.token);
  const done = await api('POST', `/api/trips/${trip.id}/complete`, { deliveryOtp: trip.deliveryOtp, podPhoto: JPG }, trucker.token);
  assert.equal(done.body.status, 'completed');
  assert.ok(store.get('trips', trip.id).proofOfDelivery);
  const s = (await api('GET', '/api/admin/stats', null, admin.token)).body;
  assert.equal(s.trips.logistics, 1);
  assert.ok(s.byWard[26] >= 1, 'demand tracked per ward');
});

test('random selfie mismatch twice suspends the driver and takes them offline; ops can reinstate', async () => {
  const d = svc.driverOf(store.all('users').find((u) => u.phone === '9856000002'));
  d.status = 'idle'; d.currentTripId = null;
  const r1 = await api('POST', '/api/driver/face-check', { descriptor: desc(42) }, bikeDrv.token);
  assert.equal(r1.body.passed, false);
  const r2 = await api('POST', '/api/driver/face-check', { descriptor: desc(43) }, bikeDrv.token);
  assert.equal(r2.body.suspended, true);
  assert.equal((await api('POST', '/api/driver/online', { online: true, loc: P('lakeside') }, bikeDrv.token)).status, 403);
  assert.equal((await api('POST', `/api/admin/drivers/${d.id}/suspend`, { suspended: false }, admin.token)).status, 200);
});

test('weekly payout: batch for last Sunday–Saturday, partner paid to bank, CSV for CorporatePay upload', async () => {
  clock = Date.parse('2026-10-18T06:00:00Z'); // Sunday after the trips above
  const b = (await api('POST', '/api/admin/payouts/run', {}, admin.token)).body;
  assert.equal(b.week.start, '2026-10-11');
  assert.equal(b.week.end, '2026-10-17');
  const ram = b.items.find((i) => i.name === 'Ram Bahadur Gurung');
  assert.ok(ram.amount > 0);
  assert.equal(ram.bank.bank, 'Nabil Bank');
  const emp = b.items.find((i) => i.driverType === 'employee');
  assert.ok(emp.payslip.gross > 0 && emp.payslip.ssfEmployee > 0);
  const csv = await fetch(`${base}/api/admin/payouts/${b.id}/csv`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /Ram Bahadur Gurung","Nabil Bank"/);
  assert.equal((await api('POST', '/api/admin/payouts/run', {}, admin.token)).body.id, b.id, 'idempotent');
  const dash = (await api('GET', '/api/driver/dashboard', null, bikeDrv.token)).body;
  assert.ok(dash.payouts.length >= 1);
});

test('eSewa: membership order callback activates Plus; tampered callback rejected', async () => {
  const u = await login('9846000040', 'Payer');
  const pay = (await api('POST', '/api/membership/checkout', { plan: 'plus_monthly', payment: 'esewa' }, u.token)).body;
  const cb = { transaction_code: '000AWEO', status: 'COMPLETE', total_amount: pay.fields.total_amount, transaction_uuid: pay.fields.transaction_uuid, product_code: 'EPAYTEST', signed_field_names: 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names' };
  const tampered = { ...cb, signature: esewaSign(cb, cb.signed_field_names), total_amount: '1' };
  assert.match((await api('GET', `/api/pay/esewa/success?data=${encodeURIComponent(Buffer.from(JSON.stringify(tampered)).toString('base64'))}`)).headers.get('location'), /failed/);
  cb.signature = esewaSign(cb, cb.signed_field_names);
  assert.match((await api('GET', `/api/pay/esewa/success?data=${encodeURIComponent(Buffer.from(JSON.stringify(cb)).toString('base64'))}`)).headers.get('location'), /membership_active/);
  assert.equal((await api('GET', '/api/profile', null, u.token)).body.membership.active, true);
});

test('admin promo creation and economics endpoint (v1 vs v2 bridge, 24-month projection, fleet)', async () => {
  assert.equal((await api('POST', '/api/admin/promos', { code: 'DASHAIN', type: 'percent', value: 0.15, maxOff: 40 }, admin.token)).status, 200);
  assert.equal((await api('POST', '/api/admin/promos', { code: 'DASHAIN', type: 'percent', value: 0.15 }, admin.token)).status, 409);
  const e = (await api('GET', '/api/admin/economics', null, admin.token)).body;
  assert.ok(e.projection.breakEvenMonth <= 6);
  assert.equal(e.comparison.mature.length, 7);
  assert.ok(e.fleet.doubleShift.marginPerMonth > 0);
});

test('malformed JSON 400, unknown route 404, oversized upload 413', async () => {
  assert.equal((await fetch(base + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
  assert.equal((await api('GET', '/api/nope')).status, 404);
  const big = `data:image/jpeg;base64,${Buffer.alloc(1.6 * 1024 * 1024, 0xff).toString('base64')}`;
  const u = await login('9856000099', 'Big', 'driver');
  assert.equal((await api('POST', '/api/driver/application/documents', { kind: 'licence', data: big }, u.token)).status, 413);
});

test('heading-home filter: max twice a day, clears on request', async () => {
  const d = svc.driverOf(store.all('users').find((u) => u.phone === '9856000002'));
  d.homeFilterUses = null;
  const home = { loc: P('talchowk') };
  assert.equal((await api('POST', '/api/driver/heading-home', home, bikeDrv.token)).body.homeFilter.ward, 'Pokhara-27, Tal Chowk');
  assert.equal((await api('POST', '/api/driver/heading-home', { loc: null }, bikeDrv.token)).body.homeFilter, null);
  await api('POST', '/api/driver/heading-home', home, bikeDrv.token);
  assert.equal((await api('POST', '/api/driver/heading-home', home, bikeDrv.token)).status, 429);
});

test('logistics quote into a hill ward recommends the 4×4 jeep; a petrol van keeps its fuel type', async () => {
  const q = await api('POST', '/api/quote', { pickup: P('chipledhunga'), drop: P('sarangkot'), kind: 'logistics', parcel: { weightKg: 500 } });
  assert.equal(q.body.recommend, 'jeep');
  assert.ok(q.body.quotes.find((x) => x.service === 'van'));
  const flat = await api('POST', '/api/quote', { pickup: P('chipledhunga'), drop: P('new-road'), kind: 'logistics', parcel: { weightKg: 500 } });
  assert.equal(flat.body.recommend, null);
  const v = (await api('POST', '/api/admin/fleet', { type: 'van', fuel: 'petrol', plate: 'GA 2 JA 8888', model: 'Suzuki Super Carry' }, admin.token)).body;
  assert.equal(v.fuel, 'petrol');
  assert.equal(v.goodsPermit, true);
});


test('SMS: login codes and parcel receiver codes are actually sent by SMS; KYC approval texted to the driver', async () => {
  assert.ok(smsSent.some((m) => m.phone === '9846000001' && /is your MyRide code/.test(m.text)));
  const receiver = smsSent.find((m) => m.phone === '9851000000');
  assert.ok(receiver && /Give the driver code [0-9]{4} only after/.test(receiver.text), 'truck job receiver got the delivery code');
  assert.ok(smsSent.some((m) => m.phone === '9856000002' && /approved/.test(m.text)));
  const log = (await api('GET', '/api/admin/sms', null, admin.token)).body;
  assert.ok(log.length >= 3 && log.every((x) => x.ok));
});

test('navigation endpoint returns a polyline and turn-by-turn steps; needs a session', async () => {
  assert.equal((await api('GET', '/api/navigate?from=28.209,83.9595&to=28.18787,84.01024')).status, 401);
  const r = (await api('GET', '/api/navigate?from=28.209,83.9595&to=28.18787,84.01024', null, bikeDrv.token)).body;
  assert.ok(r.geometry.length >= 2 && r.steps.length >= 2);
  assert.equal(r.steps.at(-1).type, 'arrive');
  assert.equal((await api('GET', '/api/navigate?from=bad&to=28,84', null, bikeDrv.token)).status, 400);
});

test('nearby cars: anonymous, rounded positions of idle online drivers within 3 km', async () => {
  const r = (await api('GET', `/api/nearby?lat=${P('lakeside').lat}&lng=${P('lakeside').lng}`)).body;
  assert.ok(Array.isArray(r));
  for (const c of r) {
    assert.deepEqual(Object.keys(c).sort(), ['ev', 'lat', 'lng', 'type']);
    assert.equal(Math.round(c.lat * 1000), c.lat * 1000);
  }
  assert.equal((await api('GET', '/api/nearby?lat=x')).status, 400);
});
