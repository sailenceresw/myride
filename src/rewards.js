// MyRide Plus membership, free first ride, referrals, ride credits and promo codes.
// Every discount is platform-funded: the driver is paid on the full pre-discount fare.
const crypto = require('crypto');
const { MEMBERSHIP, PROMOS, SERVICES } = require('./config');

const DAY = 86400000;
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

function referralCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let s = 'MR';
  for (let i = 0; i < 6; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}

function isMember(user, now) {
  const m = user?.membership;
  return !!(m && m.status === 'active' && m.expiresAt > now);
}

function membershipView(user, now) {
  const m = user.membership;
  const active = isMember(user, now);
  return {
    active,
    plan: active ? m.plan : 'free',
    label: active ? MEMBERSHIP.plans[m.plan]?.label || 'MyRide Plus' : 'Free',
    expiresAt: active ? m.expiresAt : null,
    autoRenew: active ? !!m.autoRenew : false,
    trial: active && !!m.trial,
    trialAvailable: !user.membershipHistory?.length,
    savedTotal: Math.round(user.membershipSaved || 0),
    freeCancellationsLeft: active ? Math.max(0, MEMBERSHIP.benefits.freeCancellationsPerMonth - (m.cancelsThisPeriod || 0)) : 0,
    plans: MEMBERSHIP.plans,
    benefits: MEMBERSHIP.benefits,
  };
}

// Activate or extend a plan after successful payment (or a free trial).
function activateMembership(user, planId, now, { trial = false, paymentRef = null } = {}) {
  const plan = MEMBERSHIP.plans[planId];
  if (!plan) throw httpErr(400, 'Unknown plan');
  if (trial && user.membershipHistory?.length) throw httpErr(409, 'Free trial is for first-time members only');
  const days = trial ? MEMBERSHIP.trialDays : plan.days;
  const start = isMember(user, now) ? user.membership.expiresAt : now; // stack on top of current period
  user.membership = { plan: planId, status: 'active', startedAt: now, expiresAt: start + days * DAY, autoRenew: !trial, trial, cancelsThisPeriod: 0 };
  user.membershipHistory = [...(user.membershipHistory || []), { plan: planId, at: now, trial, paid: trial ? 0 : plan.price, paymentRef }];
  return user.membership;
}

function cancelAutoRenew(user) {
  if (!user.membership) throw httpErr(409, 'No membership');
  user.membership.autoRenew = false;
  return user.membership;
}

function validatePromo(store, user, code, serviceId, now) {
  const p = store.get('promos', String(code || '').trim().toUpperCase());
  if (!p || !p.active) throw httpErr(400, 'Promo code not valid');
  if (p.expiresAt && p.expiresAt < now) throw httpErr(400, 'Promo code expired');
  if (p.usageLimit && (p.used || 0) >= p.usageLimit) throw httpErr(400, 'Promo code fully redeemed');
  if (user && p.oncePerUser && (user.promosUsed || []).includes(p.code)) throw httpErr(400, 'You already used this promo');
  if (p.newUsersOnly && user && user.completedTrips > 0) throw httpErr(400, 'Promo is for new riders only');
  if (serviceId && p.services && !p.services.includes(serviceId)) throw httpErr(400, `${p.code} is only valid on ${p.services.map((s) => SERVICES[s]?.label || s).join(', ')}`);
  return p;
}

/**
 * Build the discount stack for a trip, in order:
 *   1. MyRide Plus member discount   2. first-ride-free OR promo code   3. ride credits
 */
function discountsFor({ store, user, serviceId, promoCode, useCredits = true, now }) {
  const out = [];
  if (!user) {
    if (promoCode) { const p = validatePromo(store, null, promoCode, serviceId, now); out.push({ ...promoDiscount(p), code: p.code }); }
    return out;
  }
  if (isMember(user, now)) {
    out.push({ kind: 'membership', label: 'MyRide Plus 5%', pct: MEMBERSHIP.benefits.rideDiscountPct, maxOff: MEMBERSHIP.benefits.maxDiscountPerTrip });
  }
  if (promoCode) {
    const p = validatePromo(store, user, promoCode, serviceId, now);
    out.push({ ...promoDiscount(p), code: p.code });
  } else if (!user.completedTrips && !user.firstRideFreeUsed) {
    out.push({ kind: 'free_ride', label: 'First ride free', pct: 1, maxOff: PROMOS.firstRideFree.maxOff, firstRide: true });
  }
  if (useCredits && user.credits > 0) out.push({ kind: 'credit', label: 'MyRide credits', amount: user.credits });
  return out;
}

