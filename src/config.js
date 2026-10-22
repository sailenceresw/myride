// MyRide — Pokhara launch configuration.
// Every number here is either sourced (see docs/RESEARCH.md) or a MyRide business decision (marked DECISION).
// All money is NPR. Fares are VAT-inclusive, as shown to the customer.

const CITY = {
  name: 'Pokhara',
  // Zero Kilometer, Pokhara (OSM/Nominatim). Centre for the provincial operating radius.
  centre: { lat: 28.21286, lng: 83.97548 },
  // Gandaki Province ride-sharing regulation: passenger vehicles may not operate beyond a 20 km radius.
  maxRadiusKm: 20,
  // Median road-distance / straight-line ratio measured over 1,362 Pokhara landmark pairs (OSRM).
  detourFactor: 1.33,
  // OSRM returns free-flow times; Pokhara city traffic is slower. DECISION, tune with live trip data.
  trafficFactor: 1.6,
  // Used when no route is available at all.
  fallbackSpeedKmh: 22,
};

// Cities. Launch: Pokhara Metropolitan City — all 33 wards (Pokhara-1…33), incl. former Lekhnath (wards 26–33).
// Boundary + wards are official OSM admin relations (tools/wards.js). The whole city lies within 18.4 km of
// Zero Kilometer, so the provincial 20 km operating radius covers every ward.
// Expansion: add a city with its boundary file and set active:true once its province's rules are encoded.
const CITIES = {
  pokhara: { name: 'Pokhara', province: 'gandaki', active: true, centre: { lat: 28.21286, lng: 83.97548 }, boundary: 'pokhara-boundary.json', wards: 'wards.json' },
  kathmandu: { name: 'Kathmandu Valley', province: 'bagmati', active: false, centre: { lat: 27.7172, lng: 85.324 }, note: 'Bagmati rules still in draft (2026)' },
  bharatpur: { name: 'Bharatpur', province: 'bagmati', active: false, centre: { lat: 27.6766, lng: 84.4353 } },
  butwal: { name: 'Butwal', province: 'lumbini', active: false, centre: { lat: 27.7006, lng: 83.4484 } },
};

// Gandaki Province fixed fares (Ministry of Physical Infrastructure Development & Transport Management,
// reported 31 May 2026) and mandated discounts (10% petrol, 15% electric). These are the legal maximum.
const GANDAKI = {
  // 'bike' = two-wheeler (motorcycle/scooter). Minimum fare covers the first 1 km (motorcycle) / 2 km (car).
  bike: { base: 30, perKm: 16.85, minFare: 46.85, minFareKm: 1 },
  car: { base: 60, perKm: 48.5, minFare: 156.5, minFareKm: 2 },
  discount: { petrol: 0.10, ev: 0.15 },
  maxPlatformFeeRate: 0.12, // service fee cap per ride-sharing transaction
  carCapPerCompany: 300,
  maxSeats: 5,
  maxDriverHoursPerDay: 12,
};

// National draft: Digital Mobility Service Operation Standards 2082 (2026). Published for consultation 20 Apr 2026,
// still under ministry review (Kathmandu Post, 30 Jul 2026). MyRide complies in advance (COMPLIANCE.federalDraft).
const FEDERAL_DRAFT = {
  status: 'draft — under Ministry of Physical Infrastructure & Transport review (Jul 2026)',
  perKmCap: { bike: 25, car: 55 }, // two-wheeler / four-wheeler max base rate per km
  minChargeKm: 2, // providers may charge at least 2 km
  nightMaxUplift: 0.2, // night / bad weather / remote: up to +20%
  surgeCap: { bike: 0.3, car: 0.4 },
  maxCommission: 0.10, // of each fare
  accidentFund: { fromFare: 0.01, fromPlatform: 0.005 }, // Traffic Accident Fund (up to Rs 10 lakh per major accident)
  maxVehicleAgeYears: 15,
  minLicenceYears: 1,
  registrationFee: { bike: 1000, car: 5000 }, // per vehicle per year
};
// Kathmandu metered taxi tariff (DoTM, last published revision): Rs 50 flag-down incl. first km, then Rs 10 per 200 m.
const METERED_TAXI = { flagDown: 50, includedKm: 1, perKm: 50 };

