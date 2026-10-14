const test = require('node:test');
const assert = require('node:assert/strict');
const { haversineKm, inServiceArea, estimateRoute, route, alongPolyline, nearestPlace, places } = require('../src/geo');
const { canServe, findCandidates, hoursLeftToday } = require('../src/dispatch');
const { monthly, breakEvenTripsPerDay, SCENARIOS } = require('../src/economics');

const P = (id) => places.find((p) => p.id === id);

test('haversine: Lakeside to Prithvi Chowk is ~2.8 km straight line', () => {
  const d = haversineKm(P('lakeside'), P('prithvi-chowk'));
  assert.ok(d > 2.4 && d < 3.2, String(d));
});

test('all researched landmarks are inside the 20 km Gandaki service radius', () => {
  for (const p of places) assert.ok(inServiceArea(p), p.id);
});

test('points outside Pokhara are rejected (Kathmandu, Damauli, invalid)', () => {
  assert.equal(inServiceArea({ lat: 27.7172, lng: 85.324 }), false);
  assert.equal(inServiceArea({ lat: 27.9734, lng: 84.2667 }), false);
  assert.equal(inServiceArea({ lat: NaN, lng: 83.9 }), false);
});

test('fallback estimate uses the measured 1.33 detour factor', () => {
  const a = P('lakeside'); const b = P('mahendrapul');
  const e = estimateRoute(a, b);
  assert.ok(Math.abs(e.km - haversineKm(a, b) * 1.33) < 1e-9);
  assert.equal(e.source, 'estimate');
});

test('route() falls back to estimate when OSRM fails', async () => {
  const r = await route(P('damside'), P('bagar'), { fetchImpl: () => Promise.reject(new Error('offline')) });
  assert.equal(r.source, 'estimate');
});

test('route() parses an OSRM response and applies the traffic factor', async () => {
  const fake = async () => ({ json: async () => ({ code: 'Ok', routes: [{ distance: 5155, duration: 400, geometry: { coordinates: [[83.95, 28.2], [83.98, 28.21]] } }] }) });
  const offline = process.env.MYRIDE_OFFLINE;
  delete process.env.MYRIDE_OFFLINE;
  const r = await route({ lat: 28.2001, lng: 83.9501 }, { lat: 28.2101, lng: 83.9801 }, { fetchImpl: fake });
  if (offline !== undefined) process.env.MYRIDE_OFFLINE = offline;
  assert.equal(r.source, 'osrm');
  assert.equal(r.km, 5.155);
  assert.ok(Math.abs(r.min - (400 / 60) * 1.6) < 1e-9);
  assert.deepEqual(r.geometry[0], [28.2, 83.95]);
});

test('alongPolyline interpolates endpoints and middle', () => {
  const g = [[28.2, 83.9], [28.2, 84.0]];
  assert.deepEqual(alongPolyline(g, 0), { lat: 28.2, lng: 83.9 });
  assert.deepEqual(alongPolyline(g, 1), { lat: 28.2, lng: 84.0 });
  assert.ok(Math.abs(alongPolyline(g, 0.5).lng - 83.95) < 1e-9);
});

test('nearestPlace labels a pin near Damside', () => {
  assert.equal(nearestPlace({ lat: 28.1966, lng: 83.9667 }).id, 'damside');
});

const drv = (o) => ({ id: o.id || 'd', online: true, status: 'idle', verified: true, gender: 'male', rating: 4.8, loc: P('lakeside'), vehicle: { type: 'bike', fuel: 'petrol', seats: 1 }, ...o });

test('compliance: red-plate cars and >5 seat vehicles cannot serve rides', () => {
  assert.equal(canServe(drv({ vehicle: { type: 'car', fuel: 'petrol', seats: 4, publicPlate: false } }), 'car'), false);
  assert.equal(canServe(drv({ vehicle: { type: 'car', fuel: 'petrol', seats: 7, publicPlate: true } }), 'car'), false);
  assert.equal(canServe(drv({ vehicle: { type: 'car', fuel: 'petrol', seats: 4, publicPlate: true } }), 'car'), true);
  assert.equal(canServe(drv({ vehicle: { type: 'car', fuel: 'ev', seats: 4, publicPlate: true } }), 'car'), false);
  assert.equal(canServe(drv({ vehicle: { type: 'car', fuel: 'ev', seats: 4, publicPlate: true } }), 'car_ev'), true);
  assert.equal(canServe(drv({ verified: false }), 'bike'), false);
});

