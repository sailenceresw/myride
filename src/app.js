const path = require('path');
const express = require('express');
const { createService, HttpError } = require('./service');
const { SERVICES, SAFETY, CITY, GANDAKI, FEDERAL_DRAFT, COMPLIANCE, VEHICLES, LOGISTICS, MEMBERSHIP, KYC, PAYROLL } = require('./config');
const { quote, gandakiCap, federalCap } = require('./pricing');
const { places, cities, navigationRoute, isValidPoint } = require('./geo');
const { createFiles } = require('./files');
const { monthly, projection, compareVersions, fleetUnitEconomics, SCENARIOS, FIXED_COSTS } = require('./economics');
const { batchCsv } = require('./payroll');
const payments = require('./payments');
const { createPush } = require('./push');

// In-process pub/sub for Server-Sent Events. Replace with Redis pub/sub when running >1 instance.
// Messages for a user with no open stream (app closed/backgrounded) go to `offline` → push notification.
function createBus(offline = () => {}) {
  const subs = new Map();
  return {
    subscribe(ch, res) { if (!subs.has(ch)) subs.set(ch, new Set()); subs.get(ch).add(res); },
    unsubscribe(ch, res) { subs.get(ch)?.delete(res); },
    emit(ch, msg) {
      if (!subs.get(ch)?.size) return offline(ch, msg);
      for (const res of subs.get(ch)) res.write(`data: ${JSON.stringify(msg)}\n\n`);
    },
  };
}

