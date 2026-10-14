// Demo fleet: simulated drivers parked at real Pokhara landmarks (core wards + Lekhnath) who accept offers and
// drive the real road route. Enabled with SIMULATE=1. Each leg is compressed to ~LEG_SEC seconds.
const { places, alongPolyline, haversineKm } = require('./geo');

const LEG_SEC = 20;
const BIKE = (fuel, model) => ({ type: 'bike', fuel, model });
const CAR = (fuel, model) => ({ type: 'car', fuel, model, seats: 4, publicPlate: true });
const GOODS = (type, model) => ({ type, fuel: 'diesel', model, goodsPermit: true });
const FLEET = [
  ['Ram Gurung', 'male', BIKE('petrol', 'Honda Shine 125'), 'lakeside'],
  ['Sita Pun', 'female', BIKE('ev', 'Yatri P1'), 'lakeside'],
  ['Bikash Thapa', 'male', BIKE('petrol', 'Bajaj Pulsar 150'), 'hallan-chowk'],
  ['Anita Shrestha', 'female', BIKE('petrol', 'Honda Dio'), 'damside'],
  ['Suman Adhikari', 'male', BIKE('ev', 'NIU MQi+'), 'prithvi-chowk'],
  ['Kiran Poudel', 'male', BIKE('petrol', 'TVS Apache 160'), 'chipledhunga'],
  ['Puja Gurung', 'female', BIKE('ev', 'Yadea G5'), 'mahendrapul'],
  ['Hari Baral', 'male', BIKE('petrol', 'Hero Splendor+'), 'new-road'],
  ['Dipak Rana', 'male', BIKE('petrol', 'Yamaha FZ'), 'srijana-chowk'],
  ['Laxmi Tamang', 'female', BIKE('petrol', 'Honda Activa'), 'bagar'],
  ['Nabin KC', 'male', BIKE('ev', 'Yatri P0'), 'zero-km'],
  ['Rajan Subedi', 'male', BIKE('petrol', 'Bajaj Platina'), 'pokhara-intl-airport'],
  ['Mohan Bhattarai', 'male', BIKE('petrol', 'Honda Shine 125'), 'budhibazar'], // Lekhnath hub
  ['Kamala Paudel', 'female', BIKE('ev', 'Yatri P1'), 'talchowk'],
  ['Santosh Lamichhane', 'male', BIKE('petrol', 'Bajaj Pulsar 150'), 'khudi'],
  ['Gopal Sharma', 'male', CAR('petrol', 'Suzuki Swift'), 'lakeside'],
  ['Mina Karki', 'female', CAR('petrol', 'Hyundai i10'), 'tourist-bus-park'],
  ['Prakash Bhandari', 'male', CAR('ev', 'BYD Atto 3'), 'prithvi-chowk'],
  ['Sunita Magar', 'female', CAR('ev', 'Tata Nexon EV'), 'damside'],
  ['Arjun Lama', 'male', CAR('petrol', 'Toyota Etios'), 'pokhara-intl-airport'],
  ['Binod Ale', 'male', CAR('petrol', 'Suzuki Dzire'), 'sisuwa'],
  ['Bishnu Paudel', 'male', GOODS('cargo', 'Tata Ace Gold'), 'mahendrapul'],
  ['Shyam Tiwari', 'male', GOODS('cargo', 'Mahindra Supro'), 'ramghat'],
  ['Krishna Thapa', 'male', GOODS('pickup', 'Mahindra Bolero Pickup'), 'prithvi-chowk'],
  ['Ramesh Shrestha', 'male', { type: 'van', fuel: 'petrol', model: 'Suzuki Super Carry', goodsPermit: true }, 'new-road'],
  ['Tek Bahadur Gurung', 'male', GOODS('jeep', 'Mahindra Bolero 4WD'), 'hemja'],
  ['Dil Bahadur Gurung', 'male', GOODS('truck_light', 'Tata 407'), 'birauta'],
  ['Hem Raj Sapkota', 'male', GOODS('truck', 'Tata LPT 1109'), 'budhibazar'],
];

