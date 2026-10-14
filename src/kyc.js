// Driver KYC: Nepali identity documents, licence category vs vehicle, bank account, selfie face match,
// and Uber-style Real-Time ID checks (random selfies before/while online).
//
// Face matching: the Drive app computes a 128-d face descriptor in the browser (face-api.js) for the selfie and
// for the photo on the licence/citizenship card; the server compares descriptors and keeps the photos for human
// review. PRODUCTION: move matching + liveness to a server-side vendor (e.g. AWS Rekognition Face Liveness or a
// Nepal e-KYC provider) — client-computed descriptors can be forged by a determined attacker.
const { KYC, VEHICLES, GANDAKI } = require('./config');

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const DAY = 86400000;

function ageOn(dobIso, now) {
  const d = new Date(dobIso);
  if (Number.isNaN(d.getTime())) return NaN;
  const n = new Date(now);
  let a = n.getUTCFullYear() - d.getUTCFullYear();
  if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a--;
  return a;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zऀ-ॿ]+/g, ' ').trim();

// Euclidean distance between two face descriptors; Infinity if missing/invalid.
function faceDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 128 || b.length !== 128) return Infinity;
  let s = 0;
  for (let i = 0; i < 128; i++) {
    const d = +a[i] - +b[i];
    if (!Number.isFinite(d)) return Infinity;
    s += d * d;
  }
  return Math.sqrt(s);
}

function requiredDocs(driverType) {
  return [...KYC.documents.common, ...(driverType === 'partner' ? KYC.documents.partner : [])];
}

/**
 * Validate a KYC application. Returns { errors:[], checks:[{check, ok, detail}] }.
 * errors block submission; checks are shown to the reviewer.
 */
function validateApplication(app, now) {
  const errors = [];
  const checks = [];
  const p = app.personal || {};
  const lic = app.licence || {};
  const bank = app.bank || {};
  const v = app.vehicle || {};
  const vehicleType = app.driverType === 'employee' ? app.preferredVehicle : v.type;
  const vc = VEHICLES[vehicleType];

  if (!['partner', 'employee'].includes(app.driverType)) errors.push('Choose partner (own vehicle) or MyRide fleet employee');
  if (!vc) errors.push('Choose a vehicle type');
  if (!p.fullName || norm(p.fullName).split(' ').length < 2) errors.push('Full legal name (as on citizenship) is required');
  const age = ageOn(p.dob, now);
  if (!Number.isFinite(age)) errors.push('Date of birth is required');
  else if (vc && age < vc.minAge) errors.push(`You must be at least ${vc.minAge} to drive a ${vc.label}`);
  else if (age > 65) checks.push({ check: 'age', ok: false, detail: `Age ${age}: medical fitness certificate required` });
  if (!['male', 'female', 'other'].includes(p.gender)) errors.push('Gender is required');
  if (!p.address || String(p.address).length < 5) errors.push('Permanent address is required');
  if (!/^[0-9]{1,3}([-/][0-9]{1,6}){1,4}$/.test(String(p.citizenshipNo || '').trim())) errors.push('Citizenship certificate number looks invalid (e.g. 45-01-77-12345)');
  if (!p.citizenshipDistrict) errors.push('Citizenship issuing district is required');
  if (p.nidNo && !/^\d{3}-?\d{3}-?\d{4}$/.test(String(p.nidNo))) errors.push('National ID (NIN) must be 10 digits');

  if (!/^[0-9]{2}-[0-9]{2}-[0-9]{6,10}$/.test(String(lic.number || '').trim())) errors.push('Licence number must look like 04-06-12345678');
  const cats = Array.isArray(lic.categories) ? lic.categories.map((c) => String(c).toUpperCase()) : [];
  if (vc && !cats.some((c) => vc.licence.includes(c))) errors.push(`A ${vc.label} needs licence category ${vc.licence.join(' or ')}`);
  const exp = Date.parse(lic.expiry);
  if (!Number.isFinite(exp)) errors.push('Licence expiry date is required');
  else if (exp < now) errors.push('Your driving licence has expired');
  else if (exp < now + 30 * DAY) checks.push({ check: 'licence_expiry', ok: false, detail: 'Licence expires within 30 days' });

  if (app.driverType === 'partner') {
    if (!v.plate || String(v.plate).length < 4) errors.push('Vehicle number plate is required');
    if (!v.bluebookNo) errors.push('Bluebook (vehicle registration) number is required');
    const ins = Date.parse(v.insuranceExpiry);
    if (!Number.isFinite(ins) || ins < now) errors.push('Valid third-party vehicle insurance is required');
    if (v.type === 'car' && !v.publicPlate) errors.push('Gandaki rules: only public (black-plate) cars may do ride-sharing');
    if (v.type === 'car' && +v.seats > GANDAKI.maxSeats) errors.push('Gandaki rules: vehicles with more than 5 seats are not allowed');
    if (['cargo', 'pickup', 'truck_light', 'truck'].includes(v.type) && !v.goodsPermit) errors.push('Goods vehicles must be registered for goods transport (route permit)');
  }

  if (!KYC.banks.includes(bank.bank)) errors.push('Choose your bank');
  if (!bank.branch) errors.push('Bank branch is required');
  if (!/^\d{8,20}$/.test(String(bank.accountNumber || '').replace(/[\s-]/g, ''))) errors.push('Bank account number must be 8–20 digits');
  const nameMatch = norm(bank.accountName) === norm(p.fullName);
  checks.push({ check: 'bank_name_match', ok: nameMatch, detail: nameMatch ? 'Account holder matches legal name' : 'Account holder name differs from legal name — payouts only to own account' });
  if (!bank.accountName) errors.push('Account holder name is required');

  const docs = app.documents || {};
  const missing = requiredDocs(app.driverType).filter((d) => !docs[d]);
  if (missing.length) errors.push(`Upload: ${missing.join(', ')}`);

  const f = app.face || {};
  if (!Array.isArray(f.selfieDescriptor)) errors.push('Take a live selfie for face verification');
  else {
    const dist = faceDistance(f.selfieDescriptor, f.idDescriptor);
    checks.push({
      check: 'selfie_vs_id_photo', ok: dist <= KYC.docMatchThreshold,
      detail: Number.isFinite(dist) ? `Face distance ${dist.toFixed(3)} (match ≤ ${KYC.docMatchThreshold})` : 'No face found on ID photo — reviewer must compare manually',
      distance: Number.isFinite(dist) ? +dist.toFixed(4) : null,
    });
    checks.push({ check: 'liveness', ok: !!f.liveness?.passed, detail: f.liveness?.passed ? 'Head-turn challenge passed' : 'Liveness challenge not passed' });
  }
  if (!app.consent) errors.push('Accept the background check and data processing consent');
  return { errors, checks };
}

