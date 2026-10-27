(() => {
  const { api, $, rs, esc, toast } = MR;
  let token = MR.store.get(MR.tokenKey('admin'));
  let map, fleetLayer, wardLayer, wards = [], cfg;
  const L_ = (n) => `Rs ${(n / 100000).toFixed(2)} L`;
  const imgCache = new Map();

  async function loadImages(root) {
    for (const img of root.querySelectorAll('img[data-file]')) {
      const id = img.dataset.file;
      try { if (!imgCache.has(id)) imgCache.set(id, await MR.authedImage(id, token)); img.src = imgCache.get(id); } catch { img.alt = 'not available'; }
    }
  }

  async function load() {
    const [s, drivers, trips, apps, fleet, payouts, promos, appErrors] = await Promise.all([
      api('GET', '/api/admin/stats', null, token), api('GET', '/api/admin/drivers', null, token), api('GET', '/api/admin/trips', null, token),
      api('GET', '/api/admin/applications', null, token), api('GET', '/api/admin/fleet', null, token), api('GET', '/api/admin/payouts', null, token), api('GET', '/api/admin/promos', null, token),
      api('GET', '/api/admin/client-errors', null, token),
    ]);
    $('#appErrors').innerHTML = appErrors.length
      ? `<table><tr><th>When</th><th>App</th><th>Screen</th><th>Error</th></tr>${appErrors.slice(0, 50).map((e) => `<tr><td>${new Date(e.at).toLocaleString()}</td><td>${esc(e.app)} ${esc(e.version)} ${esc(e.platform)}</td><td>${esc(e.screen)}</td><td>${e.fatal ? '<b class="neg">CRASH</b> ' : ''}<span title="${esc(e.stack)}">${esc(e.message)}</span></td></tr>`).join('')}</table>`
      : '<span class="muted">No app errors reported.</span>';
    $('#tiles').innerHTML = [
      ['Trips completed', s.trips.completed], ['Active now', s.trips.active], ['Parcels', s.trips.deliveries], ['Logistics jobs', s.trips.logistics],
      ['GMV', rs(s.gmv)], ['Platform revenue (net)', rs(s.platformRevenue)], ['Fleet revenue', rs(s.fleetRevenue)], ['Paid to partners', rs(s.driverEarnings)],
      ['Discounts funded', rs(s.discounts)], ['Plus members', `${s.members} / ${s.riders}`], ['Drivers online', `${s.drivers.online}/${s.drivers.total}`],
      ['Partners · Fleet', `${s.drivers.partners} · ${s.drivers.employees}`], ['KYC to review', s.kyc.submitted], ['Suspended', s.drivers.suspended],
    ].map(([l, v]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');

    $('#compliance').innerHTML = `
      <div class="kv"><span>Cars registered vs 300-per-company cap</span><b class="${s.compliance.carCapOk ? 'pos' : 'neg'}">${s.compliance.carsRegistered} / ${s.compliance.carCap}</b></div>
      <div class="kv"><span>Ride fares ≤ provincial schedule (−10% petrol / −15% EV)</span><b class="pos">Enforced</b></div>
      <div class="kv"><span>Max 12 driving hours per day</span><b class="pos">Blocked at go-online</b></div>
      <div class="kv"><span>Ride pickups inside Pokhara (33 wards); drops ≤ 20 km</span><b class="pos">Checked per quote</b></div>
      <div class="kv"><span>Platform fee ≤ 12% per ride</span><b class="pos">Capped per trip</b></div>
      <div class="kv"><span>Goods vehicles need goods permit & F/G licence</span><b class="pos">KYC rule</b></div>
      <div class="kv"><span>Fleet: Labour Act 8 h + ≤ 4 h OT, SSF 11% + 20%</span><b class="pos">Payroll</b></div>
      <div class="kv"><span>Open SOS on active trips</span><b class="${s.compliance.sosOpen ? 'neg' : 'pos'}">${s.compliance.sosOpen}</b></div>`;

    const max = Math.max(1, ...Object.values(s.byWard));
    const top = Object.entries(s.byWard).sort((a, b) => b[1] - a[1]).slice(0, 10);
    $('#wardList').innerHTML = top.length ? top.map(([w, n]) => { const wd = wards.find((x) => x.ward === +w); return `<div class="bar-row"><span style="width:150px">${w}. ${esc(wd?.name || '')}</span><span class="b" style="width:${(n / max) * 60}%;background:var(--brand)"></span><span>${n}</span></div>`; }).join('') : '<span class="muted">No completed trips yet.</span>';

    renderKyc(apps, fleet);
    renderFleet(fleet, drivers);
    renderPayouts(payouts);
    $('#promos').innerHTML = `<table><tr><th>Code</th><th>Type</th><th class="num">Value</th><th class="num">Max off</th><th class="num">Used</th><th>Limits</th><th>Note</th></tr>${promos.map((p) => `<tr><td><b>${esc(p.code)}</b></td><td>${esc(p.type)}</td><td class="num">${p.type === 'percent' ? `${Math.round(p.value * 100)}%` : p.type === 'flat' ? rs(p.value) : 'free'}</td><td class="num">${rs(p.maxOff || 0)}</td><td class="num">${p.used || 0}${p.usageLimit ? ` / ${p.usageLimit}` : ''}</td><td class="muted">${[p.oncePerUser && 'once/user', p.newUsersOnly && 'new customers', p.services && p.services.join(','), p.expiresAt && `until ${new Date(p.expiresAt).toLocaleDateString()}`].filter(Boolean).join(' · ')}</td><td class="muted">${esc(p.note || '')}</td></tr>`).join('')}</table>`;

    $('#drivers').innerHTML = `<table><tr><th>Name</th><th>Type</th><th>Vehicle</th><th>Status</th><th class="num">Rating</th><th class="num">Trips</th><th class="num">Wallet</th><th class="num">Cash held</th><th>Face check</th><th></th></tr>
      ${drivers.map((d) => `<tr><td>${esc(d.name)}<div class="muted">${esc(d.phone)} · ${esc(d.gender)}</div></td><td>${d.driverType === 'employee' ? '<span class="pill">fleet</span>' : 'partner'}${d.simulated ? ' <span class="muted">demo</span>' : ''}</td>
        <td>${esc(d.vehicle.type)} ${d.vehicle.fuel === 'ev' ? '<span class="pill ev">EV</span>' : ''}<div class="muted">${esc(d.vehicle.model)} · ${esc(d.vehicle.plate)}</div></td>
        <td>${d.suspended ? `<span class="pill warn">suspended</span><div class="muted">${esc(d.suspended.reason)}</div>` : d.online ? `<span class="pill">${esc(d.status)}</span>` : 'offline'}</td>
        <td class="num">${d.rating}</td><td class="num">${d.earnings.trips}</td><td class="num ${d.wallet < 0 ? 'neg' : 'pos'}">${rs(d.wallet)}</td><td class="num">${d.cashHeld ? `${rs(d.cashHeld)} <button class="btn ghost small" data-dep="${d.id}" data-amt="${d.cashHeld}">Deposited</button>` : '—'}</td>
        <td class="muted">${d.faceCheck?.pending ? '<span class="pill warn">pending</span>' : d.faceCheck?.lastPassedAt ? new Date(d.faceCheck.lastPassedAt).toLocaleString() : '—'}${d.faceCheck?.failures ? ` · ${d.faceCheck.failures} fails` : ''}</td>
        <td>${d.suspended ? `<button class="btn small" data-sus="${d.id}" data-on="0">Reinstate</button>` : `<button class="btn ghost small" data-sus="${d.id}" data-on="1">Suspend</button>`}</td></tr>`).join('')}</table>`;
    document.querySelectorAll('[data-sus]').forEach((b) => { b.onclick = async () => { const reason = b.dataset.on === '1' ? prompt('Reason for suspension?') : null; if (b.dataset.on === '1' && !reason) return; await api('POST', `/api/admin/drivers/${b.dataset.sus}/suspend`, { suspended: b.dataset.on === '1', reason }, token).catch((e) => toast(e.message)); load(); }; });
    document.querySelectorAll('[data-dep]').forEach((b) => { b.onclick = async () => { await api('POST', `/api/admin/drivers/${b.dataset.dep}/cash-deposit`, { amount: +b.dataset.amt }, token).catch((e) => toast(e.message)); load(); }; });

    $('#trips').innerHTML = `<table><tr><th>When</th><th>Service</th><th>Route</th><th>Wards</th><th>Status</th><th class="num">km</th><th class="num">Fare</th><th class="num">Discount</th><th class="num">Driver</th><th class="num">Fee</th></tr>
      ${trips.slice(0, 40).map((t) => `<tr><td>${new Date(t.createdAt).toLocaleTimeString()}</td><td>${esc(t.quote.label)}${t.riderMember ? ' <span class="pill">Plus</span>' : ''}</td><td>${esc(t.pickup.label)} → ${esc(t.drop.label)}</td><td class="muted">${t.pickup.ward || '–'} → ${t.drop.ward || 'out'}</td><td>${esc(t.status)}${t.sos?.length ? ' <span class="pill warn">SOS</span>' : ''}</td><td class="num">${t.route.km.toFixed(1)}</td><td class="num">${rs(t.fare)}</td><td class="num">${t.quote.split.promoCost ? rs(t.quote.split.promoCost) : '–'}</td><td class="num">${t.driverType === 'employee' ? 'wage' : rs(t.quote.split.driver)}</td><td class="num">${rs(t.quote.split.platformFee)}</td></tr>`).join('')}</table>`;

    // map: wards shaded by demand + online drivers
    if (!map) {
      map = MR.map('map');
      MR.drawBoundary(map, await api('GET', '/api/boundary').catch(() => null));
      wardLayer = L.layerGroup().addTo(map);
      fleetLayer = L.layerGroup().addTo(map);
    }
    wardLayer.clearLayers();
    for (const w of wards) {
      const n = s.byWard[w.ward] || 0;
      L.geoJSON(w.geojson, { style: { color: '#0b7a6f', weight: 0.6, fillColor: '#0b7a6f', fillOpacity: n ? 0.08 + 0.5 * (n / max) : 0.02 } })
        .bindTooltip(`Ward ${w.ward} · ${esc(w.name)}<br>${w.population.toLocaleString('en-IN')} people · ${w.areaKm2} km²<br>${n} pickups`).addTo(wardLayer);
    }
    fleetLayer.clearLayers();
    drivers.filter((d) => d.online && d.loc).forEach((d) => L.marker([d.loc.lat, d.loc.lng], { icon: MR.vehicleIcon(d.vehicle.type) }).bindTooltip(`${esc(d.name)} · ${esc(d.status)}`).addTo(fleetLayer));
  }

  function renderKyc(apps, fleet) {
    const docs = (a) => Object.entries(a.documents || {}).map(([k, id]) => `<figure><img data-file="${id}" alt="${esc(k)}"><figcaption>${esc(k)}</figcaption></figure>`).join('');
    const free = fleet.filter((v) => !v.assignedDriverId);
    $('#kyc').innerHTML = apps.length ? apps.map((a) => {
      const p = a.personal || {};
      const face = (a.checks || []).find((c) => c.check === 'selfie_vs_id_photo');
      return `<div class="card" ${a.status === 'submitted' ? 'style="border:2px solid var(--accent)"' : ''}>
        <div class="kv"><b>${esc(p.fullName || a.phone)} · ${a.driverType === 'employee' ? 'Fleet employee' : 'Partner'}</b><span class="pill ${a.status === 'submitted' ? 'warn' : ''}">${esc(a.status)}</span></div>
        <div class="muted">${esc(a.phone)} · DOB ${esc(p.dob || '–')} · ${esc(p.gender || '')} · ${esc(p.address || '')} · Citizenship ${esc(p.citizenshipNo || '–')} (${esc(p.citizenshipDistrict || '')})${p.nidNo ? ` · NIN ${esc(p.nidNo)}` : ''}</div>
        <div class="muted">Licence ${esc(a.licence?.number || '–')} [${esc((a.licence?.categories || []).join(','))}] exp ${esc(a.licence?.expiry || '–')} ·
          ${a.driverType === 'partner' ? `Vehicle ${esc(a.vehicle?.type || '')} ${esc(a.vehicle?.plate || '')} ${esc(a.vehicle?.model || '')} · bluebook ${esc(a.vehicle?.bluebookNo || '–')} · ins. ${esc(a.vehicle?.insuranceExpiry || '–')}` : `Wants: ${esc(a.preferredVehicle || '')}`}</div>
        <div class="muted">Bank ${esc(a.bank?.bank || '–')}, ${esc(a.bank?.branch || '')} · ${esc(a.bank?.accountName || '')} · ${esc(a.bank?.accountNumber || '')}</div>
        <div class="docs">${docs(a)}</div>
        ${(a.checks || []).map((c) => `<div class="kv"><span>${esc(c.check.replace(/_/g, ' '))}</span><span class="${c.ok ? 'pos' : 'neg'}">${c.ok ? '✓' : '⚠'} ${esc(c.detail)}</span></div>`).join('')}
        ${a.status === 'submitted' ? `<div class="row" style="margin-top:8px">
          ${a.driverType === 'employee' ? `<select data-fv="${a.id}"><option value="">Assign fleet vehicle…</option>${free.map((v) => `<option value="${v.id}">${esc(v.type)} · ${esc(v.plate)} · ${esc(v.model)}</option>`).join('')}</select><input data-wage="${a.id}" type="number" value="${cfg.payroll.defaultWage}" min="${cfg.payroll.minimumWage}" title="Monthly wage">` : ''}
          <button class="btn small" data-rev="${a.id}" data-d="approve">Approve</button>
          <button class="btn ghost small" data-rev="${a.id}" data-d="resubmit">Ask to resubmit</button>
          <button class="btn danger small" data-rev="${a.id}" data-d="reject">Reject</button></div>
          ${face && !face.ok ? '<div class="pill warn" style="margin-top:6px">Face match below threshold — compare selfie and licence photo manually</div>' : ''}` : a.review ? `<div class="muted">Reviewed ${new Date(a.review.at).toLocaleString()} — ${esc(a.review.decision)} ${esc(a.review.reason || '')}</div>` : ''}
      </div>`;
    }).join('') : '<p class="muted">No applications yet.</p>';
    loadImages($('#kyc'));
    document.querySelectorAll('[data-rev]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.rev, decision = b.dataset.d;
        const body = { decision };
        if (decision !== 'approve') { body.reason = prompt('Reason (sent to the applicant)?'); if (!body.reason) return; }
        const fv = document.querySelector(`[data-fv="${id}"]`);
        if (fv) { body.fleetVehicleId = fv.value; body.monthlyWage = +document.querySelector(`[data-wage="${id}"]`).value; }
        try { await api('POST', `/api/admin/applications/${id}/review`, body, token); toast(`Application ${decision}d`); load(); } catch (e) { toast(e.message, 4000); }
      };
    });
  }

  function renderFleet(fleet, drivers) {
    $('#fleet').innerHTML = fleet.length ? `<table><tr><th>Vehicle</th><th>Plate</th><th>Fuel</th><th class="num">Lease/EMI</th><th>Driver</th></tr>${fleet.map((v) => `<tr><td>${esc(v.type)} · ${esc(v.model)}</td><td>${esc(v.plate)}</td><td>${esc(v.fuel)}</td><td class="num">${v.leaseMonthly ? rs(v.leaseMonthly) : '–'}</td><td>${v.assignedDriverId ? esc(drivers.find((d) => d.id === v.assignedDriverId)?.name || v.assignedDriverId) : '<span class="muted">unassigned</span>'}</td></tr>`).join('')}</table>` : '<p class="muted">No company vehicles yet. Add EV cars or trucks, then approve fleet-employee applications with a vehicle.</p>';
  }

  function renderPayouts(batches) {
    $('#payouts').innerHTML = batches.length ? batches.map((b) => `<div style="margin-top:10px"><div class="kv"><b>Week ${esc(b.week.start)} → ${esc(b.week.end)}</b><span>${rs(b.total)} to ${b.items.filter((i) => i.amount > 0 && i.bank).length} drivers · fees ${rs(b.transferFees)} · employer SSF ${rs(b.employerSsf)}</span></div>
      <table><tr><th>Driver</th><th>Type</th><th>Bank</th><th class="num">Amount</th><th>Notes</th></tr>${b.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.driverType)}</td><td class="muted">${i.bank ? `${esc(i.bank.bank)} ••${esc(String(i.bank.accountNumber).slice(-4))}` : 'no bank'}</td><td class="num">${rs(i.amount)}</td><td class="muted">${esc([...(i.payslip.warnings || []), i.payslip.carriedForward ? `carried ${rs(i.payslip.carriedForward)}` : '', i.payslip.cashToDeposit ? `cash to deposit ${rs(i.payslip.cashToDeposit)}` : ''].filter(Boolean).join(' · '))}</td></tr>`).join('')}</table>
      <button class="btn ghost small" data-csv="${b.id}" data-week="${b.weekId}">Download bank CSV</button></div>`).join('') : '<p class="muted">No payout batches yet.</p>';
    document.querySelectorAll('[data-csv]').forEach((btn) => {
      btn.onclick = async () => {
        const res = await fetch(`/api/admin/payouts/${btn.dataset.csv}/csv`, { headers: { Authorization: `Bearer ${token}` } });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await res.blob());
        a.download = `myride-payout-${btn.dataset.week}.csv`;
        a.click();
      };
    });
  }

  async function loadEconomics() {
    const e = await api('GET', '/api/admin/economics', null, token);
    const stages = ['launch', 'growth', 'mature'];
    const steps = e.comparison.mature.map((x) => x.label);
    $('#bridge').innerHTML = `<b>v1 → v2: what changed EBITDA (Rs/month, same ride volumes)</b><table><tr><th>Lever (cumulative)</th>${stages.map((s) => `<th class="num">${s}</th>`).join('')}</tr>
      ${steps.map((label, i) => `<tr><td>${esc(label)}</td>${stages.map((s) => { const v = e.comparison[s][i].ebitda; return `<td class="num ${v < 0 ? 'neg' : 'pos'}">${L_(v)}</td>`; }).join('')}</tr>`).join('')}</table>
      <div class="muted">Includes volume-driven costs (support, passenger insurance, peak incentives, bad debt) for both plans.</div>`;

    const rows = e.projection.rows;
    const W = 520, H = 170, pad = 28;
    const vals = rows.map((r) => r.cumulative), mx = Math.max(...vals, 0), mn = Math.min(...vals, 0);
    const x = (i) => pad + (i * (W - 2 * pad)) / (rows.length - 1), y = (v) => H - pad - ((v - mn) / (mx - mn || 1)) * (H - 2 * pad);
    const path = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.cumulative).toFixed(1)}`).join(' ');
    const bars = rows.map((r, i) => `<rect x="${(x(i) - 6).toFixed(1)}" y="${Math.min(y(0), y(r.ebitda)).toFixed(1)}" width="12" height="${Math.abs(y(r.ebitda) - y(0)).toFixed(1)}" fill="${r.ebitda < 0 ? '#d6342c' : '#1f9d55'}" opacity=".45"><title>M${r.month}: EBITDA ${L_(r.ebitda)}</title></rect>`).join('');
    $('#proj').innerHTML = `<b>24-month cash projection (v2)</b>
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Cumulative cash over 24 months">
        <line x1="${pad}" x2="${W - pad}" y1="${y(0)}" y2="${y(0)}" stroke="currentColor" opacity=".25"/>${bars}
        <path d="${path}" fill="none" stroke="#0b7a6f" stroke-width="2.5"/>
        <text x="${pad}" y="${H - 8}">M1</text><text x="${x(11) - 8}" y="${H - 8}">M12</text><text x="${W - pad - 16}" y="${H - 8}">M24</text>
        <text x="${pad}" y="12">${L_(mx)}</text><text x="${pad}" y="${H - pad + 12}">${L_(mn)}</text></svg>
      <div class="grid"><div class="tile"><div class="v">${L_(e.projection.peakCashNeed)}</div><div class="l">Peak cash needed</div></div>
        <div class="tile"><div class="v">M${e.projection.breakEvenMonth}</div><div class="l">EBITDA positive</div></div>
        <div class="tile"><div class="v">M${e.projection.paybackMonth}</div><div class="l">Investment paid back</div></div>
        <div class="tile"><div class="v">${e.projection.roi24.toFixed(1)}×</div><div class="l">24-mo cash ÷ peak investment</div></div></div>`;

    const sc = Object.values(e.scenarios);
    const line = (l, f) => `<tr><td>${l}</td>${sc.map((m) => `<td class="num">${f(m)}</td>`).join('')}</tr>`;
    $('#econ').innerHTML = `<b>Monthly P&L (v2)</b><table><tr><th></th>${sc.map((m) => `<th class="num">${esc(m.stage)}</th>`).join('')}</tr>
      ${line('Trips / day', (m) => m.tripsPerDay.toLocaleString('en-IN'))}${line('GMV', (m) => L_(m.gmv))}${line('Platform fees (ex-VAT)', (m) => L_(m.feeRevenue))}
      ${line('MyRide Plus (members)', (m) => `${L_(m.membershipRevenue)} (${m.members})`)}${line('Partnerships', (m) => L_(m.partnerships))}
      ${line('Free rides, referrals, promos', (m) => L_(-m.promo))}${line('Plus discounts', (m) => L_(-m.membershipCost))}${line('Volume costs (support, insurance, incentives…)', (m) => L_(-m.variableTotal))}
      ${line('Gateway, payouts, KYC', (m) => L_(-(m.gateway + m.payoutFees + m.kycCost)))}${line('Fixed costs', (m) => L_(-m.fixedCosts))}
      ${line('<b>EBITDA</b>', (m) => `<b class="${m.ebitda < 0 ? 'neg' : 'pos'}">${L_(m.ebitda)}</b>`)}${line('EBITDA margin', (m) => `${(m.ebitdaMargin * 100).toFixed(0)}%`)}${line('Break-even trips/day', (m) => (Number.isFinite(m.breakEvenTripsPerDay) ? m.breakEvenTripsPerDay.toLocaleString('en-IN') : '—'))}</table>`;
    const f = e.fleet;
    $('#fleetEcon').innerHTML = `<b>Salaried fleet EV car (per vehicle / month)</b> <span class="muted">Price ${rs(f.vehiclePrice)}, 20% down, EMI ${rs(f.emi)}, avg fare ${rs(f.avgFare)}</span>
      <table><tr><th></th><th class="num">1 shift (8 h)</th><th class="num">2 shifts (16 h)</th></tr>
      ${['trips', 'revenue', 'wages', 'energy', 'vehicle', 'marginPerMonth'].map((k) => `<tr><td>${k === 'marginPerMonth' ? '<b>Margin</b>' : k}</td><td class="num ${k === 'marginPerMonth' ? (f.singleShift[k] < 0 ? 'neg' : 'pos') : ''}">${k === 'trips' ? f.singleShift[k] : rs(f.singleShift[k])}</td><td class="num ${k === 'marginPerMonth' ? 'pos' : ''}">${k === 'trips' ? f.doubleShift[k] : rs(f.doubleShift[k])}</td></tr>`).join('')}</table>
      <div class="muted">Fleet cars only pay off when double-shifted. Start with a handful of EV cars for the airport and Lakeside, and keep the rest partner-owned (asset-light).</div>`;
  }

  $('#fvAdd').onclick = async () => {
    try { await api('POST', '/api/admin/fleet', { type: $('#fvType').value, fuel: $('#fvFuel').value, plate: $('#fvPlate').value, model: $('#fvModel').value, leaseMonthly: +$('#fvLease').value || 0 }, token); toast('Vehicle added'); load(); } catch (e) { toast(e.message); }
  };
  $('#runPay').onclick = async () => { try { const b = await api('POST', '/api/admin/payouts/run', {}, token); toast(`Payout batch ${b.week.start}: ${rs(b.total)}`); load(); } catch (e) { toast(e.message); } };
  $('#pAdd').onclick = async () => {
    $('#pErr').textContent = '';
    try {
      await api('POST', '/api/admin/promos', { code: $('#pCode').value, type: $('#pType').value, value: +$('#pVal').value || 1, maxOff: +$('#pMax').value || undefined, usageLimit: +$('#pLimit').value || undefined, expiresAt: $('#pExp').value || undefined, newUsersOnly: $('#pNew').checked }, token);
      toast('Promo created'); load();
    } catch (e) { $('#pErr').textContent = e.message; }
  };

  async function start() {
    $('#login').classList.add('hidden'); $('#dash').classList.remove('hidden'); $('#logout').classList.remove('hidden');
    try {
      cfg = await api('GET', '/api/config');
      $('#fvType').innerHTML = Object.entries(cfg.vehicles).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
      wards = await api('GET', '/api/wards');
      await load();
      await loadEconomics();
    } catch (e) { $('#dash').innerHTML = `<p class="err">${esc(e.message)} — sign in with an admin number (dev: 9800000000).</p>`; return; }
    setInterval(() => load().catch(() => {}), 5000);
    MR.events(`token=${token}`, (m) => {
      const card = (html) => $('#alerts').insertAdjacentHTML('afterbegin', `<div class="card" style="border:2px solid var(--danger)">${html}</div>`);
      if (m.type === 'sos') card(`<b class="neg">SOS</b> trip ${esc(m.tripId)} · customer ${esc(m.rider)} · ${new Date(m.incident.at).toLocaleTimeString()} ${m.incident.loc ? `· <a target="_blank" href="https://www.openstreetmap.org/?mlat=${m.incident.loc.lat}&mlon=${m.incident.loc.lng}#map=17/${m.incident.loc.lat}/${m.incident.loc.lng}">location</a>` : ''}`);
      if (m.type === 'face_fail') card(`<b class="neg">Face verification failed twice</b> — ${esc(m.name)} suspended pending review`);
      if (m.type === 'kyc_submitted') toast('New driver application to review');
      if (m.type === 'client_error' && m.fatal) toast(`App crash (${m.app}): ${m.message}`);
    });
  }
  $('#logout').onclick = () => { MR.store.del(MR.tokenKey('admin')); location.reload(); };
  (async () => {
    if (token) { try { const me = await api('GET', '/api/me', null, token); if (me.portal === 'admin') return start(); } catch { /* expired */ } MR.store.del(MR.tokenKey('admin')); token = null; }
    MR.loginFlow($('#login'), { portal: 'admin', title: 'MyRide Ops sign-in', onDone: (r) => { token = r.token; start(); } });
  })();
})();