const COMPLIANCE = {
  federalDraft: process.env.MYRIDE_FEDERAL_DRAFT !== '0', // apply the stricter 10% commission + 1% accident fund now
};

const TAX = {
  vatOnTransport: 0.05, // IRD notice, effective 17 July 2026, on rides/deliveries through platforms
  vatStandard: 0.13, // VAT on commissions/service fees and on subscriptions
  paymentGatewayRate: 0.015, // typical eSewa/Khalti/Fonepay merchant rate; confirm per contract
  bankTransferFee: 5, // NCHL-IPS Rs 501–50,000 slab (+13% VAT), per payout
};

// Vehicle classes drivers can register, with the DoTM licence categories that may drive them.
// A = motorcycle/scooter, K = scooter, B = car/jeep/van/pickup, F = minibus/minitruck, G = truck/bus/lorry.
const VEHICLES = {
  bike: { label: 'Motorcycle / scooter', licence: ['A', 'K'], minAge: 18 },
  car: { label: 'Car (public plate, ≤5 seats)', licence: ['B'], minAge: 18 },
  cargo: { label: 'Mini-truck (≤750 kg, e.g. Tata Ace)', licence: ['B', 'F'], minAge: 18 },
  van: { label: 'Cargo van (≤800 kg, e.g. Suzuki Super Carry / Maruti Eeco cargo)', licence: ['B'], minAge: 18 },
  jeep: { label: '4×4 jeep (≤1 t, e.g. Mahindra Bolero / Scorpio 4WD)', licence: ['B'], minAge: 18 },
  pickup: { label: 'Pickup (≤1.5 t, e.g. Bolero Pickup)', licence: ['B'], minAge: 18 },
  truck_light: { label: 'Light truck (≤4 t, e.g. Tata 407)', licence: ['F', 'G'], minAge: 21 },
  truck: { label: 'Truck (≤9 t, e.g. Tata 1109)', licence: ['G'], minAge: 21 },
};

// Common per-service defaults; each service can override.
const RIDE_DEFAULTS = { waitFreeMin: 3, cancelFee: 20, deadKmPay: 5 };