function startSimulator({ store, svc, routeFn }) {
  const sims = [];
  FLEET.forEach(([name, gender, vehicle, at], i) => {
    const phone = `98000${String(10000 + i).slice(-5)}`;
    let user = store.all('users').find((u) => u.phone === phone);
    if (!user) user = store.put('users', { id: store.id('usr'), phone, name, roles: ['driver'], createdAt: Date.now(), ratings: { sum: 0, count: 0 }, promosUsed: [], credits: 0, completedTrips: 0, simulated: true });
    let d = svc.driverOf(user);
    if (!d) {
      d = svc.seedDriver(user, {
        gender, licence: { number: `04-06-${String(10000000 + i * 7919)}`, categories: ['A', 'B', 'F', 'G'] },
        vehicle: { ...vehicle, plate: vehicle.type === 'bike' ? `GA 1 PA ${4000 + i * 37}` : `GA 2 JA ${1200 + i * 53}` },
      });
      d.rating = +(4.6 + (i % 4) / 10).toFixed(1);
      d.ratingCount = 20 + i * 3;
    }
    const p = places.find((x) => x.id === at);
    d.status = 'idle'; d.currentTripId = null; d.offerTripId = null;
    svc.setOnline(user, true, { lat: p.lat + (Math.random() - 0.5) * 0.004, lng: p.lng + (Math.random() - 0.5) * 0.004 });
    sims.push({ user, driverId: d.id, leg: null, home: { lat: p.lat, lng: p.lng } });
  });

  const step = async (sim) => {
    const d = store.get('drivers', sim.driverId);
    if (!d) return;
    if (d.status === 'offered' && d.offerTripId) {
      const t = store.get('trips', d.offerTripId);
      if (t && t.status === 'searching' && Date.now() - (t.offerExpiresAt - 20000) > 3000) {
        try { svc.acceptTrip(sim.user, t.id); } catch { /* another driver won */ }
      }
      return;
    }
    if (!d.currentTripId) {
      // Reposition: idle demo drivers drift back to their home zone (keeps Lekhnath and the airport supplied).
      if (sim.leg?.phase !== 'return' && haversineKm(d.loc, sim.home) > 1) {
        const r = await routeFn(d.loc, sim.home);
        sim.leg = { phase: 'return', geometry: r.geometry, started: Date.now() };
      }
      if (sim.leg?.phase === 'return') {
        const f = (Date.now() - sim.leg.started) / (LEG_SEC * 2000);
        svc.updateLocation(sim.user, alongPolyline(sim.leg.geometry, f));
        if (f >= 1) sim.leg = null;
      }
      return;
    }
    if (sim.leg?.phase === 'return') sim.leg = null;
    const t = store.get('trips', d.currentTripId);
    if (!t) return;
    if (t.status === 'accepted' && !sim.leg) {
      const r = await routeFn(d.loc, t.pickup);
      sim.leg = { tripId: t.id, phase: 'to_pickup', geometry: r.geometry, started: Date.now() };
    } else if (t.status === 'arrived' && (!sim.leg || sim.leg.phase !== 'waiting')) {
      sim.leg = { tripId: t.id, phase: 'waiting', started: Date.now() };
    } else if (t.status === 'arrived' && Date.now() - sim.leg.started > 4000) {
      svc.startTrip(sim.user, t.id, t.pin); // the simulated customer tells the driver the PIN
      sim.leg = { tripId: t.id, phase: 'on_trip', geometry: t.route.geometry, started: Date.now() };
    } else if (t.status === 'in_progress' && (!sim.leg || sim.leg.phase !== 'on_trip')) {
      sim.leg = { tripId: t.id, phase: 'on_trip', geometry: t.route.geometry, started: Date.now() };
    }
    if (sim.leg && sim.leg.geometry) {
      const f = (Date.now() - sim.leg.started) / (LEG_SEC * 1000);
      svc.updateLocation(sim.user, alongPolyline(sim.leg.geometry, f));
      if (f >= 1) {
        if (sim.leg.phase === 'to_pickup' && t.status === 'accepted') svc.arrived(sim.user, t.id);
        if (sim.leg.phase === 'on_trip' && t.status === 'in_progress') await svc.completeTrip(sim.user, t.id, { deliveryOtp: t.deliveryOtp, codCollected: true });
        sim.leg = null;
      }
    }
  };

  const timer = setInterval(() => sims.forEach((s) => step(s).catch((e) => console.error('sim', e.message))), 1000);
  return { stop: () => clearInterval(timer), count: sims.length };
}

module.exports = { startSimulator };
