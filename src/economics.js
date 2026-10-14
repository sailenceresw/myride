// Monthly unit economics, 24-month projection and ROI for the Pokhara launch.
// v1 = original plan; v2 = revised plan (fees, lean costs, targeted promos, MyRide Plus, trucks, partnerships).
// Volumes are identical between v1 and v2 for rides/parcels so the comparison isolates business levers.
const { quote, maxFeeRate } = require('./pricing');
const { TAX, MEMBERSHIP, PROMOS, SERVICES, PAYROLL, GANDAKI } = require('./config');

// Average trip per service. Rides: 3.54 km mean core-city trip (OSRM), lengthened because 54% of residents
// live > 5 km road from the centre (ward data) — Lekhnath (wards 26–33) trips run 9–21 km.
const TRIP_PROFILE = {
  bike: { km: 4.2, min: 12 }, bike_ev: { km: 4.2, min: 12 },
  car: { km: 6.0, min: 15 }, car_ev: { km: 6.0, min: 15 },
  parcel_express: { km: 4.5, min: 13, parcel: { weightKg: 2 } }, parcel_standard: { km: 4.5, min: 13, parcel: { weightKg: 2 } },
  cargo: { km: 7, min: 25, parcel: { weightKg: 400 } },
  van: { km: 9, min: 28, parcel: { weightKg: 400 } }, // e-commerce & shop restocking, covered loads
  jeep: { km: 14, min: 45, parcel: { weightKg: 600 } }, // hill wards (Bhalam, Kaskikot, Chapakot…) and trailheads
  pickup: { km: 12, min: 35, parcel: { weightKg: 900, helpers: 1 } }, // house shifting, shop stock
  truck_light: { km: 40, min: 90, parcel: { weightKg: 2500, helpers: 2 } }, // mix of city + Syangja/Damauli/Baglung runs
  truck: { km: 150, min: 300, parcel: { weightKg: 7000 } }, // mix of Butwal/Chitwan/Kathmandu lanes
};

const VOLUMES = { // trips per day
  launch: { bike: 700, bike_ev: 250, car: 120, car_ev: 40, parcel_express: 150, parcel_standard: 120, cargo: 10, van: 6, jeep: 3, pickup: 8, truck_light: 3, truck: 1 },
  growth: { bike: 2000, bike_ev: 900, car: 350, car_ev: 150, parcel_express: 450, parcel_standard: 400, cargo: 30, van: 15, jeep: 8, pickup: 20, truck_light: 8, truck: 3 },
  mature: { bike: 3500, bike_ev: 1800, car: 600, car_ev: 300, parcel_express: 800, parcel_standard: 900, cargo: 60, van: 30, jeep: 15, pickup: 40, truck_light: 15, truck: 6 },
};
const NEW_LOGISTICS = ['van', 'jeep', 'pickup', 'truck_light', 'truck'];

// Volume-driven costs (DECISION / estimates — tune with live data).
const VARIABLE = {
  tripsPerSupportAgent: 1500, supportAgentCost: 32000, // Nepali/English call + chat support, 2 shifts
  insurancePerRide: 1.5, // group passenger accident cover (Gandaki rules require passenger insurance)
  supplyIncentiveRate: 0.02, // of ride GMV
  badDebtRate: 0.003, // unpaid dues, chargebacks, fraud
  cloudPerTrip: 0.15, // routing, maps, SMS beyond the fixed base
  joiningBonus: 300, // per new driver, paid after their 30th trip
};
const DRIVERS_JOINING = { launch: 250, growth: 150, mature: 100 };

const V1 = {
  label: 'v1 (original)',
  fees: { bike: { type: 'flat', amount: 8 }, bike_ev: { type: 'flat', amount: 5 }, car: { type: 'rate', rate: 0.08 }, car_ev: { type: 'rate', rate: 0.07 } },
  fixed: { team: 8 * 55000, officeAndUtilities: 60000, cloudMapsSms: 70000, insuranceCompliance: 50000, marketing: 250000 },
  promo: { model: 'blanket', pct: 0.2, maxOff: 30, share: { launch: 0.35, growth: 0.15, mature: 0.08 } },
  membership: false, partnerships: false, newLogistics: false,
};

