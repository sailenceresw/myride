// MyRide business logic. Pure of HTTP so the API, the simulator and the tests share it.
const crypto = require('crypto');
const { SERVICES, DISPATCH, FIXED_ROUTES, GANDAKI, VEHICLES, MEMBERSHIP, LOGISTICS, PAYROLL, KYC, CITY, SAFETY } = require('./config');
const { route, inServiceArea, inLaunchCity, wardOf, isValidPoint, haversineKm, bearing, nearestPlace, places } = require('./geo');
const { quote, applyDiscounts, deadKmPay, fixedFare } = require('./pricing');
const { findCandidates, canServe, hoursLeftToday, isAvailable } = require('./dispatch');
const rewards = require('./rewards');
const kyc = require('./kyc');
const { createFaceVerifier } = require('./faceVerify');
const payroll = require('./payroll');
const { sendSms, templates, PHONE_RE } = require('./sms');

const ACTIVE = ['searching', 'accepted', 'arrived', 'in_progress'];
const MAX_OFFER_ROUNDS = 3;
const PORTALS = ['rider', 'driver', 'admin'];

// `expose`: show the message to clients even for 5xx (default: only 4xx messages are shown).
class HttpError extends Error {
  constructor(status, message, extra, expose = status < 500) { super(message); Object.assign(this, { status, expose }); if (extra) this.extra = extra; }
}
const fail = (status, msg, extra, expose) => { throw new HttpError(status, msg, extra, expose); };
const pin4 = () => String(crypto.randomInt(1000, 10000));
const r2 = (n) => Math.round(n * 100) / 100;
const kindOf = (svc) => (svc.kind === 'ride' ? 'ride' : svc.logistics ? 'logistics' : 'delivery');

const OTP = {
  ttlMs: 5 * 60 * 1000,
  resendMs: 60 * 1000, // one SMS per number per minute
  perPhonePerHour: 5,
  perIpPerHour: +process.env.OTP_IP_LIMIT || 20,
  maxTries: 5,
};

