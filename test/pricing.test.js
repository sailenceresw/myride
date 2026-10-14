const test = require('node:test');
const assert = require('node:assert/strict');
const { quote, gandakiCap, deadKmPay, fixedFare } = require('../src/pricing');
const { SERVICES, GANDAKI } = require('../src/config');
const matrix = require('../data/route-matrix.json');

const kmBetween = (a, b) => matrix.distances_m[matrix.ids.indexOf(a)][matrix.ids.indexOf(b)] / 1000;
const rides = Object.keys(SERVICES).filter((s) => SERVICES[s].kind === 'ride');

test('Gandaki official schedule reproduces the published minimum fares', () => {
  // 2-wheeler min Rs 46.85 = 30 + 16.85×1 km exactly.
  assert.equal(GANDAKI.bike.base + GANDAKI.bike.perKm * 1, GANDAKI.bike.minFare);
  // 4-wheeler: published min Rs 156.5 for 2 km, but 60 + 48.5×2 = 157 — the notice itself is off by Rs 0.5.
  assert.ok(Math.abs(GANDAKI.car.base + GANDAKI.car.perKm * 2 - GANDAKI.car.minFare) <= 0.5);
});

test('every ride fare stays at or below the Gandaki legal maximum from 0.3 to 20 km', () => {
  for (const s of rides) {
    for (let km = 0.3; km <= 20; km += 0.1) {
      const q = quote(s, { km, min: km * 3 });
      const cap = gandakiCap(SERVICES[s].regClass, SERVICES[s].fuel, km);
      assert.ok(q.total <= Math.round(cap), `${s} at ${km.toFixed(1)} km: ${q.total} > cap ${cap}`);
    }
  }
});

test('EV rides are cheaper than petrol for the same trip', () => {
  for (const km of [1, 3.5, 7.5, 15]) {
    assert.ok(quote('bike_ev', { km, min: 10 }).total < quote('bike', { km, min: 10 }).total);
    assert.ok(quote('car_ev', { km, min: 10 }).total < quote('car', { km, min: 10 }).total);
  }
});

test('minimum fare applies to very short trips', () => {
  assert.equal(quote('bike', { km: 0.4, min: 2 }).total, SERVICES.bike.minFare);
  assert.equal(quote('car', { km: 0.4, min: 2 }).total, SERVICES.car.minFare);
});

test('MyRide beats every competitor estimate on real measured Pokhara routes', () => {
  const routes = [['lakeside', 'prithvi-chowk'], ['lakeside', 'pokhara-intl-airport'], ['damside', 'mahendrapul'], ['lakeside', 'sarangkot'], ['new-road', 'manipal-hospital']];
  for (const [a, b] of routes) {
    const km = kmBetween(a, b);
    for (const s of ['bike', 'car']) {
      const q = quote(s, { km, min: 10 });
      for (const c of q.competitors) assert.ok(q.total < c.estimate, `${s} ${a}->${b} ${km.toFixed(2)}km: ours ${q.total} vs ${c.name} ${c.estimate}`);
    }
  }
});

test('driver earns more than vehicle running cost on every ride service', () => {
  for (const s of rides) {
    for (const km of [1, 3.54, 8, 20]) {
      const q = quote(s, { km, min: 10 });
      assert.ok(q.split.driver > q.driverCostEstimate, `${s} ${km}km driver ${q.split.driver} cost ${q.driverCostEstimate}`);
    }
  }
});

test('average 3.54 km bike trip pays the rider above the Rs 14–15/km operating-cost benchmark', () => {
  const q = quote('bike', { km: 3.54, min: 9 });
  assert.ok(q.split.driver / 3.54 > 15, `gross per km ${q.split.driver / 3.54}`);
});

test('platform fee never exceeds the 12% provincial cap', () => {
  for (const s of Object.keys(SERVICES)) {
    for (const km of [0.5, 2, 5, 12]) {
      let q;
      try { q = quote(s, { km, min: 10 }, { parcel: { weightKg: 1 } }); } catch { continue; }
      assert.ok(q.split.platformFee <= q.gross * 0.12 + 0.01, `${s} ${km} fee ${q.split.platformFee} of ${q.gross}`);
    }
  }
});

test('fare split adds up: driver + platform fee + VAT + 1% accident fund = fare', () => {
  const q = quote('car', { km: 6, min: 15 });
  assert.ok(Math.abs(q.split.driver + q.split.platformFee + q.split.vatOnTransport + q.gross * 0.01 - q.gross) < 0.01);
  assert.ok(q.split.accidentFund > q.gross * 0.01, 'platform adds 0.5% of its fee');
});

test('promo is platform-funded: driver earning unchanged, customer pays less, capped at maxOff', () => {
  const r = { km: 12.03, min: 26 }; // Lakeside → Sarangkot: 20% would be ~Rs 40, capped at Rs 30
  const plain = quote('bike', r);
  const promo = quote('bike', r, { promo: { code: 'POKHARA20', pct: 0.2, maxOff: 30 } });
  assert.equal(promo.split.driver, plain.split.driver);
  assert.equal(plain.total - promo.total, 30);
});

test('waiting is free for 3 minutes then charged per minute', () => {
  const r = { km: 3, min: 8 };
  assert.equal(quote('bike', r, { waitMin: 3 }).total, quote('bike', r).total);
  assert.equal(quote('bike', r, { waitMin: 6 }).total - quote('bike', r).total, 6);
});