const V2 = {
  label: 'v2 (revised)',
  fees: null, // use config SERVICES (bike Rs 10, EV bike Rs 7, car 10%, EV car 9%, trucks 10%)
  fixed: {
    team: 60000 + 2 * 30000 + 30000 + 40000 + 80000 + 20000, // ops lead, 2 support, KYC/onboarding, marketing exec, engineer, part-time accountant
    officeAndUtilities: 35000, // co-working, Lakeside/Chipledhunga
    cloudMapsSms: 55000,
    insuranceCompliance: 50000,
    marketing: 120000, // referral-led growth; ground activation in core wards + Lekhnath
  },
  // Months 1–3: hire as volume arrives — founder runs marketing, 1 support agent, no accountant yet.
  fixedLaunch: { team: 60000 + 30000 + 30000 + 80000, officeAndUtilities: 35000, cloudMapsSms: 45000, insuranceCompliance: 50000, marketing: 100000 },
  promo: {
    model: 'targeted',
    newRiders: { launch: 6000, growth: 4000, mature: 3000 }, // per month
    firstRideRedemption: 0.7,
    referralShare: 0.35, // of new riders arrive via a referral → Rs 50 credit to the referrer
    targetedShare: 0.03, avgTargeted: 20, // win-back / rain-day codes on 3% of trips
  },
  membership: { share: { launch: 0.015, growth: 0.04, mature: 0.06 }, yearlyMix: 0.3, tripsPerMember: 14 },
  partnerships: { launch: 0, growth: 50000, mature: 150000 }, // sponsored pins/offers: Lakeside hotels, restaurants, adventure operators
  newLogistics: true,
  newDriversPerMonth: { launch: 250, growth: 150, mature: 100 }, kycCostPerDriver: 120, // doc checks, police-report handling, SMS
};

function feeFor(version, svcId, fare) {
  const pf = (version.fees && version.fees[svcId]) || SERVICES[svcId].platformFee;
  const fee = pf.type === 'flat' ? pf.amount : fare * pf.rate;
  return Math.min(fee, fare * maxFeeRate(SERVICES[svcId]));
}

function monthly(stage = 'mature', version = V2, opts = {}) {
  if (typeof stage === 'object') { version = stage.version || V2; opts = { volumes: stage.perDay, ...opts }; stage = stage.stage || 'mature'; }
  const { days = 30, volumes = VOLUMES[stage], digitalShare = { launch: 0.3, growth: 0.4, mature: 0.5 }[stage] } = opts;
  let trips = 0, gmv = 0, feeNet = 0, gateway = 0, driverPay = 0, rideTrips = 0, rideGmv = 0;
  const byService = {};
  for (const [svc, perDay] of Object.entries(volumes)) {
    if (!version.newLogistics && NEW_LOGISTICS.includes(svc)) continue;
    const prof = TRIP_PROFILE[svc];
    const q = quote(svc, prof, { parcel: prof.parcel });
    const n = perDay * days;
    const fee = feeFor(version, svc, q.gross);
    const vat = (q.gross * TAX.vatOnTransport) / (1 + TAX.vatOnTransport);
    const fund = q.split.accidentFund ? q.gross * 0.01 : 0;
    const row = { trips: n, avgFare: q.total, gmv: n * q.total, feeNet: n * (fee / (1 + TAX.vatStandard) - (fund ? fee * 0.005 : 0)), driverPay: n * (q.gross - fee - vat - fund) };
    row.gateway = row.gmv * digitalShare * TAX.paymentGatewayRate;
    byService[svc] = row;
    trips += n; gmv += row.gmv; feeNet += row.feeNet; gateway += row.gateway; driverPay += row.driverPay;
    if (SERVICES[svc].kind === 'ride') { rideTrips += n; rideGmv += row.gmv; }
  }

  // Promotions (all platform-funded)
  let promo = 0;
  const p = version.promo;
  if (p.model === 'blanket') {
    for (const [svc, row] of Object.entries(byService)) promo += row.trips * p.share[stage] * Math.min(row.avgFare * p.pct, p.maxOff);
  } else {
    const avgRide = rideGmv / rideTrips;
    const newR = p.newRiders[stage];
    promo += newR * p.firstRideRedemption * Math.min(avgRide, PROMOS.firstRideFree.maxOff);
    promo += newR * p.referralShare * PROMOS.referral.referrerCredit * 0.9;
    promo += trips * p.targetedShare * p.avgTargeted;
  }

  // MyRide Plus
  let membershipRevenue = 0, membershipCost = 0, members = 0;
  if (version.membership) {
    const mau = rideTrips / 6;
    members = Math.round(mau * version.membership.share[stage]);
    const m = version.membership;
    const perMemberNet = ((1 - m.yearlyMix) * MEMBERSHIP.plans.plus_monthly.price + m.yearlyMix * (MEMBERSHIP.plans.plus_yearly.price / 12)) / (1 + TAX.vatStandard);
    membershipRevenue = members * perMemberNet;
    const avgFare = rideGmv / rideTrips;
    membershipCost = members * m.tripsPerMember * Math.min(avgFare * MEMBERSHIP.benefits.rideDiscountPct, MEMBERSHIP.benefits.maxDiscountPerTrip) + members * 5; // + waived cancel fees
  }
  const partnerships = version.partnerships ? version.partnerships[stage] / (1 + TAX.vatStandard) : 0;
  const kycCost = version.newDriversPerMonth ? version.newDriversPerMonth[stage] * version.kycCostPerDriver : 0;
  const activeDrivers = Math.round(trips / days / 14);
  const payoutFees = activeDrivers * 4.3 * TAX.bankTransferFee * (1 + TAX.vatStandard);

  // Costs that scale with volume (applied to v1 and v2 alike).
  const perDay = trips / days;
  const variable = {
    support: Math.ceil(perDay / VARIABLE.tripsPerSupportAgent) * VARIABLE.supportAgentCost,
    passengerInsurance: rideTrips * VARIABLE.insurancePerRide,
    supplyIncentives: rideGmv * VARIABLE.supplyIncentiveRate, // peak-hour / rain / Lekhnath-hub bonuses
    fraudBadDebt: gmv * VARIABLE.badDebtRate,
    cloudPerTrip: trips * VARIABLE.cloudPerTrip,
    driverJoiningBonus: (DRIVERS_JOINING[stage] || 0) * VARIABLE.joiningBonus,
  };
  const variableTotal = Object.values(variable).reduce((a, b) => a + b, 0);

  const fixedTotal = Object.values(stage === 'launch' && version.fixedLaunch ? version.fixedLaunch : version.fixed).reduce((a, b) => a + b, 0);
  const revenue = feeNet + membershipRevenue + partnerships;
  const contribution = revenue - promo - membershipCost - gateway - kycCost - payoutFees - variableTotal;
  const ebitda = contribution - fixedTotal;
  return {
    label: `${version.label} · ${stage}`, stage, version: version.label,
    trips, tripsPerDay: Math.round(trips / days), gmv: Math.round(gmv),
    feeRevenue: Math.round(feeNet), membershipRevenue: Math.round(membershipRevenue), partnerships: Math.round(partnerships), revenue: Math.round(revenue),
    promo: Math.round(promo), membershipCost: Math.round(membershipCost), gateway: Math.round(gateway), kycCost: Math.round(kycCost), payoutFees: Math.round(payoutFees),
    variable: Object.fromEntries(Object.entries(variable).map(([k, v]) => [k, Math.round(v)])), variableTotal: Math.round(variableTotal),
    contribution: Math.round(contribution), fixedCosts: fixedTotal, ebitda: Math.round(ebitda),
    members, takeRate: gmv ? contribution / gmv : 0, ebitdaMargin: revenue ? ebitda / revenue : 0,
    driverPay: Math.round(driverPay), breakEvenTripsPerDay: contribution > 0 ? Math.ceil(fixedTotal / (contribution / trips) / days) : Infinity,
    byService,
  };
}

