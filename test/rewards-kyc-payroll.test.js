const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/store');
const rewards = require('../src/rewards');
const kyc = require('../src/kyc');
const payroll = require('../src/payroll');
const { quote, applyDiscounts } = require('../src/pricing');
const { MEMBERSHIP, PAYROLL } = require('../src/config');
const economics = require('../src/economics');

const NOW = Date.parse('2026-10-14T06:00:00Z'); // a Wednesday
const DAY = 86400000;
const user = (o = {}) => ({ id: 'u1', phone: '9846000001', name: 'Test', promosUsed: [], credits: 0, completedTrips: 0, ...o });
const freshStore = () => { const s = new Store(null); s.db.ledger = {}; s.db.payoutBatches = {}; rewards.seedPromos(s); return s; };

// ---------- membership ----------
test('MyRide Plus: Rs 199.99/month, Rs 1,999.99/year (= 10 months, ~17% off)', () => {
  const m = MEMBERSHIP.plans;
  assert.equal(m.plus_monthly.price, 199.99);
  assert.equal(m.plus_yearly.price, 1999.99);
  const saving = 1 - m.plus_yearly.price / (12 * m.plus_monthly.price);
  assert.ok(saving > 0.16 && saving < 0.17, String(saving));
});

test('membership activation, stacking renewal, expiry and one-time trial', () => {
  const u = user();
  rewards.activateMembership(u, 'plus_monthly', NOW, { trial: true });
  assert.equal(rewards.isMember(u, NOW), true);
  assert.equal(u.membership.expiresAt, NOW + 7 * DAY);
  assert.throws(() => rewards.activateMembership(u, 'plus_monthly', NOW, { trial: true }), /first-time/);
  rewards.activateMembership(u, 'plus_yearly', NOW);
  assert.equal(u.membership.expiresAt, NOW + 7 * DAY + 365 * DAY, 'paid year stacks on the trial');
  assert.equal(rewards.isMember(u, NOW + 400 * DAY), false);
});

test('discount stack: Plus 5% (max Rs 25) → first ride free (max Rs 100) → credits; driver pay unchanged', () => {
  const s = freshStore();
  const u = user({ credits: 30 });
  rewards.activateMembership(u, 'plus_monthly', NOW);
  const ds = rewards.discountsFor({ store: s, user: u, serviceId: 'car', now: NOW });
  assert.deepEqual(ds.map((d) => d.kind), ['membership', 'free_ride', 'credit']);
  const plain = quote('car', { km: 7.5, min: 15 });
  const q = quote('car', { km: 7.5, min: 15 }, { discounts: ds });
  assert.equal(q.discounts[0].amount, Math.min(plain.gross * 0.05, 25));
  assert.equal(q.discounts[1].amount, 100);
  assert.equal(q.discounts[2].amount, 30);
  assert.equal(q.split.driver, plain.split.driver);
  assert.equal(q.total, Math.round(plain.gross - q.split.promoCost));
});

test('first ride free covers a short bike ride completely (Rs 0 to pay)', () => {
  const s = freshStore();
  const ds = rewards.discountsFor({ store: s, user: user(), serviceId: 'bike', now: NOW });
  const q = quote('bike', { km: 3.5, min: 9 }, { discounts: ds });
  assert.equal(q.total, 0);
  assert.ok(q.split.driver > 50, 'driver still paid in full');
});

test('settling: first free ride used once, credits consumed, referral credits the referrer once', () => {
  const s = freshStore();
  const ref = s.put('users', user({ id: 'ref', referralCode: 'MRAAAAAA' }));
  const u = s.put('users', user({ id: 'new', credits: 0 }));
  rewards.applyReferral(s, u, 'mraaaaaa');
  assert.throws(() => rewards.applyReferral(s, u, 'MRAAAAAA'), /already/);
  const req = rewards.discountsFor({ store: s, user: u, serviceId: 'bike', now: NOW });
  const q = quote('bike', { km: 3, min: 8 }, { discounts: req });
  const out = rewards.settleDiscounts({ store: s, user: u, applied: q.discounts, requested: req, now: NOW });
  assert.equal(u.firstRideFreeUsed, true);
  assert.equal(out.credit, 50);
  assert.equal(ref.credits, 50);
  assert.equal(rewards.discountsFor({ store: s, user: u, serviceId: 'bike', now: NOW }).length, 0, 'no second free ride');
  assert.throws(() => rewards.applyReferral(s, s.put('users', user({ id: 'self', referralCode: 'MRSELF22' })), 'MRSELF22'), /yourself/);
});