// MyRide tariffs. DECISION: rides always priced below the Gandaki legal maximum (after mandated discount)
// and below public competitor estimates for the average 3.5 km Pokhara trip.
// v2 fees: still below Pathao (Rs 12 flat bike; ~20% car) and inDrive (~10%), within the 12% provincial cap.
const SERVICES = {
  bike: {
    label: 'MyRide Motorcycle', labelNe: 'मोटरसाइकल', kind: 'ride', regClass: 'bike', vehicle: 'bike', fuel: 'petrol', seats: 1,
    base: 10, perKm: 16, minFare: 40, // low base: short core-ward hops are the most common trip
    platformFee: { type: 'flat', amount: 10 }, // capped at 10% of fare by the federal draft (≈ Rs 6.7 on a 3.5 km trip)
    costPerKm: 8.2, // fuel 200/45 km/L ≈ 4.4 + maintenance 1.6 + tyres/depreciation 2.2
    ...RIDE_DEFAULTS, waitPerMin: 2,
  },
  bike_ev: {
    label: 'MyRide Green Motorcycle (EV)', labelNe: 'ग्रिन मोटरसाइकल (EV)', kind: 'ride', regClass: 'bike', vehicle: 'bike', fuel: 'ev', seats: 1,
    base: 9, perKm: 14.7, minFare: 37,
    platformFee: { type: 'flat', amount: 7 }, // DECISION: lower fee to grow the EV fleet
    costPerKm: 4.1,
    ...RIDE_DEFAULTS, waitPerMin: 2,
  },
  car: {
    label: 'MyRide Car', labelNe: 'कार', kind: 'ride', regClass: 'car', vehicle: 'car', fuel: 'petrol', seats: 4,
    base: 20, perKm: 42, minFare: 105, // ≤ federal draft Rs 55/km × 2 km = Rs 110 and Gandaki min Rs 140.85
    platformFee: { type: 'rate', rate: 0.10 },
    costPerKm: 22, // fuel 200/14 km/L ≈ 14.3 + maintenance/tyres 3.7 + depreciation 4
    ...RIDE_DEFAULTS, waitPerMin: 5, cancelFee: 50, deadKmPay: 15,
  },
  car_ev: {
    label: 'MyRide Green Car', labelNe: 'ग्रिन कार (EV)', kind: 'ride', regClass: 'car', vehicle: 'car', fuel: 'ev', seats: 4,
    base: 18, perKm: 39, minFare: 99,
    platformFee: { type: 'rate', rate: 0.09 },
    costPerKm: 9.5,
    ...RIDE_DEFAULTS, waitPerMin: 5, cancelFee: 50, deadKmPay: 15,
  },

  // ---- Delivery & logistics (goods). Not covered by the passenger fare schedule or the 20 km radius. ----
  parcel_express: {
    label: 'Parcel Express (motorcycle)', labelNe: 'पार्सल एक्सप्रेस', kind: 'delivery', vehicle: 'bike', fuel: 'petrol',
    base: 60, includedKm: 2, perKm: 14, minFare: 60,
    maxWeightKg: 10, includedKg: 3, perExtraKg: 8, fragileFee: 20,
    platformFee: { type: 'rate', rate: 0.12 },
    costPerKm: 8.2,
    ...RIDE_DEFAULTS, waitPerMin: 2,
  },
  parcel_standard: {
    label: 'Parcel Same-Day (motorcycle, batched)', labelNe: 'पार्सल सोही दिन', kind: 'delivery', vehicle: 'bike', fuel: 'petrol',
    flat: 75, maxKm: 12, // Pathao Parcel Kathmandu promo: Rs 79
    maxWeightKg: 10, includedKg: 3, perExtraKg: 8, fragileFee: 20,
    platformFee: { type: 'rate', rate: 0.12 },
    costPerKm: 8.2,
    ...RIDE_DEFAULTS, waitPerMin: 2,
  },
  cargo: {
    label: 'Mini-Truck · 750 kg', labelNe: 'सानो ट्रक', kind: 'delivery', logistics: true, vehicle: 'cargo', fuel: 'diesel',
    base: 450, includedKm: 2, perKm: 45, minFare: 450, intercityPerKm: 55,
    maxWeightKg: 750, includedKg: 750, perExtraKg: 0,
    platformFee: { type: 'rate', rate: 0.10 },
    costPerKm: 21, // diesel 195/14 km/L ≈ 13.9 + maintenance/depreciation 7
    waitFreeMin: 30, waitPerMin: 5, cancelFee: 150, deadKmPay: 18,
  },
  van: {
    label: 'Cargo Van · 800 kg (covered)', labelNe: 'कार्गो भ्यान', kind: 'delivery', logistics: true, vehicle: 'van', fuel: 'petrol',
    base: 600, includedKm: 3, perKm: 50, minFare: 600, intercityPerKm: 60, // enclosed: e-commerce, furniture, shop stock in monsoon rain
    maxWeightKg: 800, includedKg: 800, perExtraKg: 0,
    platformFee: { type: 'rate', rate: 0.10 },
    costPerKm: 24, // petrol 200/13 km/L ≈ 15.4 + maintenance/depreciation 8.6
    waitFreeMin: 30, waitPerMin: 5, cancelFee: 200, deadKmPay: 20,
  },
  jeep: {
    label: '4×4 Jeep · 1 t (hill & rough roads)', labelNe: 'जिप (पहाडी सडक)', kind: 'delivery', logistics: true, vehicle: 'jeep', fuel: 'diesel',
    base: 900, includedKm: 3, perKm: 70, minFare: 900, intercityPerKm: 80, // Bhalam, Kaskikot, Chapakot, Sarangkot, Lamachaur, trailheads
    maxWeightKg: 1000, includedKg: 1000, perExtraKg: 0,
    platformFee: { type: 'rate', rate: 0.10 },
    costPerKm: 32, // diesel 195/9 km/L ≈ 21.7 + 4WD tyres/maintenance/depreciation 10.3
    waitFreeMin: 30, waitPerMin: 7, cancelFee: 300, deadKmPay: 26,
  },
  pickup: {
    label: 'Pickup · 1.5 t', labelNe: 'पिकअप', kind: 'delivery', logistics: true, vehicle: 'pickup', fuel: 'diesel',
    base: 800, includedKm: 3, perKm: 60, minFare: 800, intercityPerKm: 70,
    maxWeightKg: 1500, includedKg: 1500, perExtraKg: 0,
    platformFee: { type: 'rate', rate: 0.10 },
    costPerKm: 27, // 195/11 km/L ≈ 17.7 + 9
    waitFreeMin: 30, waitPerMin: 6, cancelFee: 250, deadKmPay: 22,
  },
  truck_light: {
    label: 'Light Truck · 4 t', labelNe: 'हल्का ट्रक', kind: 'delivery', logistics: true, vehicle: 'truck_light', fuel: 'diesel',
    base: 1800, includedKm: 5, perKm: 90, minFare: 1800, intercityPerKm: 95,
    maxWeightKg: 4000, includedKg: 4000, perExtraKg: 0,
    platformFee: { type: 'rate', rate: 0.10 },
    costPerKm: 42, // 195/7 km/L ≈ 27.9 + 14
    waitFreeMin: 45, waitPerMin: 8, cancelFee: 500, deadKmPay: 35,
  },
  truck: {
    label: 'Truck · 9 t', labelNe: 'ट्रक', kind: 'delivery', logistics: true, vehicle: 'truck', fuel: 'diesel',
    base: 3500, includedKm: 5, perKm: 140, minFare: 3500, intercityPerKm: 140,
    maxWeightKg: 9000, includedKg: 9000, perExtraKg: 0,
    platformFee: { type: 'rate', rate: 0.10 },
    costPerKm: 62, // 195/4.5 km/L ≈ 43 + 19
    waitFreeMin: 60, waitPerMin: 10, cancelFee: 1000, deadKmPay: 50,
  },
};