test('delivery pricing: extra weight, fragile, COD, and weight limit', () => {
  const r = { km: 4, min: 12 };
  const base = quote('parcel_express', r, { parcel: { weightKg: 2 } }).total;
  assert.equal(quote('parcel_express', r, { parcel: { weightKg: 5 } }).total - base, 16);
  assert.equal(quote('parcel_express', r, { parcel: { weightKg: 2, fragile: true } }).total - base, 20);
  assert.equal(quote('parcel_express', r, { parcel: { weightKg: 2, codAmount: 3000 } }).total - base, 30);
  assert.throws(() => quote('parcel_express', r, { parcel: { weightKg: 25 } }), /up to 10 kg/);
  assert.equal(quote('parcel_standard', r, { parcel: { weightKg: 1 } }).total, 75);
  assert.throws(() => quote('parcel_standard', { km: 15, min: 30 }, { parcel: { weightKg: 1 } }), /up to 12 km/);
  assert.equal(quote('cargo', r, { parcel: { weightKg: 300, helpers: 2 } }).total, quote('cargo', r, { parcel: { weightKg: 300 } }).total + 1600);
});

test('dead-km pay only beyond the free 2.5 km pickup', () => {
  assert.equal(deadKmPay('bike', 2), 0);
  assert.equal(deadKmPay('bike', 4.5), 10);
  assert.equal(deadKmPay('car', 3.5), 15);
});

test('fixed tourist fare Lakeside → Pokhara International Airport', () => {
  const km = kmBetween('lakeside', 'pokhara-intl-airport');
  assert.ok(km > 6 && km < 9, `measured ${km}`);
  const car = fixedFare('car', { km, min: 14 });
  assert.equal(car % 10, 0);
  assert.ok(car < 500, `street taxis quote Rs 500–1,200; ours ${car}`);
});

test('unknown service is rejected', () => {
  assert.throws(() => quote('helicopter', { km: 1, min: 1 }), /Unknown service/);
});

// ---------- national draft standard (Digital Mobility Service Operation Standards 2082) ----------
const { federalCap, legalCap, maxFeeRate } = require('../src/pricing');
const { COMPLIANCE, FEDERAL_DRAFT } = require('../src/config');

test('"bike" services are motorcycles/scooters (two-wheelers) in every label', () => {
  assert.match(SERVICES.bike.label, /Motorcycle/);
  assert.match(SERVICES.bike_ev.label, /Motorcycle/);
  assert.match(SERVICES.parcel_express.label, /motorcycle/);
});

test('federal draft caps: Rs 25/km motorcycle, Rs 55/km car, charged on at least 2 km', () => {
  assert.equal(federalCap('bike', 1), 50);
  assert.equal(federalCap('car', 1.5), 110);
  assert.equal(federalCap('car', 7.5), 412.5);
  for (const s of rides) for (let km = 0.3; km <= 20; km += 0.1) {
    const q = quote(s, { km, min: 10 });
    assert.ok(q.total <= Math.round(federalCap(SERVICES[s].regClass, km)), `${s} ${km.toFixed(1)} km over federal cap`);
  }
});

test('minimum fares sit under both legal limits: motorcycle Rs 40 (Gandaki Rs 42.17), car Rs 105 (federal Rs 110, Gandaki Rs 140.85)', () => {
  assert.equal(quote('bike', { km: 0.5, min: 2 }).total, 40);
  assert.equal(quote('bike_ev', { km: 0.5, min: 2 }).total, 37);
  assert.equal(quote('car', { km: 0.5, min: 2 }).total, 105);
  assert.equal(quote('car_ev', { km: 0.5, min: 2 }).total, 99);
  assert.ok(Math.round(legalCap('car', 'petrol', 0.5)) === 110);
});

test('ride fares never need clamping by a cap (tariff sits under every legal limit up to 20 km)', () => {
  for (const s of rides) for (let km = 0.3; km <= 20; km += 0.1) {
    assert.ok(!quote(s, { km, min: 10 }).lines.some((l) => /cap adjustment/.test(l.label)), `${s} ${km.toFixed(1)} km`);
  }
});

test('commission ≤ 10% on every ride (federal draft) — parcels/logistics keep the 12% provincial ceiling', () => {
  for (const s of rides) for (const km of [0.5, 1, 2, 3.54, 7.5, 15]) {
    const q = quote(s, { km, min: 10 });
    assert.ok(q.split.platformFee <= q.gross * 0.1 + 0.005, `${s} ${km}`);
  }
  assert.equal(maxFeeRate(SERVICES.parcel_express), 0.12);
});

test('with the federal draft switched off, only Gandaki rules apply (12% fee, no accident fund)', () => {
  COMPLIANCE.federalDraft = false;
  try {
    const q = quote('bike', { km: 3.54, min: 9 });
    assert.equal(q.split.accidentFund, 0);
    assert.equal(maxFeeRate(SERVICES.bike), 0.12);
    assert.equal(federalCap('car', 1), Infinity);
  } finally { COMPLIANCE.federalDraft = true; }
  assert.equal(FEDERAL_DRAFT.maxCommission, 0.1);
});

test('cars undercut the DoTM taxi meter (Rs 50 + Rs 10/200 m) from 3 km', () => {
  for (const km of [3, 3.54, 6, 7.5, 12, 20]) {
    const q = quote('car', { km, min: 10 });
    const meter = q.competitors.find((c) => c.name === 'Metered taxi').estimate;
    assert.ok(q.total < meter, `${km} km: ${q.total} vs meter ${meter}`);
  }
});
