// Weekly payouts to drivers' bank accounts (NCHL-IPS / connectIPS CorporatePay bulk upload).
//  • Partner drivers (own vehicle): paid their positive wallet balance (trip earnings − fees on cash trips + bonuses).
//  • Fleet employees (MyRide-employed): hourly wage from logged shifts, overtime ×1.5 (Labour Act 2074, max 4 h/day),
//    trip incentive, minus employee SSF (11% of basic); employer SSF (20% of basic) recorded as company cost.
// Pay week: Sunday–Saturday; paid on Sunday (Nepal's first working day).
const { PAYROLL, TAX } = require('./config');

const DAY = 86400000;
const r2 = (n) => Math.round(n * 100) / 100;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// The Sunday–Saturday week that ended before `now` (UTC dates; Nepal is UTC+5:45 — run the job after 00:15 NPT).
function previousWeek(now) {
  const d = new Date(now);
  const day = d.getUTCDay(); // 0 = Sunday
  const thisSunday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
  return { start: thisSunday - 7 * DAY, end: thisSunday }; // [start, end)
}

function employeePayslip(driver, week) {
  const monthly = driver.employment?.monthlyWage || PAYROLL.defaultMonthlyWage;
  const hourly = monthly / (PAYROLL.workDaysPerMonth * PAYROLL.regularHoursPerDay);
  const days = [];
  let regularHours = 0, overtimeHours = 0, trips = 0, incentive = 0;
  for (let t = week.start; t < week.end; t += DAY) {
    const log = driver.shiftLog?.[iso(t)];
    if (!log || !log.minutes) continue;
    const h = log.minutes / 60;
    const reg = Math.min(PAYROLL.regularHoursPerDay, h);
    const ot = Math.min(PAYROLL.maxOvertimeHoursPerDay, Math.max(0, h - PAYROLL.regularHoursPerDay));
    const inc = Math.max(0, (log.trips || 0) - PAYROLL.tripIncentive.afterTripsPerDay) * PAYROLL.tripIncentive.perTrip;
    regularHours += reg; overtimeHours += ot; trips += log.trips || 0; incentive += inc;
    days.push({ date: iso(t), hours: r2(h), regular: r2(reg), overtime: r2(ot), trips: log.trips || 0, incentive: inc });
  }
  const regularPay = regularHours * hourly;
  const overtimePay = overtimeHours * hourly * PAYROLL.overtimeMultiplier;
  const gross = regularPay + overtimePay + incentive;
  const basic = (regularPay) * PAYROLL.basicShare; // SSF is on basic salary, not overtime/incentives
  const ssfEmployee = basic * PAYROLL.ssfEmployee;
  const ssfEmployer = basic * PAYROLL.ssfEmployer;
  const warnings = [];
  if (days.length > 6) warnings.push('Worked 7 days — Labour Act requires one weekly holiday');
  if (days.some((d) => d.hours > PAYROLL.regularHoursPerDay + PAYROLL.maxOvertimeHoursPerDay)) warnings.push('Shift exceeded 12 h (8 h + 4 h overtime) — only 12 h paid; review rota');
  return {
    type: 'employee', hourlyRate: r2(hourly), days, regularHours: r2(regularHours), overtimeHours: r2(overtimeHours), trips,
    lines: [
      { label: `Regular ${r2(regularHours)} h × Rs ${r2(hourly)}`, amount: r2(regularPay) },
      { label: `Overtime ${r2(overtimeHours)} h × 1.5`, amount: r2(overtimePay) },
      { label: `Trip incentive (> ${PAYROLL.tripIncentive.afterTripsPerDay}/day)`, amount: r2(incentive) },
      { label: 'SSF employee 11% of basic', amount: -r2(ssfEmployee) },
    ],
    gross: r2(gross), ssfEmployee: r2(ssfEmployee), ssfEmployer: r2(ssfEmployer), net: r2(gross - ssfEmployee),
    cashToDeposit: r2(driver.cashHeld || 0), // cash fares collected; deposited at the hub, never deducted from wages
    warnings,
  };
}

