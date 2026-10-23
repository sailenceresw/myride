const { GANDAKI, FEDERAL_DRAFT, COMPLIANCE, TAX, SERVICES, COMPETITORS, DISPATCH, LOGISTICS } = require('./config');

const round = (n) => Math.round(n * 100) / 100;
const httpErr = (msg) => Object.assign(new Error(msg), { status: 400 });

// Legal maximum fare for a ride under Gandaki rules, after the mandated petrol/EV discount.
function gandakiCap(regClass, fuel, km) {
  const t = GANDAKI[regClass];
  if (!t) return Infinity; // goods transport is not covered by the provincial passenger fare schedule
  const official = Math.max(t.minFare, t.base + t.perKm * km);
  const discount = fuel === 'ev' ? GANDAKI.discount.ev : GANDAKI.discount.petrol;
  return official * (1 - discount);
}

// National draft cap: Rs 25/km (two-wheeler) or Rs 55/km (four-wheeler), charging at least 2 km.
function federalCap(regClass, km) {
  const r = FEDERAL_DRAFT.perKmCap[regClass];
  return r && COMPLIANCE.federalDraft ? r * Math.max(km, FEDERAL_DRAFT.minChargeKm) : Infinity;
}

// Legal maximum = the stricter of the provincial schedule and the national draft.
function legalCap(regClass, fuel, km) {
  return Math.min(gandakiCap(regClass, fuel, km), federalCap(regClass, km));
}

function maxFeeRate(svc) {
  return svc.kind === 'ride' && COMPLIANCE.federalDraft ? Math.min(GANDAKI.maxPlatformFeeRate, FEDERAL_DRAFT.maxCommission) : GANDAKI.maxPlatformFeeRate;
}

function platformFeeFor(svc, fare) {
  const pf = svc.platformFee;
  const fee = pf.type === 'flat' ? pf.amount : fare * pf.rate;
  return Math.min(fee, fare * maxFeeRate(svc));
}

function distanceFare(svc, km) {
  const inc = svc.includedKm || 0;
  if (svc.logistics && km > LOGISTICS.intercityFromKm) {
    const city = svc.perKm * Math.max(0, LOGISTICS.intercityFromKm - inc);
    return { amount: city + svc.intercityPerKm * (km - LOGISTICS.intercityFromKm), intercity: true };
  }
  return { amount: svc.perKm * Math.max(0, km - inc), intercity: false };
}

function goodsExtras(svc, goods = {}, { waiveCod = false } = {}) {
  const items = [];
  const w = Number(goods.weightKg) || 0;
  if (w > svc.maxWeightKg) throw httpErr(`${svc.label} carries up to ${svc.maxWeightKg.toLocaleString('en-IN')} kg`);
  if (w > svc.includedKg && svc.perExtraKg) items.push(['Extra weight', Math.ceil(w - svc.includedKg) * svc.perExtraKg]);
  if (goods.fragile && svc.fragileFee) items.push(['Fragile handling', svc.fragileFee]);
  const helpers = Math.min(LOGISTICS.maxHelpers, Math.max(0, Math.round(goods.helpers ?? (goods.helper ? 1 : 0))));
  if (helpers && svc.logistics) items.push([`Loading helpers × ${helpers}`, helpers * LOGISTICS.helperFee]);
  if (goods.insure && goods.declaredValue > 0) items.push(['Goods-in-transit insurance', Math.max(LOGISTICS.insuranceMin, Math.round(goods.declaredValue * LOGISTICS.insuranceRate))]);
  if (goods.codAmount > 0 && !waiveCod) items.push(['Cash-on-delivery handling', Math.max(10, Math.round(goods.codAmount * 0.01))]);
  return items;
}

/**
 * Quote a trip (before discounts are applied).
 * @param {string} serviceId key of SERVICES
 * @param {{km:number, min:number}} route measured road distance/time
 * @param {object} opts { parcel, waitMin, stopWaits:[minutes at each stop], waiveCod, discounts:[...], promo (legacy single promo) }
 */