test('promo validation: once per user, service restriction, expiry, usage limit; admin creation rules', () => {
  const s = freshStore();
  const u = user({ promosUsed: ['NAMASTE'] });
  assert.throws(() => rewards.validatePromo(s, u, 'NAMASTE', 'bike', NOW), /already used/);
  assert.throws(() => rewards.validatePromo(s, u, 'GREEN10', 'bike', NOW), /only valid/);
  assert.ok(rewards.validatePromo(s, u, 'GREEN10', 'bike_ev', NOW));
  assert.throws(() => rewards.validatePromo(s, u, 'NOPE', 'bike', NOW), /not valid/);
  rewards.createPromo(s, { code: 'DASHAIN26', type: 'percent', value: 0.25, maxOff: 60, expiresAt: '2026-10-01', usageLimit: 2 });
  assert.throws(() => rewards.validatePromo(s, u, 'DASHAIN26', 'bike', NOW), /expired/);
  rewards.createPromo(s, { code: 'TIHAR26', type: 'flat', value: 50, usageLimit: 1 });
  s.get('promos', 'TIHAR26').used = 1;
  assert.throws(() => rewards.validatePromo(s, u, 'TIHAR26', 'bike', NOW), /fully redeemed/);
  assert.throws(() => rewards.createPromo(s, { code: 'BIG', type: 'percent', value: 0.9 }), /4–16|between/);
  assert.throws(() => rewards.createPromo(s, { code: 'HUGE1', type: 'percent', value: 0.9 }), /between 0 and 0.5/);
  const free = rewards.validatePromo(s, user(), 'FREERIDE', 'car', NOW);
  const q = quote('car', { km: 3, min: 8 }, { discounts: [{ kind: 'free_ride', pct: 1, maxOff: free.maxOff }] });
  assert.equal(q.split.promoCost, 120);
});

// ---------- KYC ----------
const desc = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 31 + i) * 0.1);
const near = (d, eps) => d.map((x, i) => x + (i % 2 ? eps : -eps));
const goodApp = (o = {}) => ({
  driverType: 'partner',
  personal: { fullName: 'Ram Bahadur Gurung', dob: '1994-05-10', gender: 'male', address: 'Pokhara-17, Birauta', citizenshipNo: '45-01-77-12345', citizenshipDistrict: 'Kaski' },
  licence: { number: '04-06-12345678', categories: ['A'], expiry: '2030-01-01' },
  vehicle: { type: 'bike', fuel: 'petrol', plate: 'GA 1 PA 4455', bluebookNo: 'BB-12345', insuranceExpiry: '2027-06-01' },
  bank: { bank: 'Nabil Bank', branch: 'Lakeside', accountName: 'Ram Bahadur Gurung', accountNumber: '01234567890123' },
  documents: { citizenshipFront: 'f1', citizenshipBack: 'f2', licence: 'f3', policeReport: 'f4', selfie: 'f5', bluebook: 'f6', insurance: 'f7' },
  face: { selfieDescriptor: desc(1), idDescriptor: near(desc(1), 0.02), liveness: { passed: true } },
  consent: { at: NOW },
  ...o,
});

test('KYC: a complete partner application passes all checks', () => {
  const { errors, checks } = kyc.validateApplication(goodApp(), NOW);
  assert.deepEqual(errors, []);
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks));
});

test('KYC: licence category must match vehicle (A/K bike, B car, F/G trucks) and truck drivers must be 21+', () => {
  const car = goodApp({ vehicle: { ...goodApp().vehicle, type: 'car', publicPlate: true, seats: 4 } });
  assert.match(kyc.validateApplication(car, NOW).errors.join('|'), /category B/);
  const truck = goodApp({ personal: { ...goodApp().personal, dob: '2006-01-01' }, licence: { ...goodApp().licence, categories: ['G'] }, vehicle: { ...goodApp().vehicle, type: 'truck', goodsPermit: true } });
  assert.match(kyc.validateApplication(truck, NOW).errors.join('|'), /at least 21/);
});