// Lever-by-lever bridge from v1 to v2 at each stage (same ride/parcel volumes).
function compareVersions() {
  const steps = [
    ['v1 original plan', {}],
    ['Fees: bike Rs 8→10, EV bike 5→7, car 8→10%, EV car 7→9% (still < Pathao)', { fees: V2.fees }],
    ['Lean Pokhara team & costs (Rs 8.7 → 5.5 lakh/month; 4.5 lakh in launch)', { fixed: V2.fixed, fixedLaunch: V2.fixedLaunch }],
    ['Targeted promos: first ride free + referrals (not blanket 20% off)', { promo: V2.promo }],
    ['MyRide Plus (Rs 199.99/mo · Rs 1,999.99/yr)', { membership: V2.membership }],
    ['Logistics: vans, 4×4 jeeps, pickups, trucks, intercity lanes', { newLogistics: true, newDriversPerMonth: V2.newDriversPerMonth, kycCostPerDriver: V2.kycCostPerDriver }],
    ['Hotel/restaurant partnerships (Lakeside)', { partnerships: V2.partnerships }],
  ];
  const out = {};
  for (const stage of ['launch', 'growth', 'mature']) {
    let v = { ...V1, fees: V1.fees };
    out[stage] = steps.map(([label, change]) => {
      v = { ...v, ...change };
      const m = monthly(stage, v);
      return { label, ebitda: m.ebitda, revenue: m.revenue, contribution: m.contribution };
    });
  }
  return out;
}