function quote(serviceId, route, opts = {}) {
  const svc = SERVICES[serviceId];
  if (!svc) throw httpErr(`Unknown service: ${serviceId}`);
  const km = Math.max(0, route.km);
  const lines = [];
  let tripFare;
  let intercity = false;

  if (svc.logistics && km > LOGISTICS.maxKm) throw httpErr(`Logistics covers up to ${LOGISTICS.maxKm} km from Pokhara`);
  if (svc.flat != null) {
    if (km > svc.maxKm) throw httpErr(`${svc.label} covers trips up to ${svc.maxKm} km; use Parcel Express`);
    tripFare = svc.flat;
    lines.push(['Flat same-day fare', svc.flat]);
  } else {
    const d = distanceFare(svc, km);
    intercity = d.intercity;
    tripFare = Math.max(svc.minFare, svc.base + d.amount);
    lines.push(['Base fare', svc.base], [`Distance ${round(km)} km${intercity ? ' (intercity rate)' : ''}`, round(d.amount)]);
    if (tripFare > svc.base + d.amount) lines.push(['Minimum fare top-up', round(tripFare - svc.base - d.amount)]);
  }

  // Never charge above the provincial legal maximum for passenger rides.
  const cap = legalCap(svc.regClass, svc.fuel, km);
  if (tripFare > cap) {
    lines.push(['Legal fare cap adjustment', round(cap - tripFare)]);
    tripFare = cap;
  }

  let extras = 0;
  if (svc.kind === 'delivery') {
    for (const [label, amt] of goodsExtras(svc, opts.parcel, opts)) {
      lines.push([label, amt]);
      extras += amt;
    }
  }

  const waitMin = Math.max(0, (opts.waitMin || 0) - svc.waitFreeMin);
  const waitFee = Math.round(waitMin) * svc.waitPerMin;
  if (waitFee) lines.push([`Waiting ${Math.round(waitMin)} min`, waitFee]);
  // Stops on the way: each gets the same free minutes as the pickup, then the same per-minute rate.
  const stopMin = (opts.stopWaits || []).reduce((s, m) => s + Math.max(0, m - svc.waitFreeMin), 0);
  const stopFee = Math.round(stopMin) * svc.waitPerMin;
  if (stopFee) lines.push([`Waiting at stops ${Math.round(stopMin)} min`, stopFee]);

  const gross = tripFare + extras + waitFee + stopFee;
  const platformFee = platformFeeFor(svc, gross);
  const vatTransport = (gross * TAX.vatOnTransport) / (1 + TAX.vatOnTransport);
  // Traffic Accident Fund (federal draft): 1% of each ride fare; the platform adds 0.5% of its own income.
  const fund = svc.kind === 'ride' && COMPLIANCE.federalDraft ? gross * FEDERAL_DRAFT.accidentFund.fromFare : 0;
  const fundPlatform = svc.kind === 'ride' && COMPLIANCE.federalDraft ? platformFee * FEDERAL_DRAFT.accidentFund.fromPlatform : 0;
  const driverEarning = gross - platformFee - vatTransport - fund;

  const q = {
    service: serviceId,
    label: svc.label,
    km: round(km),
    min: Math.round(route.min),
    intercity,
    lines: lines.map(([label, amount]) => ({ label, amount: round(amount) })),
    gross: round(gross),
    total: Math.round(gross),
    legalCap: Number.isFinite(cap) ? Math.round(cap) : null,
    discounts: [],
    split: {
      driver: round(driverEarning),
      platformFee: round(platformFee),
      platformFeeNetOfVat: round(platformFee / (1 + TAX.vatStandard) - fundPlatform),
      vatOnTransport: round(vatTransport),
      accidentFund: round(fund + fundPlatform),
      promoCost: 0,
    },
    driverCostEstimate: round(svc.costPerKm * km),
    driverNetPerKm: km ? round((driverEarning - svc.costPerKm * km) / km) : 0,
    competitors: compare(svc, km),
  };
  const discounts = [...(opts.discounts || [])];
  if (opts.promo) discounts.push(promoToDiscount(opts.promo));
  return applyDiscounts(q, discounts);
}

function promoToDiscount(p) {
  if (p.type === 'flat') return { kind: 'promo', label: `Promo ${p.code}`, amount: p.value, maxOff: p.maxOff };
  if (p.type === 'free_ride') return { kind: 'free_ride', label: `Free ride ${p.code || ''}`.trim(), pct: 1, maxOff: p.maxOff };
  return { kind: 'promo', label: `Promo ${p.code || ''}`.trim(), pct: p.value ?? p.pct, maxOff: p.maxOff };
}

/**
 * Apply discounts in order on the remaining amount. All are platform-funded:
 * the driver's earning and platform fee are computed on the pre-discount gross.
 * discount: { kind, label, pct? , amount?, maxOff? }
 */
function applyDiscounts(q, discounts) {
  let remaining = q.gross;
  const applied = [];
  for (const d of discounts) {
    if (!d || remaining <= 0) continue;
    let off = d.pct != null ? remaining * d.pct : d.amount || 0;
    off = Math.min(off, d.maxOff ?? Infinity, remaining);
    off = round(off);
    if (off <= 0) continue;
    remaining -= off;
    applied.push({ kind: d.kind, label: d.label, amount: off });
  }
  const discountTotal = round(q.gross - remaining);
  return {
    ...q,
    lines: [...q.lines, ...applied.map((a) => ({ label: a.label, amount: -a.amount }))],
    discounts: applied,
    total: Math.round(remaining),
    split: { ...q.split, promoCost: discountTotal },
  };
}

function compare(svc, km) {
  const list = svc.kind === 'ride' ? COMPETITORS[svc.regClass] : [];
  return (list || []).map((c) => ({ name: c.name, estimate: Math.round(c.estimate(km)), note: c.note }));
}

// Platform-funded pay to the driver for a long pickup.
function deadKmPay(serviceId, pickupKm) {
  const svc = SERVICES[serviceId];
  return round(Math.max(0, pickupKm - DISPATCH.freePickupKm) * svc.deadKmPay);
}

// Flat tourist fare: MyRide quote rounded down to the nearest Rs 10.
function fixedFare(serviceId, route) {
  return Math.floor(quote(serviceId, route).total / 10) * 10;
}

module.exports = { quote, applyDiscounts, promoToDiscount, gandakiCap, federalCap, legalCap, maxFeeRate, platformFeeFor, deadKmPay, fixedFare };