test('KYC: expired licence, red-plate car, missing goods permit, bad bank account, missing docs, no consent', () => {
  const errs = (o) => kyc.validateApplication(goodApp(o), NOW).errors.join('|');
  assert.match(errs({ licence: { ...goodApp().licence, expiry: '2025-01-01' } }), /expired/);
  assert.match(errs({ licence: { ...goodApp().licence, categories: ['B'] }, vehicle: { ...goodApp().vehicle, type: 'car', publicPlate: false, seats: 4 } }), /black-plate/);
  assert.match(errs({ licence: { ...goodApp().licence, categories: ['B'] }, vehicle: { ...goodApp().vehicle, type: 'pickup' } }), /goods transport/);
  assert.match(errs({ bank: { ...goodApp().bank, accountNumber: '12ab' } }), /8–20 digits/);
  assert.match(errs({ documents: { selfie: 'x' } }), /Upload: citizenshipFront/);
  assert.match(errs({ consent: null }), /consent/);
});

test('KYC: employees need no own vehicle documents; bank-name mismatch and face mismatch are flagged for review', () => {
  const app = goodApp({ driverType: 'employee', preferredVehicle: 'car', vehicle: undefined, licence: { ...goodApp().licence, categories: ['B'] },
    documents: { citizenshipFront: 'a', citizenshipBack: 'b', licence: 'c', policeReport: 'd', selfie: 'e' },
    bank: { ...goodApp().bank, accountName: 'Shyam Thapa' }, face: { selfieDescriptor: desc(1), idDescriptor: desc(9), liveness: { passed: true } } });
  const { errors, checks } = kyc.validateApplication(app, NOW);
  assert.deepEqual(errors, []);
  assert.equal(checks.find((c) => c.check === 'bank_name_match').ok, false);
  assert.equal(checks.find((c) => c.check === 'selfie_vs_id_photo').ok, false);
});

test('Real-Time ID check: matching selfie passes; two mismatches suspend the driver', () => {
  const d = { faceDescriptor: desc(3), faceCheck: { pending: true, reason: 'random' } };
  assert.equal(kyc.verifySelfie(d, { provider: 'local', passed: true, distance: 0.1 }, NOW).passed, true);
  assert.equal(d.faceCheck.pending, false);
  assert.equal(d.faceCheck.lastPassedAt, NOW);
  assert.equal(kyc.verifySelfie(d, { provider: 'local', passed: false, distance: 0.9 }, NOW).passed, false);
  assert.ok(!d.suspended);
  kyc.verifySelfie(d, { provider: 'local', passed: false, distance: 0.8 }, NOW);
  assert.match(d.suspended.reason, /review/);
  assert.equal(kyc.faceDistance(desc(1), [1, 2]), Infinity);
});

test('Real-Time ID check scheduling: mandatory after 72 h, otherwise random (30%) at go-online', () => {
  assert.equal(kyc.selfieNeededAtGoOnline({ faceCheck: { lastPassedAt: NOW - 73 * 3600000 } }, NOW, () => 0.99), 'periodic');
  assert.equal(kyc.selfieNeededAtGoOnline({ faceCheck: { lastPassedAt: NOW - 3600000 } }, NOW, () => 0.1), 'random');
  assert.equal(kyc.selfieNeededAtGoOnline({ faceCheck: { lastPassedAt: NOW - 3600000 } }, NOW, () => 0.5), null);
});

// ---------- payroll ----------
test('pay week is the previous Sunday–Saturday', () => {
  const w = payroll.previousWeek(NOW);
  assert.equal(new Date(w.start).toISOString().slice(0, 10), '2026-10-04');
  assert.equal(new Date(w.end).toISOString().slice(0, 10), '2026-10-11');
  assert.equal(new Date(w.start).getUTCDay(), 0);
});