function partnerPayslip(driver, ledger, week) {
  const entries = ledger.filter((e) => e.driverId === driver.id && e.at >= week.start && e.at < week.end);
  const sum = (types) => r2(entries.filter((e) => types.includes(e.type)).reduce((s, e) => s + e.amount, 0));
  const balance = r2(driver.wallet);
  return {
    type: 'partner',
    trips: entries.filter((e) => e.type === 'trip_earning').length,
    lines: [
      { label: 'Trip earnings', amount: sum(['trip_earning']) },
      { label: 'Long-pickup & waiting bonuses', amount: sum(['bonus']) },
      { label: 'Cancellation fees', amount: sum(['cancel_fee']) },
      { label: 'Cash collected from customers', amount: sum(['cash_collected']) },
      { label: 'Cash-on-delivery held', amount: sum(['cod_held']) },
    ],
    weekNet: r2(entries.filter((e) => e.type !== 'payout').reduce((s, e) => s + e.amount, 0)),
    balance,
    net: balance > 0 ? balance : 0,
    carriedForward: balance <= 0 ? balance : 0,
    warnings: balance < 0 ? ['Balance negative (cash trips) — settle via eSewa/Khalti or it is recovered from next week'] : [],
  };
}

/**
 * Run the weekly payout. Idempotent per week: re-running returns the existing batch.
 * @returns batch { id, week, items:[{driverId, name, bank, amount, payslip}], total, status }
 */
function runWeeklyPayout({ store, now, post }) {
  const week = previousWeek(now);
  const weekId = iso(week.start);
  const existing = store.all('payoutBatches').find((b) => b.weekId === weekId);
  if (existing) return existing;
  const ledger = store.all('ledger');
  const items = [];
  for (const d of store.all('drivers')) {
    if (d.simulated && !d.bank) continue;
    const slip = d.driverType === 'employee' ? employeePayslip(d, week) : partnerPayslip(d, ledger, week);
    if (slip.type === 'partner' && slip.net > 0) post(d, 'payout', -slip.net, { note: `Weekly payout ${weekId}` });
    if (slip.type === 'employee' && slip.gross === 0) continue;
    items.push({
      driverId: d.id, name: d.bank?.accountName || d.name, driverType: d.driverType,
      bank: d.bank ? { bank: d.bank.bank, branch: d.bank.branch, accountNumber: d.bank.accountNumber } : null,
      amount: slip.net, payslip: slip,
    });
  }
  const payable = items.filter((i) => i.amount > 0 && i.bank);
  const batch = store.put('payoutBatches', {
    id: store.id('pay'), weekId, week: { start: iso(week.start), end: iso(week.end - DAY) }, createdAt: now,
    items, total: r2(payable.reduce((s, i) => s + i.amount, 0)),
    transferFees: r2(payable.length * TAX.bankTransferFee * (1 + TAX.vatStandard)),
    employerSsf: r2(items.reduce((s, i) => s + (i.payslip.ssfEmployer || 0), 0)),
    status: 'ready_for_bank_upload',
  });
  return batch;
}

// Bulk transfer CSV (columns used by NCHL CorporatePay / bank corporate portals — map to your bank's template).
function batchCsv(batch) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['S.N.', 'Beneficiary Name', 'Bank', 'Branch', 'Account Number', 'Amount (NPR)', 'Remarks']];
  batch.items.filter((i) => i.amount > 0 && i.bank).forEach((i, n) => {
    rows.push([n + 1, i.name, i.bank.bank, i.bank.branch, i.bank.accountNumber, i.amount.toFixed(2), `MyRide ${i.driverType === 'employee' ? 'wages' : 'earnings'} ${batch.week.start}..${batch.week.end}`]);
  });
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

module.exports = { previousWeek, employeePayslip, partnerPayslip, runWeeklyPayout, batchCsv };