// ---------- Real-Time ID check (random selfie) ----------

// Decide whether a selfie is required before going online.
function selfieNeededAtGoOnline(driver, now, rand = Math.random) {
  const last = driver.faceCheck?.lastPassedAt || 0;
  if (now - last > KYC.randomCheck.mandatoryAfterHours * 3600000) return 'periodic';
  return rand() < KYC.randomCheck.atGoOnlineProbability ? 'random' : null;
}

function requestSelfie(driver, now, reason) {
  driver.faceCheck = { ...(driver.faceCheck || {}), pending: true, reason, requestedAt: now, deadline: now + KYC.randomCheck.respondWithinMin * 60000 };
  return driver.faceCheck;
}

// Verify a selfie descriptor against the enrolled one. Mutates driver.faceCheck; returns result.
function verifySelfie(driver, descriptor, now) {
  const fc = driver.faceCheck || {};
  const dist = faceDistance(descriptor, driver.faceDescriptor);
  const passed = dist <= KYC.faceMatchThreshold;
  const attempt = { at: now, distance: Number.isFinite(dist) ? +dist.toFixed(4) : null, passed, reason: fc.reason || 'manual' };
  driver.faceCheck = {
    ...fc,
    pending: !passed,
    lastPassedAt: passed ? now : fc.lastPassedAt,
    failures: passed ? 0 : (fc.failures || 0) + 1,
    history: [...(fc.history || []).slice(-19), attempt],
  };
  if (!passed && driver.faceCheck.failures >= KYC.randomCheck.maxFailures) {
    driver.suspended = { at: now, reason: 'Face verification failed — account under review' };
  }
  return attempt;
}

module.exports = { validateApplication, requiredDocs, faceDistance, ageOn, selfieNeededAtGoOnline, requestSelfie, verifySelfie };