const LOGISTICS = {
  intercityFromKm: 25,
  // Low-density hill wards with steep / partly unpaved roads (< 400 people/km², data/wards.json): 4×4 jeep recommended.
  hillWards: [18, 20, 21, 22, 23, 24, 28, 33], // beyond this, intercity per-km rate (includes share of empty return)
  maxKm: 320,
  helperFee: 800, // per loader/helper per job (min. wage ≈ Rs 754/day)
  maxHelpers: 6,
  insuranceRate: 0.003, // goods-in-transit cover via insurer partner: 0.3% of declared value
  insuranceMin: 100,
  goodsTypes: ['general', 'household', 'furniture', 'construction', 'perishable', 'fragile', 'documents', 'electronics'],
  // Intercity lanes from Pokhara (OSM coordinates of each city centre).
  destinations: [
    { id: 'kathmandu', name: 'Kathmandu', lat: 27.7172, lng: 85.324 },
    { id: 'bharatpur', name: 'Bharatpur (Chitwan)', lat: 27.6766, lng: 84.4353 },
    { id: 'butwal', name: 'Butwal', lat: 27.7006, lng: 83.4484 },
    { id: 'bhairahawa', name: 'Bhairahawa (Siddharthanagar)', lat: 27.5051, lng: 83.4524 },
    { id: 'damauli', name: 'Damauli (Tanahun)', lat: 27.9729, lng: 84.2685 },
    { id: 'syangja', name: 'Putalibazar (Syangja)', lat: 28.0896, lng: 83.8726 },
    { id: 'baglung', name: 'Baglung', lat: 28.2719, lng: 83.5898 },
    { id: 'beni', name: 'Beni (Myagdi)', lat: 28.3466, lng: 83.5664 },
    { id: 'besisahar', name: 'Besisahar (Lamjung)', lat: 28.2309, lng: 84.3775 },
  ],
};