// Volumes for month m (1..24): ramp launch→growth (m3→m6) →mature (m12), then +3%/month.
function volumesForMonth(m) {
  const lerp = (a, b, t) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] - a[k]) * t]));
  if (m <= 3) return Object.fromEntries(Object.entries(VOLUMES.launch).map(([k, v]) => [k, v * [0.6, 0.8, 1][m - 1]]));
  if (m <= 6) return lerp(VOLUMES.launch, VOLUMES.growth, (m - 3) / 3);
  if (m <= 12) return lerp(VOLUMES.growth, VOLUMES.mature, (m - 6) / 6);
  return Object.fromEntries(Object.entries(VOLUMES.mature).map(([k, v]) => [k, v * 1.03 ** (m - 12)]));
}
const stageForMonth = (m) => (m <= 3 ? 'launch' : m <= 9 ? 'growth' : 'mature');

function projection({ version = V2, months = 24, fleetCars = 0, fleetFromMonth = 7 } = {}) {
  let cum = 0, minCum = 0, breakEvenMonth = null, paybackMonth = null;
  const fleet = fleetUnitEconomics();
  const rows = [];
  for (let m = 1; m <= months; m++) {
    const stage = stageForMonth(m);
    let v = version;
    if (version === V2 && m > 6) v = { ...V2, fixed: { ...V2.fixed, marketing: 80000 } }; // launch marketing tapers
    const r = monthly(stage, v, { volumes: volumesForMonth(m) });
    let ebitda = r.ebitda;
    let capex = 0;
    if (fleetCars && m >= fleetFromMonth) {
      ebitda += fleetCars * fleet.doubleShift.marginPerMonth;
      if (m === fleetFromMonth) capex = fleetCars * fleet.downPayment;
    }
    cum += ebitda - capex;
    minCum = Math.min(minCum, cum);
    if (breakEvenMonth === null && ebitda > 0) breakEvenMonth = m;
    if (paybackMonth === null && m > 1 && cum >= 0 && minCum < 0) paybackMonth = m;
    rows.push({ month: m, stage, tripsPerDay: r.tripsPerDay, revenue: r.revenue, ebitda: Math.round(ebitda), capex, cumulative: Math.round(cum) });
  }
  const investment = -minCum; // peak cash needed
  return {
    version: version.label, fleetCars, rows,
    peakCashNeed: Math.round(investment), breakEvenMonth, paybackMonth,
    cumulative24: Math.round(cum),
    roi24: investment ? cum / investment : null, // cumulative cash at month 24 ÷ peak investment
    year2Ebitda: Math.round(rows.slice(12).reduce((s, r) => s + r.ebitda, 0)),
  };
}

// Salaried fleet EV car (company-owned, leased) — per vehicle per month.
function fleetUnitEconomics({ price = 3200000, downPct = 0.2, rate = 0.11, years = 5, tripsPerShift = 13, wage = PAYROLL.defaultMonthlyWage } = {}) {
  const loan = price * (1 - downPct), i = rate / 12, n = years * 12;
  const emi = (loan * i) / (1 - (1 + i) ** -n);
  const prof = TRIP_PROFILE.car_ev;
  const q = quote('car_ev', prof);
  const perShift = (shifts) => {
    const trips = tripsPerShift * shifts * PAYROLL.workDaysPerMonth;
    const revenue = (trips * q.gross) / (1 + TAX.vatOnTransport); // company is the transport provider; 5% VAT on fare
    const wages = shifts * (wage + wage * PAYROLL.basicShare * PAYROLL.ssfEmployer);
    const incentive = shifts * PAYROLL.workDaysPerMonth * Math.max(0, tripsPerShift - PAYROLL.tripIncentive.afterTripsPerDay) * PAYROLL.tripIncentive.perTrip;
    const energy = trips * (prof.km + 2) * 1.8; // 0.15 kWh/km × Rs 12; +2 km empty per trip
    const fixed = emi + (price * downPct) / n + 4000 /* insurance */ + 3000 /* service */ + 2000 /* hub parking */;
    const cost = wages + incentive + energy + fixed;
    return { trips, revenue: Math.round(revenue), wages: Math.round(wages + incentive), energy: Math.round(energy), vehicle: Math.round(fixed), marginPerMonth: Math.round(revenue - cost) };
  };
  return { vehiclePrice: price, downPayment: Math.round(price * downPct), emi: Math.round(emi), avgFare: q.total, singleShift: perShift(1), doubleShift: perShift(2) };
}

const SCENARIOS = { launch: { stage: 'launch', version: V2 }, growth: { stage: 'growth', version: V2 }, mature: { stage: 'mature', version: V2 } };
const FIXED_COSTS = V2.fixed;

function breakEvenTripsPerDay(s) { return monthly(s).breakEvenTripsPerDay; }

module.exports = { monthly, projection, compareVersions, fleetUnitEconomics, breakEvenTripsPerDay, SCENARIOS, FIXED_COSTS, TRIP_PROFILE, VOLUMES, V1, V2 };