function promoDiscount(p) {
  if (p.type === 'flat') return { kind: 'promo', label: `Promo ${p.code}`, amount: p.value, maxOff: p.maxOff };
  if (p.type === 'free_ride') return { kind: 'free_ride', label: `Free ride (${p.code})`, pct: 1, maxOff: p.maxOff };
  return { kind: 'promo', label: `Promo ${p.code}`, pct: p.value, maxOff: p.maxOff };
}

// Record what was actually used when the trip completes (discounts are re-applied to the final fare).
function settleDiscounts({ store, user, applied, requested, now }) {
  for (const a of applied) {
    if (a.kind === 'credit') user.credits = Math.max(0, Math.round((user.credits - a.amount) * 100) / 100);
    if (a.kind === 'membership') user.membershipSaved = (user.membershipSaved || 0) + a.amount;
  }
  const promo = requested.find((d) => d.code);
  if (promo && applied.some((a) => a.kind === 'promo' || a.kind === 'free_ride')) {
    const p = store.get('promos', promo.code);
    if (p) p.used = (p.used || 0) + 1;
    user.promosUsed = [...new Set([...(user.promosUsed || []), promo.code])];
  }
  if (requested.some((d) => d.firstRide) && applied.some((a) => a.kind === 'free_ride')) user.firstRideFreeUsed = true;
  user.completedTrips = (user.completedTrips || 0) + 1;

  // Referral reward on the referred rider's first completed trip.
  if (user.completedTrips === 1 && user.referredBy) {
    const ref = store.get('users', user.referredBy);
    const month = new Date(now).toISOString().slice(0, 7);
    if (ref) {
      ref.referralStats = ref.referralStats || {};
      const n = ref.referralStats[month] || 0;
      if (n < PROMOS.referral.maxPerReferrerPerMonth) {
        ref.credits = (ref.credits || 0) + PROMOS.referral.referrerCredit;
        ref.referralStats[month] = n + 1;
        ref.referralEarned = (ref.referralEarned || 0) + PROMOS.referral.referrerCredit;
        return { referrerId: ref.id, credit: PROMOS.referral.referrerCredit };
      }
    }
  }
  return null;
}

function applyReferral(store, user, code) {
  if (user.referredBy) throw httpErr(409, 'Referral already applied');
  if (user.completedTrips > 0) throw httpErr(409, 'Referral codes can only be used before your first ride');
  const ref = store.all('users').find((u) => u.referralCode === String(code || '').trim().toUpperCase());
  if (!ref) throw httpErr(400, 'Referral code not found');
  if (ref.id === user.id) throw httpErr(400, 'You cannot refer yourself');
  user.referredBy = ref.id;
  return ref;
}

function seedPromos(store) {
  for (const p of PROMOS.defaults) if (!store.get('promos', p.code)) store.put('promos', { id: p.code, active: true, used: 0, ...p });
}

function createPromo(store, body) {
  const code = String(body.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(code)) throw httpErr(400, 'Code must be 4–16 letters/numbers');
  if (store.get('promos', code)) throw httpErr(409, 'Code already exists');
  if (!['percent', 'flat', 'free_ride'].includes(body.type)) throw httpErr(400, 'Type must be percent, flat or free_ride');
  const value = +body.value;
  if (body.type === 'percent' && !(value > 0 && value <= 0.5)) throw httpErr(400, 'Percent must be between 0 and 0.5');
  if (body.type === 'flat' && !(value > 0 && value <= 2000)) throw httpErr(400, 'Flat amount must be Rs 1–2,000');
  const p = {
    id: code, code, type: body.type, value: body.type === 'free_ride' ? 1 : value,
    maxOff: +body.maxOff || (body.type === 'flat' ? value : 100),
    oncePerUser: body.oncePerUser !== false, newUsersOnly: !!body.newUsersOnly,
    usageLimit: +body.usageLimit || null, expiresAt: body.expiresAt ? Date.parse(body.expiresAt) : null,
    services: Array.isArray(body.services) && body.services.length ? body.services.filter((s) => SERVICES[s]) : undefined,
    note: String(body.note || '').slice(0, 100), active: true, used: 0,
  };
  return store.put('promos', p);
}

module.exports = { referralCode, isMember, membershipView, activateMembership, cancelAutoRenew, validatePromo, discountsFor, settleDiscounts, applyReferral, seedPromos, createPromo };