// Public competitor estimates. Sources and caveats in docs/RESEARCH.md. These are ESTIMATES for comparison,
// not the competitors' published tariffs (none publish Pokhara rate cards).
const COMPETITORS = {
  bike: [
    { name: 'Pathao', estimate: (km) => Math.max(40, 25 * km), note: 'Pathao: effective average ≈ Rs 25/km' },
    { name: 'Yango', estimate: (km) => Math.max(40, 22 * km), note: 'Yango: from Rs 40; ~Rs 22/km assumed' },
  ],
  car: [
    { name: 'Pathao Car', estimate: (km) => 100 + 60 * km, note: 'Kathmandu est. base 90–110 + 55–65/km' },
    { name: 'Yango', estimate: (km) => 90 + 50 * km, note: 'Kathmandu est. base 80–100 + 45–55/km' },
    { name: 'Metered taxi', estimate: (km) => 50 + 50 * Math.max(0, km - 1), note: 'DoTM meter: Rs 50 flag-down + Rs 10/200 m (rarely used)' },
    { name: 'Street taxi', estimate: (km) => 100 + 75 * km, note: 'Unmetered; airport→Lakeside quoted Rs 500–1,200' },
  ],
};

// MyRide Plus — like Uber One (US$9.99/mo: 6% back as credits, Rs 0 delivery fee). DECISION: priced for Nepal.
const MEMBERSHIP = {
  plans: {
    plus_monthly: { label: 'MyRide Plus · Monthly', price: 199.99, days: 30 },
    plus_yearly: { label: 'MyRide Plus · Yearly', price: 1999.99, days: 365 }, // 12 months for the price of 10 (17% off)
  },
  trialDays: 7, // first-time members only
  benefits: {
    rideDiscountPct: 0.05, // 5% off every ride and delivery…
    maxDiscountPerTrip: 25, // …capped per trip (platform-funded; driver pay unchanged)
    freeCancellationsPerMonth: 3,
    codFeeWaived: true,
    priorityRadiusKm: 7, // members are searched in a wider radius when supply is thin
  },
};

// Free rides, referrals and promo codes (all platform-funded; the driver is always paid on the full fare).
const PROMOS = {
  firstRideFree: { maxOff: 100 }, // every new rider's first ride free up to Rs 100
  referral: { referrerCredit: 50, maxPerReferrerPerMonth: 20 }, // after the friend's first completed trip
  defaults: [
    { code: 'POKHARA20', type: 'percent', value: 0.2, maxOff: 30, oncePerUser: true, note: '20% off a ride (max Rs 30)' },
    { code: 'NAMASTE', type: 'percent', value: 0.1, maxOff: 50, oncePerUser: true, note: 'Welcome to Pokhara — 10% off (max Rs 50)' },
    { code: 'GREEN10', type: 'percent', value: 0.1, maxOff: 20, services: ['bike_ev', 'car_ev'], note: '10% off Green (EV) rides' },
    { code: 'FREERIDE', type: 'free_ride', value: 1, maxOff: 120, oncePerUser: true, usageLimit: 500, note: 'One free ride up to Rs 120' },
    { code: 'SHIFT500', type: 'flat', value: 500, maxOff: 500, oncePerUser: true, services: ['pickup', 'truck_light', 'truck'], note: 'Rs 500 off your house shifting' },
  ],
};

const SAFETY = {
  police: '100', ambulance: '102', touristPolice: '1144', fire: '101',
  shareMax: 5, // close ones a customer can send one trip to
  // Public address of this server, for live-trip links sent by SMS (e.g. https://myride.com.np).
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
};