function createApp({ store, routeFn, navRouteFn = navigationRoute, now, rand, sms, face, pushFetch, uploadsDir = null, dev = process.env.NODE_ENV !== 'production' } = {}) {
  const push = createPush({ store, fetchImpl: pushFetch });
  const bus = createBus((ch, msg) => push.deliver(ch, msg));
  const adminPhones = (process.env.ADMIN_PHONES || (dev ? '9800000000' : '')).split(',').filter(Boolean);
  const files = createFiles(store, uploadsDir);
  const svc = createService({ store, bus, routeFn, now, rand, files, sms, face, isAdminPhone: (p) => adminPhones.includes(p) });
  svc.seedPromos();

  const app = express();
  app.disable('x-powered-by');
  // Behind N load balancers set TRUST_PROXY=N: only the last N X-Forwarded-For hops are trusted (client can't spoof req.ip).
  app.set('trust proxy', +process.env.TRUST_PROXY || false);
  app.use('/api/driver/application/documents', express.json({ limit: '2.2mb' }));
  app.use('/api/driver/face-check', express.json({ limit: '2.2mb' }));
  app.use('/api/trips', express.json({ limit: '2.2mb' })); // proof-of-delivery photo on complete
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // OSM tiles require a Referer (origin is enough)
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self)');
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
  const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;

  // Portal guards: each app has its own login session (rider app ≠ Drive app ≠ ops console).
  const guard = (portal) => (req, res, next) => {
    const s = svc.session(tokenOf(req));
    if (!s) return res.status(401).json({ error: 'Please log in' });
    if (portal && s.portal !== portal) {
      const where = { rider: 'the MyRide app', driver: 'the MyRide Drive portal', admin: 'the MyRide Ops console' }[portal];
      return res.status(403).json({ error: `Please sign in to ${where}`, portal: s.portal });
    }
    req.user = s.user;
    req.portal = s.portal;
    next();
  };
  const anyAuth = guard(null);
  const rider = guard('rider');
  const driver = guard('driver');
  const admin = (req, res, next) => guard('admin')(req, res, () => (req.user.roles.includes('admin') ? next() : res.status(403).json({ error: 'Admins only' })));

  // ---------- public ----------
  app.get('/api/health', (req, res) => res.json({ ok: true, city: CITY.name }));

  app.get('/api/config', wrap(async () => ({
    city: CITY,
    cities: Object.values(cities).map((c) => ({ id: c.id, name: c.name, active: c.active, province: c.province, wards: c.wards.length })),
    services: Object.fromEntries(Object.entries(SERVICES).map(([id, s]) => [id, { label: s.label, labelNe: s.labelNe, kind: s.kind, logistics: !!s.logistics, vehicle: s.vehicle, fuel: s.fuel, maxWeightKg: s.maxWeightKg, base: s.base, perKm: s.perKm, intercityPerKm: s.intercityPerKm, flat: s.flat, minFare: s.minFare }])),
    vehicles: VEHICLES,
    logistics: { ...LOGISTICS },
    membership: MEMBERSHIP,
    safety: SAFETY,
    regulation: { maxRadiusKm: CITY.maxRadiusKm, maxDriverHoursPerDay: GANDAKI.maxDriverHoursPerDay, fareSchedule: { bike: GANDAKI.bike, car: GANDAKI.car }, discounts: GANDAKI.discount },
    kyc: { banks: KYC.banks, documents: KYC.documents },
    payroll: { defaultWage: PAYROLL.defaultMonthlyWage, minimumWage: PAYROLL.minimumWageMonthly, overtimeMultiplier: PAYROLL.overtimeMultiplier },
    fixedRoutes: await svc.fixedRoutes(),
    promos: store.all('promos').filter((p) => p.active).map(({ code, note }) => ({ code, note })),
  })));

  // Public fare chart: MyRide tariff vs Gandaki legal maximum vs national draft cap vs market, per vehicle.
  app.get('/api/fares', (req, res) => {
    const rows = ['bike', 'bike_ev', 'car', 'car_ev'].map((id) => {
      const s = SERVICES[id];
      return {
        id, label: s.label, labelNe: s.labelNe, fuel: s.fuel, base: s.base, perKm: s.perKm, minFare: s.minFare,
        samples: [1, 2, 3.5, 5, 7.5, 10, 15].map((km) => {
          const q = quote(id, { km, min: km * 3 });
          return { km, fare: q.total, gandakiMax: Math.round(gandakiCap(s.regClass, s.fuel, km)), federalMax: Number.isFinite(federalCap(s.regClass, km)) ? Math.round(federalCap(s.regClass, km)) : null, driver: Math.round(q.split.driver), competitors: q.competitors };
        }),
      };
    });
    res.json({ gandaki: GANDAKI, federalDraft: { ...FEDERAL_DRAFT, applied: COMPLIANCE.federalDraft }, rows });
  });

  app.get('/api/places', (req, res) => {
    const wards = cities.pokhara.wards.map((w) => ({ id: `ward-${w.ward}`, name: `Ward ${w.ward} · ${w.name}`, category: 'ward', lat: w.lat, lng: w.lng, ward: w.ward }));
    res.json([...places.map(({ osm, ...p }) => p), ...wards]);
  });
  app.get('/api/wards', (req, res) => res.json(cities.pokhara.wards.map(({ bbox, ...w }) => w)));
  app.get('/api/boundary', (req, res) => res.json(cities.pokhara.boundaryGeo));

  app.post('/api/quote', wrap((req) => {
    const s = svc.session(tokenOf(req));
    return svc.quoteAll(req.body, s?.portal === 'rider' ? s.user : null);
  }));

  app.get('/api/nearby', (req, res) => {
    const p = { lat: +req.query.lat, lng: +req.query.lng };
    if (!isValidPoint(p)) return res.status(400).json({ error: 'lat,lng required' });
    res.json(svc.nearbyDrivers(p));
  });

  app.get('/api/share/:token', (req, res) => {
    const t = store.all('trips').find((x) => x.shareToken === req.params.token);
    if (!t) return res.status(404).json({ error: 'Trip not found' });
    res.json(svc.publicView(t));
  });

  // ---------- auth ----------
  app.post('/api/auth/otp', wrap(async (req) => {
    const { code, provider } = await svc.requestOtp(req.body.phone, { ip: req.ip });
    // The code is only echoed back when no real SMS gateway is configured (local development).
    return dev && provider === 'console' ? { sent: true, devOtp: code } : { sent: true };
  }));
  app.post('/api/auth/verify', wrap((req) => {
    const { token, user, portal } = svc.verifyOtp(req.body.phone, req.body.otp, { name: req.body.name, portal: req.body.portal || 'rider', referralCode: req.body.referralCode });
    return { token, portal, user: svc.profile(user) };
  }));
  app.get('/api/me', anyAuth, (req, res) => res.json({ portal: req.portal, user: svc.profile(req.user) }));

  // ---------- realtime ----------
  app.get('/api/events', (req, res) => {
    const share = req.query.share;
    const s = share ? null : svc.session(tokenOf(req));
    if (!share && !s) return res.status(401).end();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    const channels = share ? [`share:${share}`] : [s.user.id, ...(s.portal === 'admin' ? ['admin'] : [])];
    channels.forEach((ch) => bus.subscribe(ch, res));
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); channels.forEach((ch) => bus.unsubscribe(ch, res)); });
  });
  // Expo push token of this device, per portal (the rider and Drive apps are separate installs).
  app.post('/api/push/token', anyAuth, (req, res) => {
    if (!push.register(req.user, req.body.token, req.portal)) return res.status(400).json({ error: 'Invalid Expo push token' });
    res.json({ ok: true });
  });
  app.delete('/api/push/token', anyAuth, (req, res) => { push.unregister(req.user, req.body.token); res.json({ ok: true }); });

  // ---------- rider: profile, membership, referral ----------
  app.get('/api/profile', rider, (req, res) => res.json(svc.profile(req.user)));
  app.patch('/api/profile', rider, wrap((req) => svc.updateProfile(req.user, req.body)));
  app.post('/api/profile/referral', rider, wrap((req) => svc.applyReferral(req.user, req.body.code)));
  app.post('/api/membership/trial', rider, wrap((req) => svc.startTrial(req.user, req.body.plan)));
  app.post('/api/membership/cancel', rider, wrap((req) => svc.cancelMembership(req.user)));
  app.post('/api/membership/checkout', rider, wrap(async (req) => {
    const order = svc.createMembershipOrder(req.user, req.body.plan);
    const origin = `${req.protocol}://${req.get('host')}`;
    const method = req.body.payment || 'esewa';
    if (method === 'sandbox') {
      if (!dev) throw new HttpError(400, 'Sandbox payments are disabled');
      svc.markOrderPaid(order.id, 'sandbox', 'DEV');
      return { provider: 'sandbox', profile: svc.profile(req.user) };
    }
    if (method === 'esewa') return { provider: 'esewa', ...payments.esewaForm({ amount: order.amount, uuid: order.id, successUrl: `${origin}/api/pay/esewa/success`, failureUrl: `${origin}/?payment=failed` }) };
    if (method === 'khalti') return { provider: 'khalti', ...(await payments.khaltiInitiate({ amount: order.amount, orderId: order.id, orderName: MEMBERSHIP.plans[order.plan].label, returnUrl: `${origin}/api/pay/khalti/return`, websiteUrl: origin, customer: { name: req.user.name, phone: req.user.phone } })) };
    throw new HttpError(400, 'Choose eSewa or Khalti');
  }));

  // ---------- rider: trips ----------
  app.post('/api/trips', rider, wrap(async (req) => svc.riderView(await svc.createTrip(req.user, req.body))));
  app.get('/api/trips', anyAuth, (req, res) => {
    const d = req.portal === 'driver' ? svc.driverOf(req.user) : null;
    const mine = store.all('trips').filter((t) => (req.portal === 'rider' && t.riderId === req.user.id) || (d && t.driverId === d.id)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    res.json(mine.map((t) => (req.portal === 'rider' ? svc.riderView(t) : svc.driverView(t, d))));
  });
  app.get('/api/trips/:id', anyAuth, wrap((req) => {
    const t = svc.getTripFor(req.user, req.params.id);
    return req.portal === 'driver' ? svc.driverView(t, svc.driverOf(req.user)) : svc.riderView(t);
  }));
  app.post('/api/trips/:id/cancel', anyAuth, wrap((req) => svc.riderView(svc.cancelTrip(req.user, req.params.id, req.body.reason))));
  app.post('/api/trips/:id/rate', anyAuth, wrap((req) => { svc.rateTrip(req.user, req.params.id, req.body.stars, req.body.comment); return { ok: true }; }));
  app.post('/api/trips/:id/sos', anyAuth, wrap((req) => ({ incident: svc.sos(req.user, req.params.id, req.body.loc), call: SAFETY })));

  // ---------- payments ----------
  app.post('/api/trips/:id/pay', rider, wrap(async (req) => {
    const t = svc.getTripFor(req.user, req.params.id);
    if (t.riderId !== req.user.id) throw new HttpError(403, 'Only the rider can pay');
    if (t.payment.method === 'cash') throw new HttpError(400, 'This trip is cash');
    if (t.payment.status === 'paid') throw new HttpError(409, 'Already paid');
    if (!t.fare) throw new HttpError(409, 'Nothing to pay — this ride was free');
    const origin = `${req.protocol}://${req.get('host')}`;
    const uuid = `${t.id}-${Date.now()}`;
    t.payment.ref = uuid;
    store.save();
    if (t.payment.method === 'esewa') return { provider: 'esewa', ...payments.esewaForm({ amount: t.fare, uuid, successUrl: `${origin}/api/pay/esewa/success`, failureUrl: `${origin}/?payment=failed` }) };
    if (t.payment.method === 'khalti') return { provider: 'khalti', ...(await payments.khaltiInitiate({ amount: t.fare, orderId: uuid, orderName: `MyRide ${t.service}`, returnUrl: `${origin}/api/pay/khalti/return`, websiteUrl: origin, customer: { name: req.user.name, phone: req.user.phone } })) };
    throw new HttpError(501, 'Fonepay dynamic QR needs a merchant account — coming soon');
  }));

  // Payment callbacks resolve either a trip (ref = trip payment ref) or a membership order (ref = order id).
  const settle = (ref, provider, txn, amount) => {
    if (store.get('orders', ref)) {
      const o = store.get('orders', ref);
      if (amount != null && Math.round(amount) !== Math.round(o.amount)) return 'amount_mismatch';
      svc.markOrderPaid(ref, provider, txn);
      return 'membership_active';
    }
    const t = store.all('trips').find((x) => x.payment.ref === ref);
    if (!t) return 'unknown';
    if (amount != null && Math.round(amount) !== Math.round(t.fare)) { t.payment.status = 'amount_mismatch'; store.save(); return 'amount_mismatch'; }
    t.payment = { ...t.payment, status: 'paid', provider, txn, paidAt: Date.now() };
    store.save();
    return 'paid';
  };
  app.get('/api/pay/esewa/success', (req, res) => {
    const data = payments.esewaVerify(req.query.data);
    if (!data || data.status !== 'COMPLETE') return res.redirect('/?payment=failed');
    res.redirect(`/?payment=${settle(data.transaction_uuid, 'esewa', data.transaction_code, +String(data.total_amount).replace(/,/g, ''))}`);
  });
  app.get('/api/pay/khalti/return', wrap(async (req, res) => {
    const look = await payments.khaltiLookup(req.query.pidx);
    res.redirect(`/?payment=${look.status === 'Completed' ? settle(req.query.purchase_order_id, 'khalti', look.transaction_id, look.total_amount / 100) : 'failed'}`);
  }));

  // ---------- files (owner or admin only) ----------
  app.get('/api/files/:id', anyAuth, (req, res) => {
    const f = files.read(req.params.id);
    if (!f) return res.status(404).json({ error: 'Not found' });
    if (f.rec.ownerId !== req.user.id && !(req.portal === 'admin' && req.user.roles.includes('admin'))) return res.status(403).json({ error: 'Forbidden' });
    res.setHeader('Content-Type', f.rec.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.end(f.buf);
  });

  // ---------- MyRide Drive portal ----------
  app.get('/api/driver/dashboard', driver, (req, res) => res.json(svc.driverDashboard(req.user)));
  app.get('/api/driver/application', driver, (req, res) => res.json(svc.getApplication(req.user)));
  app.put('/api/driver/application', driver, wrap((req) => svc.saveApplication(req.user, req.body)));
  app.post('/api/driver/application/documents', driver, wrap((req) => svc.uploadDocument(req.user, req.body.kind, req.body.data)));
  app.post('/api/driver/application/submit', driver, wrap((req) => svc.submitApplication(req.user)));
  app.post('/api/driver/face-check', driver, wrap((req) => svc.submitSelfie(req.user, req.body)));
  app.post('/api/driver/online', driver, wrap((req) => { const d = svc.setOnline(req.user, req.body.online, req.body.loc); return svc.driverDashboard(req.user).driver || d; }));
  // Turn-by-turn navigation for the native driver app (and rider ETA previews).
  app.get('/api/navigate', anyAuth, wrap(async (req) => {
    const p = (s) => { const [lat, lng] = String(s || '').split(',').map(Number); return { lat, lng }; };
    const from = p(req.query.from), to = p(req.query.to);
    if (!isValidPoint(from) || !isValidPoint(to)) throw new HttpError(400, 'from and to must be "lat,lng"');
    return navRouteFn(from, to);
  }));
  app.post('/api/driver/heading-home', driver, wrap((req) => { svc.setHomeFilter(req.user, req.body.loc || null); return svc.driverDashboard(req.user).driver; }));
  app.post('/api/driver/location', driver, wrap((req) => svc.updateLocation(req.user, req.body)));
  app.get('/api/driver/offers', driver, (req, res) => res.json(svc.offersFor(req.user)));
  app.post('/api/trips/:id/accept', driver, wrap((req) => svc.driverView(svc.acceptTrip(req.user, req.params.id), svc.driverOf(req.user))));
  app.post('/api/trips/:id/arrived', driver, wrap((req) => svc.driverView(svc.arrived(req.user, req.params.id), svc.driverOf(req.user))));
  app.post('/api/trips/:id/start', driver, wrap((req) => svc.driverView(svc.startTrip(req.user, req.params.id, req.body.pin), svc.driverOf(req.user))));
  app.post('/api/trips/:id/complete', driver, wrap(async (req) => svc.driverView(await svc.completeTrip(req.user, req.params.id, req.body), svc.driverOf(req.user))));

  // ---------- Ops console ----------
  app.get('/api/admin/stats', admin, (req, res) => res.json(svc.stats()));
  app.get('/api/admin/drivers', admin, (req, res) => res.json(store.all('drivers').map(({ faceDescriptor, ...d }) => d)));
  app.get('/api/admin/trips', admin, (req, res) => res.json(store.all('trips').sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(svc.riderView)));
  app.get('/api/admin/applications', admin, (req, res) => res.json(store.all('kyc').sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)).map(svc.kycView)));
  app.post('/api/admin/applications/:id/review', admin, wrap((req) => svc.reviewApplication(req.params.id, req.body, req.user)));
  app.post('/api/admin/drivers/:id/suspend', admin, wrap((req) => svc.suspendDriver(req.params.id, req.body.suspended !== false, req.body.reason)));
  app.post('/api/admin/drivers/:id/cash-deposit', admin, wrap((req) => svc.recordCashDeposit(req.params.id, req.body.amount)));
  app.get('/api/admin/fleet', admin, (req, res) => res.json(store.all('fleet')));
  app.post('/api/admin/fleet', admin, wrap((req) => svc.addFleetVehicle(req.body)));
  app.get('/api/admin/payouts', admin, (req, res) => res.json(store.all('payoutBatches').sort((a, b) => b.createdAt - a.createdAt)));
  app.post('/api/admin/payouts/run', admin, wrap(() => svc.runPayout()));
  app.get('/api/admin/payouts/:id/csv', admin, (req, res) => {
    const b = store.get('payoutBatches', req.params.id);
    if (!b) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="myride-payout-${b.weekId}.csv"`);
    res.send(batchCsv(b));
  });
  app.get('/api/admin/sms', admin, (req, res) => res.json(svc.smsLog()));
  app.get('/api/admin/promos', admin, (req, res) => res.json(store.all('promos')));
  app.post('/api/admin/promos', admin, wrap((req) => svc.createPromo(req.body)));
  app.get('/api/admin/economics', admin, (req, res) => res.json({
    fixedCosts: FIXED_COSTS,
    scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([k, s]) => [k, monthly(s)])),
    projection: projection(),
    comparison: compareVersions(),
    fleet: fleetUnitEconomics(),
    payroll: { minimumWage: PAYROLL.minimumWageMonthly, defaultWage: PAYROLL.defaultMonthlyWage },
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: (err.expose ?? status < 500) ? err.message : 'Something went wrong', ...(err.extra || {}) });
  });

  return { app, svc, bus };
}

module.exports = { createApp };
