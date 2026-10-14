const test = require('node:test');
const assert = require('node:assert/strict');
const { wardOf, cityOf, inLaunchCity, inServiceArea, haversineKm, places, cities } = require('../src/geo');
const { quote } = require('../src/pricing');
const { LOGISTICS, CITY } = require('../src/config');

const wards = cities.pokhara.wards;
const P = (id) => places.find((p) => p.id === id);

test('Pokhara Metropolitan City has 33 wards (Pokhara-1 … Pokhara-33) with official OSM boundaries', () => {
  assert.equal(wards.length, 33);
  assert.deepEqual(wards.map((w) => w.ward), Array.from({ length: 33 }, (_, i) => i + 1));
  assert.ok(wards.every((w) => w.geojson && w.osmRelation));
});

test('ward table sums to the 2021 census total and the OSM area matches the official 464.24 km²', () => {
  assert.equal(wards.reduce((s, w) => s + w.population, 0), 513504);
  const area = wards.reduce((s, w) => s + w.areaKm2, 0);
  assert.ok(Math.abs(area - 464.24) / 464.24 < 0.01, `area ${area}`);
});

test('former Lekhnath municipality = wards 26–33 and is fully served', () => {
  const lek = wards.filter((w) => w.former === 'Lekhnath Municipality').map((w) => w.ward);
  assert.deepEqual(lek, [26, 27, 28, 29, 30, 31, 32, 33]);
  for (const w of wards) assert.ok(inLaunchCity(w), `ward ${w.ward} centre must be pickup-able`);
});

test('every ward centre is inside its own ward polygon', () => {
  for (const w of wards) assert.equal(wardOf(w)?.ward, w.ward, `ward ${w.ward}`);
});

test('landmarks resolve to the correct ward', () => {
  assert.equal(wardOf(P('lakeside')).ward, 6);
  assert.equal(wardOf(P('damside')).ward, 6);
  assert.equal(wardOf(P('pokhara-intl-airport')).ward, 14);
  assert.equal(wardOf(P('talchowk')).ward, 27);
  assert.equal(wardOf(P('pokhara-university')).ward, 30);
  assert.equal(wardOf(P('begnas-lake')).ward, 31);
  assert.equal(wardOf(P('sarangkot')).ward, 18);
  assert.equal(wardOf(P('lakeside')).label, 'Pokhara-6, Baidam (Lakeside)');
});

test('Rupa Lake is outside Pokhara (Rupa Rural Municipality) but inside the 20 km radius', () => {
  assert.equal(cityOf(P('rupa-lake')), null);
  assert.equal(inServiceArea(P('rupa-lake')), true);
});

test('the 20 km provincial radius covers the entire city boundary', () => {
  const g = cities.pokhara.boundaryGeo;
  const pts = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flatMap((p) => p[0]);
  const max = Math.max(...pts.map(([lng, lat]) => haversineKm(CITY.centre, { lat, lng })));
  assert.ok(max < CITY.maxRadiusKm, `farthest boundary point ${max.toFixed(2)} km`);
});

test('Kathmandu and Damauli are not pickup areas; future cities are configured but inactive', () => {
  assert.equal(inLaunchCity({ lat: 27.7172, lng: 85.324 }), false);
  assert.equal(inLaunchCity({ lat: 27.9729, lng: 84.2685 }), false);
  assert.equal(cities.kathmandu.active, false);
});

// ---------- logistics pricing ----------
test('intercity rate kicks in beyond 25 km', () => {
  const at25 = quote('truck_light', { km: 25, min: 60 });
  const at26 = quote('truck_light', { km: 26, min: 62 });
  assert.equal(at25.intercity, false);
  assert.equal(at26.intercity, true);
  assert.equal(at26.total - at25.total, 95);
});

test('Pokhara → Kathmandu (~200 km) truck quote is in a realistic range and below a car-hire benchmark per tonne', () => {
  const q = quote('truck', { km: 200, min: 360 }, { parcel: { weightKg: 7000 } });
  assert.ok(q.total > 25000 && q.total < 40000, `truck ${q.total}`);
  const pick = quote('pickup', { km: 200, min: 330 }, { parcel: { weightKg: 1200 } });
  assert.ok(pick.total > 12000 && pick.total < 18000, `pickup ${pick.total}`); // sedan hire one-way is Rs 14–18k
});