test('bikes carry parcels, cargo trucks carry cargo, not the other way round', () => {
  assert.equal(canServe(drv({}), 'parcel_express'), true);
  assert.equal(canServe(drv({ acceptsDelivery: false }), 'parcel_express'), false);
  assert.equal(canServe(drv({}), 'cargo'), false);
  assert.equal(canServe(drv({ vehicle: { type: 'cargo', fuel: 'diesel' } }), 'cargo'), false, 'needs goods permit');
  assert.equal(canServe(drv({ vehicle: { type: 'cargo', fuel: 'diesel', goodsPermit: true } }), 'cargo'), true);
  assert.equal(canServe(drv({ vehicle: { type: 'truck', fuel: 'diesel', goodsPermit: true } }), 'truck'), true);
  assert.equal(canServe(drv({ vehicle: { type: 'truck', fuel: 'diesel', goodsPermit: true } }), 'pickup'), false);
  assert.equal(canServe(drv({ suspended: { reason: 'x' } }), 'bike'), false);
});

test('12-hour daily driving limit', () => {
  const now = Date.parse('2026-10-12T10:00:00Z');
  assert.equal(hoursLeftToday(drv({ shiftDate: '2026-10-12', onlineMinutesToday: 720 }), now), 0);
  assert.equal(hoursLeftToday(drv({ shiftDate: '2026-10-11', onlineMinutesToday: 720 }), now), 12);
  const c = findCandidates([drv({ shiftDate: '2026-10-12', onlineMinutesToday: 721 })], { serviceId: 'bike', pickup: P('lakeside') }, now);
  assert.equal(c.length, 0);
});

test('dispatch: nearest first, women-only filter, radius, exclusions', () => {
  const ds = [
    drv({ id: 'far', loc: P('bagar') }),
    drv({ id: 'near', loc: P('hallan-chowk') }),
    drv({ id: 'f', gender: 'female', loc: P('damside') }),
    drv({ id: 'outside', loc: P('begnas-lake') }),
    drv({ id: 'busy', status: 'on_trip', loc: P('lakeside') }),
  ];
  const c = findCandidates(ds, { serviceId: 'bike', pickup: P('lakeside') });
  assert.equal(c[0].driver.id, 'near');
  assert.ok(!c.some((x) => ['outside', 'busy'].includes(x.driver.id)));
  assert.deepEqual(findCandidates(ds, { serviceId: 'bike', pickup: P('lakeside'), womenOnly: true }).map((x) => x.driver.id), ['f']);
  assert.ok(!findCandidates(ds, { serviceId: 'bike', pickup: P('lakeside'), exclude: ['near'] }).some((x) => x.driver.id === 'near'));
});

test('economics: launch burns cash, month-12 target is profitable', () => {
  assert.ok(monthly(SCENARIOS.launch).ebitda < 0);
  assert.ok(monthly(SCENARIOS.mature).ebitda > 0);
  const be = breakEvenTripsPerDay(SCENARIOS.mature);
  assert.ok(be > 2000 && be < 8000, String(be));
});

test('economics: contribution take-rate stays well below Pathao-style 20% commission', () => {
  const m = monthly(SCENARIOS.mature);
  assert.ok(m.takeRate < 0.1, String(m.takeRate));
  assert.ok(m.driverPay / m.gmv > 0.8);
});

test('heading home: a Lekhnath driver in Lakeside only gets trips that move toward Lekhnath', () => {
  const home = P('talchowk');
  const d = drv({ id: 'h', loc: P('lakeside'), homeFilter: { lat: home.lat, lng: home.lng } });
  const toLekhnath = findCandidates([d], { serviceId: 'bike', pickup: P('hallan-chowk'), drop: P('budhibazar') });
  const toSarangkot = findCandidates([d], { serviceId: 'bike', pickup: P('hallan-chowk'), drop: P('sarangkot') });
  assert.equal(toLekhnath.length, 1);
  assert.equal(toSarangkot.length, 0);
});

test('simulator restarts demo drivers on a fresh shift even after 12+ hours online (no startup crash)', () => {
  const { Store } = require('../src/store');
  const { createService } = require('../src/service');
  const { startSimulator } = require('../src/simulator');
  const store = new Store(null);
  const svc = createService({ store });
  const first = startSimulator({ store, svc, routeFn: async () => null });
  first.stop();
  const today = new Date().toISOString().slice(0, 10);
  for (const d of store.all('drivers')) Object.assign(d, { shiftDate: today, onlineMinutesToday: 13 * 60 });
  const again = startSimulator({ store, svc, routeFn: async () => null });
  again.stop();
  assert.equal(again.count, first.count);
  assert.ok(store.all('drivers').every((d) => d.online));
});