const DISPATCH = {
  searchRadiusKm: 5,
  logisticsRadiusKm: 12,
  offerToNearest: 3,
  offerTimeoutSec: 20,
  freePickupKm: 2.5, // beyond this, platform pays the driver dead-km compensation
};

// Driver KYC (modelled on Uber's onboarding + Nepal documents) and Real-Time ID (random selfie) checks.
const KYC = {
  documents: {
    common: ['citizenshipFront', 'citizenshipBack', 'licence', 'policeReport', 'selfie'],
    partner: ['bluebook', 'insurance'], // own vehicle: registration (bluebook) + third-party insurance
  },
  banks: [
    'Agricultural Development Bank', 'Citizens Bank International', 'Everest Bank', 'Global IME Bank', 'Himalayan Bank',
    'Kumari Bank', 'Laxmi Sunrise Bank', 'Machhapuchchhre Bank', 'Nabil Bank', 'Nepal Bank', 'Nepal Investment Mega Bank',
    'Nepal SBI Bank', 'NIC Asia Bank', 'NMB Bank', 'Prabhu Bank', 'Prime Commercial Bank', 'Rastriya Banijya Bank',
    'Sanima Bank', 'Siddhartha Bank', 'Standard Chartered Bank Nepal', 'Garima Bikas Bank', 'Muktinath Bikas Bank',
    'Shine Resunga Development Bank', 'Jyoti Bikas Bank', 'Mahalaxmi Bikas Bank', 'Kamana Sewa Bikas Bank', 'Lumbini Bikas Bank',
  ],
  faceMatchThreshold: 0.5, // Euclidean distance between 128-d face descriptors (face-api.js); lower = more similar
  docMatchThreshold: 0.6, // selfie vs ID photo (older, printed photos match less tightly)
  randomCheck: {
    atGoOnlineProbability: 0.3,
    mandatoryAfterHours: 72,
    perMinuteWhileOnline: 1 / 240, // ≈ one surprise check every 4 h online
    respondWithinMin: 10,
    maxFailures: 2, // then suspended for manual review
  },
  maxUploadBytes: 1.5 * 1024 * 1024,
};

// Salaried fleet drivers (MyRide employees) — Labour Act 2074 + SSF + FY 2082/83 minimum wage.
const PAYROLL = {
  minimumWageMonthly: 19550, // basic 12,170 + dearness allowance 7,380 (from 1 Shrawan 2082)
  defaultMonthlyWage: 25000, // DECISION: above minimum to attract good drivers
  basicShare: 0.6, // basic pay ≥ 60% of total remuneration
  ssfEmployee: 0.11, // of basic
  ssfEmployer: 0.20, // of basic
  workDaysPerMonth: 26,
  regularHoursPerDay: 8,
  maxOvertimeHoursPerDay: 4,
  overtimeMultiplier: 1.5,
  tripIncentive: { afterTripsPerDay: 12, perTrip: 15 },
  payDay: 0, // Sunday — Nepal's first working day; covers the previous Sunday–Saturday
};

// Fixed tourist fares (customer sees a flat price, never more). Computed from MyRide tariff on the measured
// OSRM distance and rounded down to the nearest Rs 10. See tests/pricing.test.js.
const FIXED_ROUTES = [
  { from: 'lakeside', to: 'pokhara-intl-airport' },
  { from: 'lakeside', to: 'tourist-bus-park' },
  { from: 'lakeside', to: 'sarangkot' },
  { from: 'damside', to: 'pokhara-intl-airport' },
];

module.exports = { CITY, CITIES, GANDAKI, FEDERAL_DRAFT, METERED_TAXI, COMPLIANCE, TAX, VEHICLES, SERVICES, LOGISTICS, COMPETITORS, MEMBERSHIP, PROMOS, SAFETY, DISPATCH, KYC, PAYROLL, FIXED_ROUTES };