test('logistics extras: helpers, goods-in-transit insurance, weight limits, max distance', () => {
  const r = { km: 8, min: 25 };
  const base = quote('pickup', r, { parcel: { weightKg: 800 } }).total;
  assert.equal(quote('pickup', r, { parcel: { weightKg: 800, helpers: 3 } }).total - base, 3 * LOGISTICS.helperFee);
  assert.equal(quote('pickup', r, { parcel: { weightKg: 800, insure: true, declaredValue: 200000 } }).total - base, 600);
  assert.equal(quote('pickup', r, { parcel: { weightKg: 800, insure: true, declaredValue: 5000 } }).total - base, LOGISTICS.insuranceMin);
  assert.throws(() => quote('pickup', r, { parcel: { weightKg: 2000 } }), /1,500 kg/);
  assert.throws(() => quote('truck', { km: 400, min: 600 }, { parcel: { weightKg: 100 } }), /320 km/);
});

test('logistics is not subject to the passenger fare cap; platform fee is 10%', () => {
  const q = quote('truck', { km: 50, min: 120 }, { parcel: { weightKg: 5000 } });
  assert.equal(q.legalCap, null);
  assert.ok(Math.abs(q.split.platformFee - q.gross * 0.1) < 0.01);
});

// ---------- vans & 4×4 jeeps ----------
const { canServe } = require('../src/dispatch');
const { SERVICES, VEHICLES } = require('../src/config');
const kyc = require('../src/kyc');

test('cargo van (800 kg, covered) and 4×4 jeep (1 t) are logistics services with weight limits and intercity rates', () => {
  assert.equal(SERVICES.van.logistics, true);
  assert.equal(SERVICES.jeep.logistics, true);
  assert.equal(quote('van', { km: 10, min: 30 }, { parcel: { weightKg: 500 } }).total, 950);
  assert.equal(quote('jeep', { km: 14, min: 45 }, { parcel: { weightKg: 600 } }).total, 1670);
  assert.throws(() => quote('van', { km: 5, min: 15 }, { parcel: { weightKg: 900 } }), /800 kg/);
  assert.throws(() => quote('jeep', { km: 5, min: 15 }, { parcel: { weightKg: 1200 } }), /1,000 kg/);
  assert.ok(quote('van', { km: 200, min: 300 }, { parcel: { weightKg: 600 } }).intercity);
  const at10 = (s) => quote(s, { km: 10, min: 30 }, { parcel: { weightKg: 300 } }).total;
  assert.ok(at10('cargo') < at10('van') && at10('van') < at10('pickup'), 'mini-truck < van < pickup');
  assert.ok(at10('jeep') > at10('pickup'), '4×4 hill premium: jeep only recommended for hill wards');
});

test('van and jeep need a matching goods-registered vehicle and licence category B', () => {
  const d = (type) => ({ verified: true, acceptsDelivery: true, vehicle: { type, fuel: type === 'van' ? 'petrol' : 'diesel', goodsPermit: true } });
  assert.equal(canServe(d('van'), 'van'), true);
  assert.equal(canServe(d('jeep'), 'jeep'), true);
  assert.equal(canServe(d('jeep'), 'van'), false);
  assert.equal(canServe({ ...d('van'), vehicle: { type: 'van', goodsPermit: false } }, 'van'), false);
  assert.deepEqual(VEHICLES.van.licence, ['B']);
  assert.deepEqual(VEHICLES.jeep.licence, ['B']);
});

test('hill wards are the low-density rural wards and include Sarangkot, Bhalam, Kaskikot, Chapakot', () => {
  for (const w of LOGISTICS.hillWards) assert.ok(wards.find((x) => x.ward === w).density < 800, `ward ${w}`);
  for (const w of [18, 20, 23, 24]) assert.ok(LOGISTICS.hillWards.includes(w));
});