function createService({ store, bus = { emit() {} }, now = () => Date.now(), routeFn = route, files = null, isAdminPhone = () => false, rand = Math.random, sms = sendSms, face = createFaceVerifier(), otpSecret = process.env.OTP_SECRET || 'dev-otp-secret-change-me' }) {
  for (const c of ['ledger', 'kyc', 'fleet', 'payoutBatches', 'orders', 'files', 'otpLog', 'messages']) if (!store.db[c]) store.db[c] = {};
  if (!Array.isArray(store.db.smsLog)) store.db.smsLog = [];
  const otpHash = (phone, code) => crypto.createHmac('sha256', otpSecret).update(`${phone}:${code}`).digest('hex');

  // Fire-and-forget notification SMS; outcome logged for ops (newest 500 kept).
  function notify(phone, text, kind) {
    Promise.resolve(sms(phone, text)).then((r) => {
      store.db.smsLog.push({ at: now(), phone, kind, ok: !!r?.ok, provider: r?.provider, error: r?.error });
      if (store.db.smsLog.length > 500) store.db.smsLog.shift();
      store.save();
    }).catch(() => {});
  }
  const smsLog = (n = 100) => store.db.smsLog.slice(-n).reverse();

  // Sliding one-hour window per key; empty windows are deleted so the log can't grow without bound.
  function windowOf(key, t) {
    const w = (store.db.otpLog[key] || []).filter((x) => t - x < 3600000);
    if (w.length) store.db.otpLog[key] = w; else delete store.db.otpLog[key];
    return w;
  }

  // ---------- auth: one identity, separate portals (like Uber's rider app vs Driver app) ----------
  // OTP by SMS: rate-limited per number and per IP; only an HMAC of the code is stored.
  // Limits are reserved *before* the SMS is sent so concurrent requests can't slip past them.
  async function requestOtp(phone, { ip = 'unknown' } = {}) {
    if (!PHONE_RE.test(String(phone || ''))) fail(400, 'Enter a valid Nepali mobile number (98XXXXXXXX)');
    const t = now();
    const prev = store.db.otps[phone];
    if (prev && t - prev.sentAt < OTP.resendMs) fail(429, `Please wait ${Math.ceil((OTP.resendMs - (t - prev.sentAt)) / 1000)} s before requesting another code`);
    const byPhone = windowOf(`p:${phone}`, t), byIp = windowOf(`ip:${ip}`, t);
    if (byPhone.length >= OTP.perPhonePerHour) fail(429, 'Too many codes requested for this number. Try again in an hour');
    if (byIp.length >= OTP.perIpPerHour) fail(429, 'Too many requests from this network. Try again later');
    const code = String(crypto.randomInt(100000, 1000000));
    const rec = { hash: otpHash(phone, code), expires: t + OTP.ttlMs, tries: 0, sentAt: t };
    store.db.otps[phone] = rec;
    store.db.otpLog[`p:${phone}`] = [...byPhone, t];
    store.db.otpLog[`ip:${ip}`] = [...byIp, t];
    const r = await sms(phone, templates.otp(code));
    if (!r?.ok) {
      if (store.db.otps[phone] === rec) delete store.db.otps[phone]; // release the reservation; quota stays spent
      console.error(`[otp] SMS to ${phone} failed: ${r?.error}`);
      fail(503, 'Could not send the SMS right now — please try again in a minute', null, true);
    }
    rec.provider = r.provider;
    store.save();
    return { code, provider: r.provider };
  }

  function verifyOtp(phone, code, { name, portal = 'rider', referralCode } = {}) {
    if (!PORTALS.includes(portal)) fail(400, 'Unknown portal');
    const rec = store.db.otps[phone];
    if (!rec?.hash || rec.expires < now()) fail(400, 'OTP expired, request a new one'); // also old plain-code records
    if (++rec.tries > OTP.maxTries) { delete store.db.otps[phone]; fail(429, 'Too many wrong attempts — request a new code'); }
    const a = Buffer.from(rec.hash, 'hex'), b = Buffer.from(otpHash(phone, String(code || '')), 'hex');
    if (!crypto.timingSafeEqual(a, b)) { store.save(); fail(400, `Wrong code — ${OTP.maxTries - rec.tries} attempts left`); }
    delete store.db.otps[phone];
    let user = store.all('users').find((u) => u.phone === phone);
    if (portal === 'admin' && !(isAdminPhone(phone) || user?.roles.includes('admin'))) fail(403, 'This number is not an admin');
    if (!user) {
      user = store.put('users', {
        id: store.id('usr'), phone, name: (name || '').trim().slice(0, 60) || 'MyRide user', roles: ['rider'], createdAt: now(),
        ratings: { sum: 0, count: 0 }, promosUsed: [], credits: 0, completedTrips: 0, dues: 0, referralCode: rewards.referralCode(),
      });
      if (referralCode) { try { rewards.applyReferral(store, user, referralCode); } catch { /* invalid referral: ignore at signup */ } }
    }
    if (portal === 'admin' && !user.roles.includes('admin')) user.roles.push('admin');
    if (portal === 'driver' && !user.roles.includes('driver')) user.roles.push('driver');
    const token = crypto.randomBytes(24).toString('hex');
    store.db.sessions[token] = { userId: user.id, portal, created: now() };
    store.save();
    return { token, user, portal };
  }

  function session(token) {
    const s = token && store.db.sessions[token];
    if (!s) return null;
    const user = store.get('users', s.userId);
    return user ? { user, portal: s.portal || 'rider' } : null;
  }
  const userFromToken = (token) => session(token)?.user || null;

  // ---------- rider profile, membership, referrals ----------
  function profile(user) {
    return {
      id: user.id, name: user.name, phone: user.phone, email: user.email || '', business: user.business || null,
      credits: r2(user.credits || 0), dues: user.dues || 0, completedTrips: user.completedTrips || 0,
      firstRideFree: !user.completedTrips && !user.firstRideFreeUsed,
      referral: { code: user.referralCode, earned: user.referralEarned || 0, referredBy: !!user.referredBy },
      membership: rewards.membershipView(user, now()),
      driverApplication: kycOf(user) ? { status: kycOf(user).status } : null,
      isDriver: !!driverOf(user),
      closeContacts: user.closeContacts || [], // people this customer shared trips with, for one-tap sharing
    };
  }

  function updateProfile(user, body) {
    if (body.name) user.name = String(body.name).trim().slice(0, 60);
    if (body.email !== undefined) {
      if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) fail(400, 'Invalid email');
      user.email = String(body.email || '').slice(0, 120);
    }
    if (body.business !== undefined) {
      if (body.business === null) user.business = null;
      else {
        if (!/^\d{9}$/.test(String(body.business.pan || ''))) fail(400, 'PAN/VAT number must be 9 digits');
        user.business = { name: String(body.business.name || '').slice(0, 80), pan: String(body.business.pan) };
      }
    }
    store.save();
    return profile(user);
  }

  function applyReferral(user, code) { rewards.applyReferral(store, user, code); store.save(); return profile(user); }

  // Membership purchase: trial (no payment), or an order paid through eSewa/Khalti (sandbox confirm in dev).
  function createMembershipOrder(user, planId) {
    const plan = MEMBERSHIP.plans[planId] || fail(400, 'Unknown plan');
    return store.put('orders', { id: store.id('ord'), type: 'membership', userId: user.id, plan: planId, amount: plan.price, status: 'pending', createdAt: now() });
  }
  function startTrial(user, planId = 'plus_monthly') {
    rewards.activateMembership(user, planId, now(), { trial: true });
    store.save();
    return profile(user);
  }
  function markOrderPaid(orderId, provider, txn) {
    const o = store.get('orders', orderId);
    if (!o || o.status === 'paid') return o;
    o.status = 'paid'; o.provider = provider; o.txn = txn; o.paidAt = now();
    const user = store.get('users', o.userId);
    if (o.type === 'membership') rewards.activateMembership(user, o.plan, now(), { paymentRef: o.id });
    store.save();
    return o;
  }
  function cancelMembership(user) { rewards.cancelAutoRenew(user); store.save(); return profile(user); }

  /**
   * Delete a customer account (Google Play / App Store requirement): personal data removed, signed out everywhere.
   * Trip records stay for accounting and safety, without the person's name, number, notes, chats or contacts.
   * Riders (drivers) close their account through support: payouts, tax and KYC records must be settled first.
   */
  function deleteAccount(user) {
    if (driverOf(user)) fail(409, 'You are also a MyRide rider. Please contact MyRide support to close your rider account (payouts and records).');
    if (store.all('trips').some((t) => t.riderId === user.id && (ACTIVE.includes(t.status) || t.status === 'scheduled'))) fail(409, 'Finish or cancel your current or scheduled trip first');
    const mine = store.all('trips').filter((t) => t.riderId === user.id);
    const ids = new Set(mine.map((t) => t.id));
    for (const t of mine) {
      Object.assign(t, { riderName: 'Deleted user', riderPhone: null, note: undefined, sharedWith: undefined, business: null });
      if (t.recipient) t.recipient = { name: 'Recipient' };
    }
    for (const m of store.all('messages')) if (ids.has(m.tripId)) delete store.db.messages[m.id];
    for (const [token, s] of Object.entries(store.db.sessions)) if (s.userId === user.id) delete store.db.sessions[token];
    if (user.membership) rewards.cancelAutoRenew(user); // stop Plus renewing
    Object.assign(user, {
      name: 'Deleted user', phone: `deleted:${user.id}`, email: '', business: null, closeContacts: [], pushTokens: [],
      deletedAt: now(), roles: user.roles.filter((r) => r !== 'admin'),
    });
    store.save();
    return { deleted: true };
  }

  // ---------- quotes ----------
  function checkPoints(svc, pickup, drop) {
    if (!isValidPoint(pickup) || !isValidPoint(drop)) fail(400, 'Pickup and drop need lat/lng');
    if (!inLaunchCity(pickup)) fail(422, 'Pickups are available anywhere in Pokhara Metropolitan City (wards 1–33, incl. Lekhnath)');
    if (svc.kind === 'ride' && !inServiceArea(drop)) fail(422, 'Rides must stay within 20 km of Pokhara (Gandaki Province rule). For goods, use Logistics');
    if (svc.kind === 'delivery' && !svc.logistics && !inServiceArea(drop)) fail(422, 'Parcels deliver within 20 km of Pokhara. For intercity goods, use Logistics');
    if (haversineKm(pickup, drop) < 0.2) fail(400, 'Pickup and drop are too close');
  }

  // ---------- stops on the way (rides, like Uber: up to 2 before the destination) ----------
  const MAX_STOPS = 2;
  const STOP_MIN = 2; // minutes allowed at each stop in the time estimate
  function cleanStops(svc, stops) {
    if (stops === undefined || stops === null || (Array.isArray(stops) && !stops.length)) return [];
    if (!Array.isArray(stops)) fail(400, 'Stops must be a list');
    if (svc.kind !== 'ride') fail(400, 'Stops are for rides only');
    if (stops.length > MAX_STOPS) fail(400, `You can add up to ${MAX_STOPS} stops`);
    return stops.map((s, i) => {
      if (!isValidPoint(s)) fail(400, `Stop ${i + 1} needs a location`);
      if (!inServiceArea(s)) fail(422, `Stop ${i + 1} is beyond 20 km of Pokhara`);
      return { lat: s.lat, lng: s.lng, label: String(s.label || nearestPlace(s)?.name || wardOf(s)?.label || `Stop ${i + 1}`).slice(0, 80), ward: wardOf(s)?.ward ?? null };
    });
  }
  /** Road route through the stops: legs joined, distances and times added, a short wait at each stop. */
  async function routeVia(points) {
    const legs = [];
    for (let i = 1; i < points.length; i++) legs.push(await routeFn(points[i - 1], points[i]));
    if (legs.length === 1) return legs[0];
    return {
      km: legs.reduce((s, l) => s + l.km, 0),
      min: legs.reduce((s, l) => s + l.min, 0) + STOP_MIN * (legs.length - 1),
      geometry: legs.flatMap((l, i) => (i ? l.geometry.slice(1) : l.geometry)),
      source: legs.every((l) => l.source === legs[0].source) ? legs[0].source : 'mixed',
    };
  }

  function discountStack(user, serviceId, promoCode, useCredits) {
    return rewards.discountsFor({ store, user, serviceId, promoCode, useCredits, now: now() });
  }

  async function quoteAll({ pickup, drop, stops, kind = 'ride', parcel, promoCode, useCredits = true }, user) {
    const list = Object.entries(SERVICES).filter(([, s]) => kindOf(s) === kind);
    if (!list.length) fail(400, 'Unknown trip kind');
    checkPoints(list[0][1], pickup, drop);
    const via = cleanStops(list[0][1], stops);
    const r = await routeVia([pickup, ...via, drop]);
    const member = user && rewards.isMember(user, now());
    let promoError = null;
    const quotes = [];
    for (const [id, svc] of list) {
      let ds;
      try { ds = discountStack(user, id, promoCode, useCredits); } catch (e) { promoError = e.message; ds = discountStack(user, id, null, useCredits); }
      try {
        const near = findCandidates(store.all('drivers'), { serviceId: id, pickup, priority: member }, now());
        // Minutes for the nearest free driver to reach the pickup (city traffic speed), like Uber's "3 min away".
        const pickupMin = near.length ? Math.max(1, Math.round((near[0].pickupKm / CITY.fallbackSpeedKmh) * 60)) : null;
        quotes.push({ ...quote(id, r, { parcel, waiveCod: member, discounts: ds }), available: near.length, pickupMin, seats: svc.seats ?? null });
      } catch (e) {
        quotes.push({ service: id, label: svc.label, unavailable: e.message });
      }
    }
    // Hill / rough-road wards: recommend the 4×4 jeep for goods.
    const hill = [wardOf(pickup)?.ward, wardOf(drop)?.ward].some((w) => LOGISTICS.hillWards.includes(w));
    const recommend = kind === 'logistics' && hill ? 'jeep' : null;
    return {
      route: r, quotes, promoError, recommend,
      pickupPlace: nearestPlace(pickup)?.name || null, dropPlace: nearestPlace(drop)?.name || null,
      pickupWard: wardOf(pickup)?.label || null, dropWard: wardOf(drop)?.label || null,
    };
  }

  async function fixedRoutes() {
    const out = [];
    for (const { from, to } of FIXED_ROUTES) {
      const a = places.find((p) => p.id === from);
      const b = places.find((p) => p.id === to);
      const r = await routeFn(a, b);
      out.push({ from: a.name, to: b.name, km: +r.km.toFixed(2), bike: fixedFare('bike', r), car: fixedFare('car', r), car_ev: fixedFare('car_ev', r) });
    }
    return out;
  }

  // ---------- trips ----------
  async function createTrip(user, body) {
    const { service, pickup, drop, stops, payment = 'cash', womenOnly = false, scheduledAt, parcel, recipient, promoCode, note, useCredits = true } = body;
    const svc = SERVICES[service] || fail(400, 'Choose a service');
    if (!['cash', 'esewa', 'khalti', 'fonepay'].includes(payment)) fail(400, 'Unsupported payment method');
    if (store.all('trips').some((t) => t.riderId === user.id && ACTIVE.includes(t.status))) fail(409, 'You already have an active trip');
    checkPoints(svc, pickup, drop);
    const via = cleanStops(svc, stops);
    if (svc.kind === 'delivery') {
      if (!recipient || !recipient.name || !PHONE_RE.test(String(recipient.phone || ''))) fail(400, 'Recipient name and a valid mobile number are required');
      if (!parcel || !(parcel.weightKg > 0)) fail(400, 'Goods weight is required');
      if (parcel.codAmount && (svc.logistics || parcel.codAmount < 0 || parcel.codAmount > 50000)) fail(400, svc.logistics ? 'Cash-on-delivery is for parcels only' : 'Cash-on-delivery must be Rs 0–50,000');
      if (svc.logistics && parcel.goodsType && !LOGISTICS.goodsTypes.includes(parcel.goodsType)) fail(400, 'Unknown goods type');
    }
    let schedule = null;
    if (scheduledAt) {
      schedule = new Date(scheduledAt).getTime();
      const maxDays = svc.logistics ? 30 : 7;
      if (!Number.isFinite(schedule) || schedule < now() + 15 * 60 * 1000 || schedule > now() + maxDays * 86400000) fail(400, `Schedule between 15 minutes and ${maxDays} days ahead`);
    }
    const discounts = discountStack(user, service, promoCode, useCredits);
    const member = rewards.isMember(user, now());
    const r = await routeVia([pickup, ...via, drop]);
    const q = quote(service, r, { parcel, waiveCod: member, discounts });
    const dues = user.dues || 0;

    const label = (p) => p.label || nearestPlace(p)?.name || wardOf(p)?.label || 'Pinned location';
    const trip = {
      id: store.id('trp'),
      shareToken: crypto.randomBytes(8).toString('hex'),
      kind: svc.kind, logistics: !!svc.logistics, service,
      city: 'pokhara',
      riderId: user.id, riderName: user.name, riderPhone: user.phone, riderMember: member,
      business: user.business || null,
      pickup: { lat: pickup.lat, lng: pickup.lng, label: label(pickup), ward: wardOf(pickup)?.ward ?? null },
      drop: { lat: drop.lat, lng: drop.lng, label: drop.label || label(drop), ward: wardOf(drop)?.ward ?? null },
      stops: via, stopsDone: 0, // stops on the way; the driver marks each one done
      route: { km: r.km, min: r.min, geometry: r.geometry, source: r.source },
      quote: q,
      discountsRequested: discounts,
      dues,
      fare: q.total + dues,
      payment: { method: payment, status: payment === 'cash' ? 'collect_on_completion' : 'pending' },
      womenOnly: svc.kind === 'ride' && !!womenOnly,
      note: note ? String(note).slice(0, 200) : undefined,
      pin: pin4(), // rider tells driver this at pickup; trip cannot start without it
      status: schedule ? 'scheduled' : 'searching',
      scheduledAt: schedule,
      offeredTo: [], offerRound: 0, offerExpiresAt: 0,
      events: [{ at: now(), status: schedule ? 'scheduled' : 'searching' }],
      createdAt: now(),
    };
    if (svc.kind === 'delivery') {
      trip.parcel = {
        weightKg: +parcel.weightKg, size: parcel.size || 'small', fragile: !!parcel.fragile,
        helpers: Math.min(LOGISTICS.maxHelpers, Math.max(0, Math.round(+parcel.helpers || (parcel.helper ? 1 : 0)))),
        goodsType: parcel.goodsType || (svc.logistics ? 'general' : 'parcel'),
        declaredValue: +parcel.declaredValue || 0, insure: !!parcel.insure,
        description: String(parcel.description || '').slice(0, 120), codAmount: svc.logistics ? 0 : +parcel.codAmount || 0,
      };
      trip.recipient = { name: String(recipient.name).slice(0, 60), phone: recipient.phone };
      trip.deliveryOtp = pin4(); // sent to recipient by SMS; driver must enter it to complete
    }
    if (dues) user.dues = 0;
    store.put('trips', trip);
    if (trip.recipient) notify(trip.recipient.phone, templates.deliveryCode({ code: trip.deliveryOtp, sender: user.name, km: r.km.toFixed(1) }), 'delivery_code');
    if (!schedule) offer(trip);
    emitTrip(trip);
    return trip;
  }

  function offer(trip) {
    for (const id of trip.offeredTo) {
      const d = store.get('drivers', id);
      if (d && d.status === 'offered' && d.offerTripId === trip.id) { d.status = 'idle'; d.offerTripId = null; }
    }
    if (trip.offerRound >= MAX_OFFER_ROUNDS) { setStatus(trip, 'no_driver'); return; }
    const tried = trip.triedDrivers || [];
    const cands = findCandidates(store.all('drivers'), { serviceId: trip.service, pickup: trip.pickup, drop: trip.drop, womenOnly: trip.womenOnly, exclude: tried, priority: trip.riderMember }, now());
    trip.offerRound += 1;
    trip.offeredTo = cands.map((c) => c.driver.id);
    trip.triedDrivers = [...tried, ...trip.offeredTo];
    trip.offerExpiresAt = now() + DISPATCH.offerTimeoutSec * 1000;
    for (const c of cands) {
      c.driver.status = 'offered';
      c.driver.offerTripId = trip.id;
      bus.emit(c.driver.userId, { type: 'offer', trip: driverView(trip, c.driver, c.pickupKm) });
    }
    store.save();
  }

  // Periodic: scheduled releases, offer expiry, random selfie checks, membership expiry.
  function tick() {
    for (const t of store.all('trips')) {
      if (t.status === 'scheduled' && t.scheduledAt - now() <= (t.logistics ? 60 : 10) * 60 * 1000) { setStatus(t, 'searching'); offer(t); }
      else if (t.status === 'searching' && t.offerExpiresAt <= now()) { offer(t); emitTrip(t); }
    }
    for (const d of store.all('drivers')) {
      if (!d.online || d.simulated) continue;
      if (d.faceCheck?.pending && d.faceCheck.deadline < now() && d.status !== 'on_trip') {
        accrueOnline(d); d.online = false; d.onlineSince = null;
        if (d.status === 'offered') { d.status = 'idle'; d.offerTripId = null; }
        bus.emit(d.userId, { type: 'face_check', status: 'expired', message: 'You were taken offline — complete the selfie check to continue' });
      } else if (!d.faceCheck?.pending && d.status === 'idle' && rand() < KYC.randomCheck.perMinuteWhileOnline * (2 / 60)) {
        // tick runs every 2 s → scale the per-minute probability
        kyc.requestSelfie(d, now(), 'random_while_online');
        bus.emit(d.userId, { type: 'face_check', status: 'required', faceCheck: d.faceCheck });
      }
    }
    for (const u of store.all('users')) {
      if (u.membership?.status === 'active' && u.membership.expiresAt <= now()) u.membership.status = 'expired';
    }
  }

  function driverView(trip, driver, pickupKm) {
    pickupKm = pickupKm ?? (driver?.loc ? haversineKm(driver.loc, trip.pickup) * 1.33 : 0);
    const employee = driver?.driverType === 'employee';
    return {
      id: trip.id, kind: trip.kind, logistics: trip.logistics, service: trip.service, status: trip.status,
      pickup: trip.pickup, drop: trip.drop, stops: trip.stops || [], stopsDone: trip.stopsDone || 0, km: trip.route.km, min: trip.route.min, geometry: trip.route.geometry,
      fare: trip.fare,
      earning: employee ? null : trip.quote.split.driver, // fleet employees are paid wages, not per trip
      employee,
      pickupKm: +pickupKm.toFixed(2),
      deadKmBonus: employee ? 0 : deadKmPay(trip.service, pickupKm),
      payment: trip.payment.method,
      parcel: trip.parcel, recipient: trip.status === 'in_progress' ? trip.recipient : trip.recipient && { name: trip.recipient.name },
      riderName: trip.riderName, // no phone number: calls go through POST /api/trips/:id/call
      note: trip.note,
      offerExpiresAt: trip.offerExpiresAt,
    };
  }

  function riderView(trip) {
    const d = trip.driverId && store.get('drivers', trip.driverId);
    const { deliveryOtp, offeredTo, triedDrivers, discountsRequested, ...rest } = trip;
    return {
      ...rest,
      deliveryOtp: trip.kind === 'delivery' ? deliveryOtp : undefined, // sender shares it with the recipient
      // No phone number: calls go through POST /api/trips/:id/call (masked when a call bridge is configured).
      driver: d ? { id: d.id, name: d.name, gender: d.gender, rating: d.rating, vehicle: d.vehicle, loc: d.loc, heading: d.heading ?? null, fleet: d.driverType === 'employee', photo: !!d.faceRef } : null,
    };
  }

  function publicView(trip) {
    const d = trip.driverId && store.get('drivers', trip.driverId);
    return {
      status: trip.status, service: SERVICES[trip.service].label, pickup: trip.pickup.label, drop: trip.drop.label,
      geometry: trip.route.geometry, driver: d ? { name: d.name.split(' ')[0], plate: d.vehicle.plate, model: d.vehicle.model, type: d.vehicle.type, loc: d.loc } : null,
      updatedAt: trip.events.at(-1).at,
    };
  }

  function setStatus(trip, status, extra = {}) {
    trip.status = status;
    trip.events.push({ at: now(), status, ...extra });
    store.save();
    emitTrip(trip);
  }

  function emitTrip(trip) {
    bus.emit(trip.riderId, { type: 'trip', role: 'rider', trip: riderView(trip) });
    const d = trip.driverId && store.get('drivers', trip.driverId);
    if (d) bus.emit(d.userId, { type: 'trip', role: 'driver', trip: driverView(trip, d) });
    bus.emit(`share:${trip.shareToken}`, { type: 'trip', trip: publicView(trip) });
  }

  // ---------- calls between customer and rider (numbers stay private) ----------
  // With a call bridge (CALL_BRIDGE_NUMBER: a provider number whose IVR connects calls by trip code), neither side
  // ever sees the other's number. Without one, the number is handed out only for this call, during the trip.
  function callInfo(user, id) {
    const t = getTripFor(user, id);
    const from = chatRole(user, t);
    if (!CHAT_OPEN.includes(t.status) || !t.driverId) fail(409, 'You can call while the trip is on');
    const d = store.get('drivers', t.driverId);
    t.calls = [...(t.calls || []), { at: now(), from }].slice(-50);
    if (!t.callCode) t.callCode = String(crypto.randomInt(100000, 1000000)); // the bridge looks the trip up by this
    store.save();
    const bridge = process.env.CALL_BRIDGE_NUMBER;
    if (bridge) return { masked: true, dial: bridge, code: t.callCode };
    return { masked: false, dial: from === 'rider' ? d.phone : t.riderPhone };
  }
  /** For the call bridge provider: who to connect for a trip code and caller (only while the trip is on). */
  function bridgeLookup(code, callerPhone) {
    const t = store.all('trips').find((x) => x.callCode === String(code) && CHAT_OPEN.includes(x.status));
    if (!t) return null;
    const d = store.get('drivers', t.driverId);
    if (callerPhone === t.riderPhone) return { connect: d.phone, tripId: t.id };
    if (callerPhone === d.phone) return { connect: t.riderPhone, tripId: t.id };
    return null;
  }

  // ---------- chat between customer and rider during a trip ----------
  const CHAT_OPEN = ['accepted', 'arrived', 'in_progress'];
  const CHAT_MAX_PER_SENDER = 60;
  const DEMO_REPLIES = ["Okay 👍", "I'm on my way, about 2 minutes.", 'I can see you, coming now.', 'Please wait at the pickup point.'];

  /** Who `user` is on trip `t`: 'rider' (the customer — legacy server name) or 'driver'. */
  function chatRole(user, t) {
    if (t.riderId === user.id) return 'rider';
    const d = driverOf(user);
    if (d && t.driverId === d.id) return 'driver';
    return fail(403, 'Not your trip');
  }
  function messages(user, id) {
    const t = getTripFor(user, id);
    chatRole(user, t);
    return store.all('messages').filter((m) => m.tripId === t.id).sort((a, b) => a.at - b.at).map(({ id: mid, from, text, at }) => ({ id: mid, from, text, at }));
  }
  function sendMessage(user, id, text) {
    const t = getTripFor(user, id);
    const from = chatRole(user, t);
    if (!CHAT_OPEN.includes(t.status) || !t.driverId) fail(409, 'You can message once a rider has accepted, until the trip ends');
    text = String(text || '').trim().slice(0, 300);
    if (!text) fail(400, 'Write a message');
    if (store.all('messages').filter((m) => m.tripId === t.id && m.from === from).length >= CHAT_MAX_PER_SENDER) fail(429, 'Too many messages on this trip. Please call instead');
    const m = store.put('messages', { id: store.id('msg'), tripId: t.id, from, text, at: now() });
    store.save();
    const d = store.get('drivers', t.driverId);
    const to = from === 'rider' ? d.userId : t.riderId;
    const message = { id: m.id, from, text, at: m.at };
    // `role` is the recipient's role, as for trip events; `fromName` is for the push notification.
    bus.emit(to, { type: 'message', role: from === 'rider' ? 'driver' : 'rider', tripId: t.id, fromName: from === 'rider' ? t.riderName : d.name, message });
    // Demo fleet (SIMULATE=1): simulated riders answer so the chat can be tried end to end.
    const driverUser = store.get('users', d.userId);
    if (from === 'rider' && driverUser?.simulated) {
      setTimeout(() => { try { sendMessage(driverUser, t.id, DEMO_REPLIES[Math.floor(Math.random() * DEMO_REPLIES.length)]); } catch { /* trip ended */ } }, 2500);
    }
    return message;
  }

  function getTripFor(user, id) {
    const t = store.get('trips', id) || fail(404, 'Trip not found');
    const d = driverOf(user);
    if (t.riderId !== user.id && !(d && t.driverId === d.id) && !(d && t.offeredTo.includes(d.id)) && !user.roles.includes('admin')) fail(403, 'Not your trip');
    return t;
  }

  // ---------- driver ledger (wallet) ----------
  function post(driver, type, amount, meta = {}) {
    amount = r2(amount);
    if (!amount) return null;
    const e = store.put('ledger', { id: store.id('led'), driverId: driver.id, at: now(), type, amount, ...meta });
    driver.wallet = r2((driver.wallet || 0) + amount);
    return e;
  }

  function cancelTrip(user, id, reason = '') {
    const t = getTripFor(user, id);
    const d = t.driverId && store.get('drivers', t.driverId);
    const byDriver = d && d.userId === user.id;
    if (!['scheduled', 'searching', 'accepted', 'arrived'].includes(t.status)) fail(409, `Cannot cancel a trip that is ${t.status}`);
    const svc = SERVICES[t.service];
    let fee = 0, waived = false;
    if (!byDriver && t.status === 'arrived' && (now() - t.events.at(-1).at) / 60000 >= svc.waitFreeMin) {
      fee = svc.cancelFee;
      const rider = store.get('users', t.riderId);
      const m = rider.membership;
      if (rewards.isMember(rider, now()) && (m.cancelsThisPeriod || 0) < MEMBERSHIP.benefits.freeCancellationsPerMonth) {
        m.cancelsThisPeriod = (m.cancelsThisPeriod || 0) + 1; waived = true;
      } else rider.dues = (rider.dues || 0) + fee; // collected with the rider's next trip
    }
    for (const oid of t.offeredTo) {
      const od = store.get('drivers', oid);
      if (od && od.offerTripId === t.id) { od.status = 'idle'; od.offerTripId = null; }
    }
    if (d) {
      d.status = 'idle';
      d.currentTripId = null;
      if (fee && d.driverType !== 'employee') post(d, 'cancel_fee', fee, { tripId: t.id }); // driver paid even if a Plus waiver applied
    }
    if (t.dues) { const rider = store.get('users', t.riderId); rider.dues = (rider.dues || 0) + t.dues; }
    if (byDriver) {
      t.driverCancels = [...(t.driverCancels || []), { driverId: d.id, reason: String(reason).slice(0, 120), at: now() }];
      t.driverId = null; t.offerRound = 0; t.triedDrivers = [...(t.triedDrivers || []), d.id];
      if (t.dues) { const rider = store.get('users', t.riderId); rider.dues -= t.dues; }
      setStatus(t, 'searching', { note: 'driver_cancelled' });
      offer(t);
      return t;
    }
    t.cancellation = { by: 'rider', reason: String(reason).slice(0, 120), fee, waivedByPlus: waived };
    setStatus(t, 'cancelled');
    return t;
  }

  function rateTrip(user, id, stars, comment = '') {
    const t = getTripFor(user, id);
    if (t.status !== 'completed') fail(409, 'You can rate after the trip is completed');
    stars = Math.round(+stars);
    if (!(stars >= 1 && stars <= 5)) fail(400, 'Stars must be 1–5');
    const d = driverOf(user);
    if (t.riderId === user.id) {
      if (t.riderRating) fail(409, 'Already rated');
      t.riderRating = { stars, comment: String(comment).slice(0, 300) };
      const drv = store.get('drivers', t.driverId);
      drv.ratingCount += 1;
      drv.rating = +((drv.rating * (drv.ratingCount - 1) + stars) / drv.ratingCount).toFixed(2);
    } else if (d && t.driverId === d.id) {
      if (t.driverRating) fail(409, 'Already rated');
      t.driverRating = { stars };
      const rider = store.get('users', t.riderId);
      rider.ratings.sum += stars; rider.ratings.count += 1;
    }
    store.save();
    return t;
  }

  function sos(user, id, loc) {
    const t = getTripFor(user, id);
    const incident = { at: now(), by: user.id, loc: isValidPoint(loc) ? loc : null };
    t.sos = [...(t.sos || []), incident];
    store.save();
    bus.emit('admin', { type: 'sos', tripId: t.id, incident, rider: t.riderPhone });
    // Close ones the customer shared this trip with hear about it straight away.
    if (t.riderId === user.id) for (const c of t.sharedWith || []) notify(c.phone, templates.tripSos({ name: t.riderName, link: trackLink(t) }), 'trip_sos');
    return incident;
  }

  // ---------- share a trip with close ones (customer's choice, per trip) ----------
  const trackLink = (t) => `${SAFETY.publicUrl}/track.html?t=${t.shareToken}`;
  const localPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^977(?=9\d{9}$)/, '');
  function shareTrip(user, id, contacts) {
    const t = getTripFor(user, id);
    if (t.riderId !== user.id) fail(403, 'Only the customer can share this trip');
    if (!['searching', 'accepted', 'arrived', 'in_progress'].includes(t.status)) fail(409, 'You can share a trip while it is on');
    if (!Array.isArray(contacts) || !contacts.length) fail(400, 'Choose who to share with');
    const shared = t.sharedWith || [];
    const fresh = [];
    for (const c of contacts) {
      const phone = localPhone(c?.phone);
      if (!PHONE_RE.test(phone)) fail(400, `${c?.name || phone || 'That number'} is not a Nepali mobile number (98XXXXXXXX)`);
      if (phone === user.phone || shared.some((s) => s.phone === phone) || fresh.some((s) => s.phone === phone)) continue;
      fresh.push({ name: String(c.name || phone).trim().slice(0, 40), phone, at: now() });
    }
    if (shared.length + fresh.length > SAFETY.shareMax) fail(400, `You can share a trip with up to ${SAFETY.shareMax} people`);
    t.sharedWith = [...shared, ...fresh];
    const d = t.driverId && store.get('drivers', t.driverId);
    for (const c of fresh) notify(c.phone, templates.tripShared({ name: t.riderName, from: t.pickup.label, to: t.drop.label, driver: d?.name, plate: d?.vehicle.plate, link: trackLink(t) }), 'trip_share');
    // Remember them (most recent first) so next time sharing is one tap. Nothing is sent unless the customer chooses.
    const keep = [...fresh.map(({ name, phone }) => ({ name, phone })), ...(user.closeContacts || []).filter((c) => !fresh.some((f) => f.phone === c.phone))];
    user.closeContacts = keep.slice(0, 8);
    store.save();
    return { sharedWith: t.sharedWith.map(({ name, phone }) => ({ name, phone })) };
  }
  function forgetCloseContact(user, phone) {
    user.closeContacts = (user.closeContacts || []).filter((c) => c.phone !== localPhone(phone));
    store.save();
    return { closeContacts: user.closeContacts };
  }

  // ---------- driver onboarding & KYC ----------
  const driverOf = (user) => user && store.all('drivers').find((d) => d.userId === user.id);
  const kycOf = (user) => user && store.all('kyc').find((k) => k.userId === user.id);

  function kycView(app) {
    if (!app) return null;
    const { face, ...rest } = app;
    return { ...rest, face: face ? { selfie: !!face.selfieDescriptor, idPhoto: !!face.idDescriptor, liveness: face.liveness || null } : null, requiredDocuments: kyc.requiredDocs(app.driverType) };
  }

  function getApplication(user) { return kycView(kycOf(user)); }

  function saveApplication(user, body) {
    if (driverOf(user)) fail(409, 'You are already an approved driver');
    let app = kycOf(user);
    if (app && ['submitted', 'approved'].includes(app.status)) fail(409, `Application is ${app.status}`);
    if (!app) app = store.put('kyc', { id: store.id('kyc'), userId: user.id, phone: user.phone, status: 'draft', documents: {}, createdAt: now() });
    const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
    if (body.driverType) app.driverType = body.driverType;
    if (body.preferredVehicle) app.preferredVehicle = body.preferredVehicle;
    if (body.personal) app.personal = { ...app.personal, ...pick(body.personal, ['fullName', 'dob', 'gender', 'address', 'district', 'citizenshipNo', 'citizenshipDistrict', 'nidNo', 'emergencyContact']) };
    if (body.licence) app.licence = { ...app.licence, ...pick(body.licence, ['number', 'categories', 'expiry']) };
    if (body.vehicle) app.vehicle = { ...app.vehicle, ...pick(body.vehicle, ['type', 'fuel', 'plate', 'model', 'seats', 'publicPlate', 'bluebookNo', 'insuranceExpiry', 'goodsPermit']) };
    if (body.bank) app.bank = { ...app.bank, ...pick(body.bank, ['bank', 'branch', 'accountName', 'accountNumber']) };
    if (body.face) {
      const f = body.face;
      const okDesc = (x) => Array.isArray(x) && x.length === 128 && x.every(Number.isFinite);
      app.face = { ...app.face };
      if (f.selfieDescriptor !== undefined) { if (!okDesc(f.selfieDescriptor)) fail(400, 'Invalid face data — retake selfie'); app.face.selfieDescriptor = f.selfieDescriptor; }
      if (f.idDescriptor !== undefined) app.face.idDescriptor = okDesc(f.idDescriptor) ? f.idDescriptor : null;
      if (f.liveness !== undefined) app.face.liveness = { passed: !!f.liveness.passed, at: now() };
    }
    if (body.consent) app.consent = { at: now(), text: 'Background check (Nepal Police report), document verification and face matching' };
    if (app.status === 'resubmit') app.status = 'draft';
    app.updatedAt = now();
    store.save();
    return kycView(app);
  }

  function uploadDocument(user, kind, dataUrl) {
    const allowed = [...KYC.documents.common, ...KYC.documents.partner];
    if (!allowed.includes(kind)) fail(400, 'Unknown document type');
    if (!files) fail(500, 'File storage unavailable');
    const app = kycOf(user) || saveApplication(user, {}) && kycOf(user);
    if (['submitted', 'approved'].includes(app.status)) fail(409, `Application is ${app.status}`);
    const f = files.save(user.id, `kyc_${kind}`, dataUrl);
    app.documents[kind] = f.id;
    store.save();
    return { kind, fileId: f.id };
  }

  function submitApplication(user) {
    const app = kycOf(user) || fail(404, 'Start your application first');
    if (app.status === 'submitted') fail(409, 'Already submitted — we will review within 48 hours');
    const { errors, checks } = kyc.validateApplication(app, now());
    if (errors.length) fail(422, errors[0], { errors });
    app.checks = checks;
    app.status = 'submitted';
    app.submittedAt = now();
    store.save();
    bus.emit('admin', { type: 'kyc_submitted', id: app.id });
    if (process.env.MYRIDE_AUTO_VERIFY === '1' && app.driverType === 'partner' && checks.every((c) => c.ok)) reviewApplication(app.id, { decision: 'approve' }, null);
    return kycView(app);
  }

  function createDriverRecord(user, { driverType, vehicle, gender, licence, bank, faceDescriptor, faceRef, fleetVehicleId, monthlyWage, homeAddress = '', simulated = false }) {
    return store.put('drivers', {
      id: store.id('drv'), userId: user.id, name: user.name, phone: user.phone, driverType, simulated, homeAddress,
      gender: ['female', 'male', 'other'].includes(gender) ? gender : 'other',
      licence, bank: bank || null, faceDescriptor: faceDescriptor || null, faceRef: faceRef || null, // faceRef = enrolled selfie file
      vehicle: {
        type: vehicle.type, fuel: ['ev', 'petrol', 'diesel'].includes(vehicle.fuel) ? vehicle.fuel : ['bike', 'car', 'van'].includes(vehicle.type) ? 'petrol' : 'diesel',
        plate: String(vehicle.plate).toUpperCase().slice(0, 20), model: String(vehicle.model || '').slice(0, 40),
        seats: vehicle.type === 'car' ? +vehicle.seats || 4 : vehicle.type === 'bike' ? 1 : 2,
        publicPlate: !!vehicle.publicPlate, goodsPermit: !!vehicle.goodsPermit,
      },
      fleetVehicleId: fleetVehicleId || null,
      employment: driverType === 'employee' ? { monthlyWage: Math.max(PAYROLL.minimumWageMonthly, +monthlyWage || PAYROLL.defaultMonthlyWage), startedAt: now() } : null,
      acceptsDelivery: true, verified: true,
      online: false, status: 'idle', loc: null,
      rating: 5, ratingCount: 0, wallet: 0, cashHeld: 0, earnings: { today: 0, total: 0, trips: 0 },
      shiftDate: null, onlineMinutesToday: 0, onlineSince: null, shiftLog: {},
      faceCheck: { lastPassedAt: now(), failures: 0 },
      createdAt: now(),
    });
  }

  function reviewApplication(id, { decision, reason, fleetVehicleId, monthlyWage }, admin) {
    const app = store.get('kyc', id) || fail(404, 'Application not found');
    if (app.status !== 'submitted') fail(409, `Application is ${app.status}`);
    app.review = { by: admin?.id || 'auto', at: now(), decision, reason: reason ? String(reason).slice(0, 300) : undefined };
    if (decision === 'reject' || decision === 'resubmit') {
      if (!reason) fail(400, 'Give the applicant a reason');
      app.status = decision === 'reject' ? 'rejected' : 'resubmit';
      store.save();
      notify(app.phone, templates.kycAction(app.status, reason), 'kyc');
      return kycView(app);
    }
    if (decision !== 'approve') fail(400, 'Decision must be approve, reject or resubmit');
    const user = store.get('users', app.userId);
    let vehicle = app.vehicle;
    if (app.driverType === 'employee') {
      const fv = store.get('fleet', fleetVehicleId) || fail(400, 'Assign a MyRide fleet vehicle to this employee');
      if (fv.assignedDriverId) fail(409, 'That vehicle is already assigned');
      vehicle = fv;
    }
    if (vehicle.type === 'car') {
      const cars = store.all('drivers').filter((x) => x.vehicle.type === 'car' && x.verified).length;
      if (cars >= GANDAKI.carCapPerCompany) fail(422, 'Gandaki cap reached: 300 cars per company');
    }
    user.name = app.personal.fullName;
    const d = createDriverRecord(user, {
      driverType: app.driverType, vehicle, gender: app.personal.gender, licence: app.licence, bank: app.bank,
      faceDescriptor: app.face?.selfieDescriptor, faceRef: app.documents.selfie, fleetVehicleId: app.driverType === 'employee' ? fleetVehicleId : null, monthlyWage, homeAddress: app.personal.address,
    });
    if (app.driverType === 'employee') store.get('fleet', fleetVehicleId).assignedDriverId = d.id;
    app.status = 'approved';
    app.driverId = d.id;
    store.save();
    notify(app.phone, templates.kycApproved(d.name), 'kyc');
    return kycView(app);
  }

  function addFleetVehicle(body) {
    if (!VEHICLES[body.type]) fail(400, 'Unknown vehicle type');
    if (!body.plate) fail(400, 'Plate is required');
    if (body.type === 'car' && +body.seats > GANDAKI.maxSeats) fail(422, 'Max 5 seats');
    return store.put('fleet', {
      id: store.id('flt'), type: body.type, fuel: ['ev', 'petrol', 'diesel'].includes(body.fuel) ? body.fuel : ['bike', 'car', 'van'].includes(body.type) ? 'petrol' : 'diesel',
      plate: String(body.plate).toUpperCase(), model: String(body.model || ''), seats: +body.seats || (body.type === 'car' ? 4 : 1),
      publicPlate: true, goodsPermit: !['bike', 'car'].includes(body.type), leaseMonthly: +body.leaseMonthly || 0, assignedDriverId: null, createdAt: now(),
    });
  }

  // Simulator / seed helper (skips KYC paperwork, never used by the API).
  function seedDriver(user, opts) { return createDriverRecord(user, { driverType: 'partner', simulated: true, ...opts }); }

  // ---------- going online & face checks ----------
  function accrueOnline(d) {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (d.shiftDate !== today) { d.shiftDate = today; d.onlineMinutesToday = 0; d.earnings.today = 0; }
    if (d.online && d.onlineSince) {
      const mins = (now() - d.onlineSince) / 60000;
      d.onlineMinutesToday += mins;
      d.shiftLog = d.shiftLog || {};
      const log = (d.shiftLog[today] = d.shiftLog[today] || { minutes: 0, trips: 0 });
      log.minutes += mins;
      d.onlineSince = now();
    }
  }

  function setOnline(user, online, loc) {
    const d = driverOf(user) || fail(403, 'Your driver application is not approved yet');
    if (online && d.suspended) fail(403, d.suspended.reason);
    accrueOnline(d);
    if (online) {
      if (hoursLeftToday(d, now()) <= 0) fail(403, 'You reached the 12-hour daily limit (Gandaki rule). Rest and come back tomorrow');
      if (loc) { if (!inLaunchCity(loc)) fail(422, 'Go online inside Pokhara Metropolitan City'); d.loc = { lat: loc.lat, lng: loc.lng }; }
      if (!d.loc) fail(400, 'Location is required to go online');
      if (!d.simulated) {
        if (!d.faceCheck?.pending) { const reason = kyc.selfieNeededAtGoOnline(d, now(), rand); if (reason) kyc.requestSelfie(d, now(), reason); }
        if (d.faceCheck?.pending) { store.save(); fail(428, 'Quick selfie check before you go online', { faceCheck: d.faceCheck }); }
      }
    } else {
      if (d.status === 'on_trip') fail(409, 'Finish your current trip first');
      if (d.status === 'offered') { d.status = 'idle'; d.offerTripId = null; }
    }
    d.online = !!online;
    d.onlineSince = online ? now() : null;
    store.save();
    return d;
  }

  async function submitSelfie(user, { descriptor, photo }) {
    const d = driverOf(user) || fail(403, 'Not a driver');
    if (face.serverSide && !photo) fail(400, 'Take a selfie photo');
    const saved = photo && files ? files.save(user.id, 'selfie_check', photo) : null;
    const bytes = (id) => (id && files?.read(id)?.buf) || null;
    const match = await face.verify({ descriptor, enrolled: d.faceDescriptor, history: d.faceCheck?.history, photo: bytes(saved?.id), reference: bytes(d.faceRef) });
    if (match.enrolled) d.faceDescriptor = descriptor;
    const res = kyc.verifySelfie(d, match, now());
    if (d.suspended) {
      if (d.online) { accrueOnline(d); d.online = false; d.onlineSince = null; }
      bus.emit('admin', { type: 'face_fail', driverId: d.id, name: d.name });
    }
    store.save();
    return { ...res, suspended: !!d.suspended, faceCheck: { pending: d.faceCheck.pending, failures: d.faceCheck.failures } };
  }

  // Heading-home filter: max 2 uses per day; cleared automatically when the driver reaches home.
  function setHomeFilter(user, loc) {
    const d = driverOf(user) || fail(403, 'Not a driver');
    if (!loc) { d.homeFilter = null; store.save(); return d; }
    if (!isValidPoint(loc) || !inServiceArea(loc)) fail(400, 'Choose a home location in the Pokhara area');
    const today = new Date(now()).toISOString().slice(0, 10);
    d.homeFilterUses = d.homeFilterUses?.date === today ? d.homeFilterUses : { date: today, n: 0 };
    if (d.homeFilterUses.n >= 2) fail(429, 'You can use "heading home" twice a day');
    d.homeFilterUses.n += 1;
    d.homeFilter = { lat: loc.lat, lng: loc.lng, ward: wardOf(loc)?.label || null };
    store.save();
    return d;
  }

  function updateLocation(user, loc) {
    const d = driverOf(user) || fail(403, 'Not a driver');
    if (!isValidPoint(loc)) fail(400, 'Invalid location');
    if (d.loc && haversineKm(d.loc, loc) > 0.005) d.heading = Math.round(bearing(d.loc, loc)); // moved > 5 m: keep the last real heading when parked
    d.loc = { lat: loc.lat, lng: loc.lng };
    accrueOnline(d);
    if (d.homeFilter && !d.currentTripId && haversineKm(d.loc, d.homeFilter) < 0.8) d.homeFilter = null; // arrived home
    if (d.currentTripId) { const t = store.get('trips', d.currentTripId); if (t) emitTrip(t); }
    store.save();
    return d.loc;
  }

  function offersFor(user) {
    const d = driverOf(user);
    if (!d) return [];
    return store.all('trips').filter((t) => t.status === 'searching' && t.offeredTo.includes(d.id)).map((t) => driverView(t, d));
  }

  function acceptTrip(user, id) {
    const d = driverOf(user) || fail(403, 'Not a driver');
    const t = store.get('trips', id) || fail(404, 'Trip not found');
    if (t.status !== 'searching') fail(409, 'This trip was already taken');
    if (!t.offeredTo.includes(d.id)) fail(403, 'This trip was not offered to you');
    if (d.faceCheck?.pending) fail(428, 'Complete your selfie check first', { faceCheck: d.faceCheck });
    if (!canServe(d, t.service)) fail(403, 'Your vehicle cannot serve this trip');
    for (const oid of t.offeredTo) {
      const od = store.get('drivers', oid);
      if (od && od.id !== d.id && od.offerTripId === t.id) { od.status = 'idle'; od.offerTripId = null; }
    }
    const pickupKm = d.loc ? haversineKm(d.loc, t.pickup) * 1.33 : 0;
    t.driverId = d.id;
    t.driverType = d.driverType;
    t.deadKmBonus = d.driverType === 'employee' ? 0 : deadKmPay(t.service, pickupKm);
    d.status = 'on_trip'; d.offerTripId = null; d.currentTripId = t.id;
    setStatus(t, 'accepted', { driverId: d.id });
    return t;
  }

  function ownTrip(user, id) {
    const d = driverOf(user) || fail(403, 'Not a driver');
    const t = store.get('trips', id) || fail(404, 'Trip not found');
    if (t.driverId !== d.id) fail(403, 'Not your trip');
    return { d, t };
  }

  function arrived(user, id) {
    const { t } = ownTrip(user, id);
    if (t.status !== 'accepted') fail(409, 'Trip is not in accepted state');
    setStatus(t, 'arrived');
    return t;
  }

  function startTrip(user, id, pin) {
    const { t } = ownTrip(user, id);
    if (t.status !== 'arrived') fail(409, 'Mark arrived first');
    if (String(pin) !== t.pin) fail(400, 'Wrong PIN — ask the customer for their 4-digit MyRide PIN');
    t.waitMin = (now() - t.events.at(-1).at) / 60000;
    setStatus(t, 'in_progress');
    return t;
  }

  /** Driver: done at the current stop, on to the next one (or the destination). */
  function nextStop(user, id) {
    const { t } = ownTrip(user, id);
    if (t.status !== 'in_progress') fail(409, 'Start the trip first');
    if ((t.stopsDone || 0) >= (t.stops || []).length) fail(409, 'No more stops: drive to the destination');
    t.stopsDone = (t.stopsDone || 0) + 1;
    t.events.push({ at: now(), status: 'in_progress', note: `stop_${t.stopsDone}_done` });
    store.save();
    emitTrip(t);
    return t;
  }

  async function completeTrip(user, id, { deliveryOtp, codCollected, podPhoto } = {}) {
    const { d, t } = ownTrip(user, id);
    if (t.status !== 'in_progress') fail(409, 'Trip has not started');
    if (t.kind === 'delivery') {
      if (String(deliveryOtp) !== t.deliveryOtp) fail(400, 'Wrong delivery code — ask the recipient for the code sent by SMS');
      if (t.parcel.codAmount && !codCollected) fail(400, `Collect Rs ${t.parcel.codAmount} cash-on-delivery first`);
      if (podPhoto && files) t.proofOfDelivery = files.save(d.userId, 'pod', podPhoto).id;
    }
    const rider = store.get('users', t.riderId);
    // Final fare includes waiting time; discounts are re-applied to the final amount (credits re-checked).
    const requested = (t.discountsRequested || []).map((x) => (x.kind === 'credit' ? { ...x, amount: rider.credits || 0 } : x));
    const base = quote(t.service, t.route, { parcel: t.parcel, waitMin: t.waitMin, waiveCod: t.riderMember });
    const final = applyDiscounts(base, requested);
    t.quote = final;
    t.fare = final.total + (t.dues || 0);
    rewards.settleDiscounts({ store, user: rider, applied: final.discounts, requested, now: now() });

    if (d.driverType === 'employee') {
      if (t.payment.method === 'cash') d.cashHeld = r2((d.cashHeld || 0) + t.fare);
      if (t.parcel?.codAmount) d.cashHeld = r2((d.cashHeld || 0) + t.parcel.codAmount);
    } else {
      post(d, 'trip_earning', final.split.driver, { tripId: t.id });
      post(d, 'bonus', t.deadKmBonus || 0, { tripId: t.id, note: 'long pickup' });
      if (t.payment.method === 'cash') post(d, 'cash_collected', -t.fare, { tripId: t.id });
      if (t.parcel?.codAmount) post(d, 'cod_held', -t.parcel.codAmount, { tripId: t.id });
      d.earnings.today += final.split.driver + (t.deadKmBonus || 0);
      d.earnings.total += final.split.driver + (t.deadKmBonus || 0);
    }
    if (t.parcel?.codAmount) {
      t.cod = { amount: t.parcel.codAmount, status: 'collected', settleTo: t.riderId };
      rider.codReceivable = r2((rider.codReceivable || 0) + t.parcel.codAmount);
    }
    t.payment.status = t.payment.method === 'cash' ? 'cash_collected' : t.payment.status === 'paid' ? 'paid' : 'due';
    accrueOnline(d);
    const today = new Date(now()).toISOString().slice(0, 10);
    d.shiftLog = d.shiftLog || {};
    (d.shiftLog[today] = d.shiftLog[today] || { minutes: 0, trips: 0 }).trips += 1;
    d.earnings.trips += 1;
    d.status = 'idle'; d.currentTripId = null;
    setStatus(t, 'completed', { fare: t.fare });
    for (const c of t.sharedWith || []) notify(c.phone, templates.tripArrived({ name: t.riderName, to: t.drop.label }), 'trip_arrived');
    return t;
  }

  function driverDashboard(user) {
    const d = driverOf(user);
    if (!d) return { driver: null, application: getApplication(user) };
    const { faceDescriptor, ...safe } = d;
    const week = payroll.previousWeek(now() + 7 * 86400000); // current (running) week
    const preview = d.driverType === 'employee' ? payroll.employeePayslip(d, week) : payroll.partnerPayslip(d, store.all('ledger'), week);
    const payouts = store.all('payoutBatches').flatMap((b) => b.items.filter((i) => i.driverId === d.id).map((i) => ({ week: b.week, amount: i.amount, status: b.status, payslip: i.payslip }))).slice(-12).reverse();
    return { driver: { ...safe, hoursLeftToday: r2(hoursLeftToday(d, now())) }, thisWeek: preview, payouts, ledger: store.all('ledger').filter((e) => e.driverId === d.id).slice(-30).reverse() };
  }

  // ---------- admin ----------
  // Uber-style "cars around you": available drivers within 3 km, position rounded to ~100 m, no identities.
  function nearbyDrivers(p) {
    const t = now(), round = (x) => Math.round(x * 1000) / 1000;
    return store.all('drivers')
      .filter((d) => isAvailable(d, t) && haversineKm(d.loc, p) <= 3)
      .slice(0, 25)
      .map((d) => ({ lat: round(d.loc.lat), lng: round(d.loc.lng), type: d.vehicle.type, ev: d.vehicle.fuel === 'ev', heading: d.heading ?? null }));
  }

  function stats() {
    const trips = store.all('trips');
    const done = trips.filter((t) => t.status === 'completed');
    const drivers = store.all('drivers');
    const cars = drivers.filter((d) => d.vehicle.type === 'car' && d.verified).length;
    const users = store.all('users');
    const byWard = {};
    for (const t of done) if (t.pickup.ward) byWard[t.pickup.ward] = (byWard[t.pickup.ward] || 0) + 1;
    const fleetRevenue = done.filter((t) => t.driverType === 'employee').reduce((s, t) => s + t.fare, 0);
    return {
      trips: { total: trips.length, completed: done.length, active: trips.filter((t) => ACTIVE.includes(t.status)).length, cancelled: trips.filter((t) => t.status === 'cancelled').length, noDriver: trips.filter((t) => t.status === 'no_driver').length, deliveries: done.filter((t) => t.kind === 'delivery' && !t.logistics).length, logistics: done.filter((t) => t.logistics).length },
      gmv: Math.round(done.reduce((s, t) => s + t.fare, 0)),
      platformRevenue: Math.round(done.filter((t) => t.driverType !== 'employee').reduce((s, t) => s + t.quote.split.platformFeeNetOfVat - t.quote.split.promoCost, 0)),
      fleetRevenue: Math.round(fleetRevenue),
      driverEarnings: Math.round(done.filter((t) => t.driverType !== 'employee').reduce((s, t) => s + t.quote.split.driver + (t.deadKmBonus || 0), 0)),
      discounts: Math.round(done.reduce((s, t) => s + t.quote.split.promoCost, 0)),
      members: users.filter((u) => rewards.isMember(u, now())).length,
      riders: users.length,
      drivers: { total: drivers.length, online: drivers.filter((d) => d.online).length, partners: drivers.filter((d) => d.driverType !== 'employee').length, employees: drivers.filter((d) => d.driverType === 'employee').length, ev: drivers.filter((d) => d.vehicle.fuel === 'ev').length, suspended: drivers.filter((d) => d.suspended).length },
      kyc: { submitted: store.all('kyc').filter((k) => k.status === 'submitted').length, approved: store.all('kyc').filter((k) => k.status === 'approved').length },
      byWard,
      compliance: { carsRegistered: cars, carCap: GANDAKI.carCapPerCompany, carCapOk: cars <= GANDAKI.carCapPerCompany, sosOpen: trips.filter((t) => t.sos?.length && ACTIVE.includes(t.status)).length },
    };
  }

  function suspendDriver(id, suspended, reason) {
    const d = store.get('drivers', id) || fail(404, 'Driver not found');
    if (suspended) { d.suspended = { at: now(), reason: reason || 'Suspended by MyRide' }; if (d.online && d.status !== 'on_trip') { accrueOnline(d); d.online = false; } }
    else { d.suspended = null; d.faceCheck = { ...(d.faceCheck || {}), pending: false, failures: 0 }; }
    store.save();
    return d;
  }

  function recordCashDeposit(id, amount) {
    const d = store.get('drivers', id) || fail(404, 'Driver not found');
    amount = +amount;
    if (!(amount > 0) || amount > (d.cashHeld || 0) + 0.01) fail(400, 'Deposit must be between Rs 1 and the cash held');
    d.cashHeld = r2(d.cashHeld - amount);
    store.save();
    return d;
  }

  function runPayout() {
    const batch = payroll.runWeeklyPayout({ store, now: now(), post });
    store.save();
    return batch;
  }

  return {
    requestOtp, verifyOtp, smsLog, nearbyDrivers, session, userFromToken, profile, updateProfile, deleteAccount, applyReferral,
    createMembershipOrder, startTrial, markOrderPaid, cancelMembership,
    quoteAll, fixedRoutes, createTrip, tick, offer, cancelTrip, rateTrip, sos,
    getApplication, saveApplication, uploadDocument, submitApplication, reviewApplication, addFleetVehicle, seedDriver,
    setOnline, submitSelfie, setHomeFilter, updateLocation, offersFor, acceptTrip, arrived, startTrip, completeTrip, driverDashboard,
    getTripFor, messages, sendMessage, callInfo, bridgeLookup, nextStop, shareTrip, forgetCloseContact, riderView, driverView, publicView, driverOf, kycOf, kycView, stats, suspendDriver, recordCashDeposit, runPayout, post,
    seedPromos: () => rewards.seedPromos(store), createPromo: (b) => rewards.createPromo(store, b), HttpError,
  };
}

module.exports = { createService, HttpError, PHONE_RE };