test('employee payslip: hourly from monthly wage, overtime ×1.5 capped at 4 h, trip incentive, SSF 11%/20% of basic', () => {
  const week = payroll.previousWeek(NOW);
  const shiftLog = { '2026-10-04': { minutes: 8 * 60, trips: 12 }, '2026-10-05': { minutes: 10 * 60, trips: 15 }, '2026-10-06': { minutes: 13 * 60, trips: 10 } };
  const slip = payroll.employeePayslip({ employment: { monthlyWage: 26000 }, shiftLog, cashHeld: 1500 }, week);
  const hourly = 26000 / (26 * 8);
  assert.equal(slip.hourlyRate, 125);
  assert.equal(slip.regularHours, 24);
  assert.equal(slip.overtimeHours, 2 + 4);
  assert.equal(slip.gross, Math.round((24 * hourly + 6 * hourly * 1.5 + 3 * 15) * 100) / 100);
  assert.equal(slip.ssfEmployee, Math.round(24 * hourly * 0.6 * 0.11 * 100) / 100);
  assert.equal(slip.ssfEmployer, Math.round(24 * hourly * 0.6 * 0.2 * 100) / 100);
  assert.equal(slip.cashToDeposit, 1500, 'cash fares are reconciled separately, never deducted from wages');
  assert.match(slip.warnings.join(), /12 h/);
  assert.ok(26000 >= PAYROLL.minimumWageMonthly);
});

test('weekly payout run: partners paid positive balance, negative carried; idempotent; bank CSV', () => {
  const s = freshStore();
  const week = payroll.previousWeek(NOW);
  const post = (d, type, amount, meta) => { s.put('ledger', { id: s.id('l'), driverId: d.id, at: week.start + DAY, type, amount, ...meta }); d.wallet = Math.round((d.wallet + amount) * 100) / 100; };
  const bank = { bank: 'Nabil Bank', branch: 'Lakeside', accountNumber: '0123456789', accountName: 'Sita Pun' };
  const a = s.put('drivers', { id: 'a', name: 'Sita Pun', driverType: 'partner', wallet: 0, bank });
  const b = s.put('drivers', { id: 'b', name: 'Hari', driverType: 'partner', wallet: 0, bank: { ...bank, accountName: 'Hari Baral' } });
  post(a, 'trip_earning', 1200); post(a, 'cash_collected', -300);
  post(b, 'trip_earning', 100); post(b, 'cash_collected', -400);
  const batch = payroll.runWeeklyPayout({ store: s, now: NOW, post });
  assert.equal(batch.items.find((i) => i.driverId === 'a').amount, 900);
  assert.equal(batch.items.find((i) => i.driverId === 'b').amount, 0);
  assert.equal(a.wallet, 0);
  assert.equal(b.wallet, -300);
  assert.equal(batch.total, 900);
  assert.equal(payroll.runWeeklyPayout({ store: s, now: NOW, post }).id, batch.id);
  const csv = payroll.batchCsv(batch).split('\r\n');
  assert.equal(csv.length, 2);
  assert.match(csv[1], /"Sita Pun","Nabil Bank","Lakeside","0123456789","900.00"/);
});

// ---------- economics v2 ----------
test('economics: v2 beats v1 at every stage on the same ride/parcel volumes', () => {
  for (const st of ['launch', 'growth', 'mature']) {
    assert.ok(economics.monthly(st, economics.V2).ebitda > economics.monthly(st, economics.V1).ebitda, st);
  }
});

test('economics: v2 burns less, breaks even by month 6, pays back within 12 months; v1 never does', () => {
  const v1 = economics.projection({ version: economics.V1 });
  const v2 = economics.projection();
  assert.ok(v2.peakCashNeed < v1.peakCashNeed / 2);
  assert.ok(v2.breakEvenMonth <= 6, String(v2.breakEvenMonth));
  assert.ok(v2.paybackMonth <= 12, String(v2.paybackMonth));
  assert.equal(v1.paybackMonth, null);
  assert.ok(economics.monthly('launch', economics.V2).ebitda > -800000, 'launch burn below Rs 8 lakh/month');
});

test('fleet EV car: profitable only when double-shifted', () => {
  const f = economics.fleetUnitEconomics();
  assert.ok(f.singleShift.marginPerMonth < 0);
  assert.ok(f.doubleShift.marginPerMonth > 0);
});
