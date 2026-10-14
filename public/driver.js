(() => {
  const { api, $, rs, esc, toast } = MR;
  const S = { token: MR.store.get(MR.tokenKey('driver')), cfg: null, dash: null, app: null, step: 0, loc: null, trip: null, offers: [] };
  const map = MR.map('map');
  const mk = { me: null, line: null, pickup: null, drop: null };
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  const D = () => S.dash?.driver;

  // ---------- location ----------
  function setLoc(p) {
    S.loc = { lat: p.lat, lng: p.lng };
    if (!mk.me) mk.me = L.marker([p.lat, p.lng], { icon: MR.vehicleIcon(D()?.vehicle?.type) }).addTo(map);
    else mk.me.setLatLng([p.lat, p.lng]);
    if (D()?.online) api('POST', '/api/driver/location', S.loc, S.token).catch(() => {});
  }
  map.on('click', (e) => { if (!S.trip && D()) setLoc(e.latlng); });
  $('#gps').onclick = () => navigator.geolocation?.getCurrentPosition((p) => { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); map.setView([p.coords.latitude, p.coords.longitude], 15); }, () => toast('GPS unavailable — tap the map'));

  // =====================================================================
  // Application (KYC) wizard
  // =====================================================================
  const STEPS = ['Driver type', 'Personal', 'Licence & vehicle', 'Bank account', 'Documents', 'Face verification', 'Submit'];
  const DOC_LABELS = {
    citizenshipFront: 'Citizenship certificate — front', citizenshipBack: 'Citizenship certificate — back', licence: 'Driving licence (smart card)',
    policeReport: 'Police report (character certificate)', bluebook: 'Bluebook (vehicle registration)', insurance: 'Vehicle insurance certificate',
  };
  const val = (id) => $(`#${id}`)?.value?.trim();
  const a = () => S.app || {};

  async function save(patch) {
    S.app = await api('PUT', '/api/driver/application', patch, S.token);
    return S.app;
  }

  function renderApply() {
    show('#apply', true); show('#home', false);
    const app = a();
    if (app.status === 'submitted') {
      $('#apply').innerHTML = `<div class="card"><div class="status">✅ Application submitted</div>
        <p class="muted">Our Pokhara team verifies your documents, police report and face match — usually within 48 hours. You'll get an SMS when approved.</p>
        ${(app.checks || []).map((c) => `<div class="kv"><span>${esc(c.check.replace(/_/g, ' '))}</span><span class="${c.ok ? 'pos' : 'neg'}">${c.ok ? '✓' : '⚠'} </span></div>`).join('')}</div>
        <button class="btn ghost" id="refresh">Check status</button>`;
      $('#refresh').onclick = boot;
      return;
    }
    const banner = ['rejected', 'resubmit'].includes(app.status) ? `<div class="card" style="border-color:var(--danger)"><b class="neg">${app.status === 'rejected' ? 'Application rejected' : 'Please fix and resubmit'}</b><div class="muted">${esc(app.review?.reason || '')}</div></div>` : '';
    $('#apply').innerHTML = `${banner}<h3 style="margin:4px 0">Join MyRide Drive</h3>
      <div class="muted">Step ${S.step + 1} of ${STEPS.length}: <b>${STEPS[S.step]}</b></div>
      <div class="steps">${STEPS.map((_, i) => `<span class="${i <= S.step ? 'on' : ''}"></span>`).join('')}</div>
      <div id="stepBody"></div><p class="err" id="aerr"></p>
      <div class="row"><button class="btn ghost" id="back" ${S.step ? '' : 'disabled'}>Back</button><button class="btn" id="next">${S.step === STEPS.length - 1 ? 'Submit application' : 'Save & continue'}</button></div>`;
    STEP_RENDER[S.step]();
    $('#back').onclick = () => { S.step = Math.max(0, S.step - 1); renderApply(); };
    $('#next').onclick = async () => {
      $('#aerr').textContent = '';
      $('#next').disabled = true;
      try { await STEP_SAVE[S.step](); if (S.step < STEPS.length - 1) { S.step++; renderApply(); } } catch (e) { $('#aerr').innerHTML = esc(e.message); }
      if ($('#next')) $('#next').disabled = false;
    };
  }

  const vehicleOptions = (sel) => Object.entries(S.cfg.vehicles).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(v.label)} — licence ${v.licence.join('/')}</option>`).join('');

  const STEP_RENDER = [
    () => {
      const t = a().driverType;
      $('#stepBody').innerHTML = `
        <div class="card quote ${t === 'partner' ? 'sel' : ''}" data-t="partner"><div><div class="name">🛵 Partner — use my own vehicle</div>
          <div class="meta">Motorcycle/scooter, car, mini-truck, pickup or truck. Keep your earnings minus a low fee (max 10% per ride, Rs 10 max on motorcycles). Weekly bank payout.</div></div></div>
        <div class="card quote ${t === 'employee' ? 'sel' : ''}" data-t="employee"><div><div class="name">🏢 MyRide Fleet — salaried driver</div>
          <div class="meta">We provide the vehicle (EV cars, trucks). Hourly wage from Rs ${S.cfg.payroll?.defaultWage || '25,000'}/month equivalent, overtime ×1.5, trip incentives, SSF. Paid weekly.</div></div></div>`;
      document.querySelectorAll('[data-t]').forEach((el) => { el.onclick = () => { S.app = { ...a(), driverType: el.dataset.t }; STEP_RENDER[0](); }; });
    },
    () => {
      const p = a().personal || {};
      $('#stepBody').innerHTML = `
        <label for="fn">Full legal name (as on citizenship)</label><input id="fn" value="${esc(p.fullName || '')}" autocomplete="name">
        <div class="row"><div><label for="dob">Date of birth (AD)</label><input id="dob" type="date" value="${esc(p.dob || '')}"></div>
          <div><label for="gen">Gender</label><select id="gen">${['male', 'female', 'other'].map((g) => `<option ${p.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div></div>
        <label for="addr">Permanent address</label><input id="addr" value="${esc(p.address || '')}" placeholder="e.g. Pokhara-27, Tal Chowk, Kaski">
        <div class="row"><div><label for="ctz">Citizenship no.</label><input id="ctz" value="${esc(p.citizenshipNo || '')}" placeholder="45-01-77-12345"></div>
          <div><label for="ctzd">Issued district</label><input id="ctzd" value="${esc(p.citizenshipDistrict || 'Kaski')}"></div></div>
        <label for="nid">National ID (NIN, optional)</label><input id="nid" value="${esc(p.nidNo || '')}" inputmode="numeric" maxlength="12" placeholder="10 digits">
        <label for="emg">Emergency contact (name & mobile)</label><input id="emg" value="${esc(p.emergencyContact || '')}">`;
    },
    () => {
      const l = a().licence || {}, v = a().vehicle || {};
      const cats = l.categories || [];
      const partner = a().driverType === 'partner';
      $('#stepBody').innerHTML = `
        <label for="lic">Driving licence number</label><input id="lic" value="${esc(l.number || '')}" placeholder="04-06-12345678">
        <label>Licence categories</label><div class="cats">${['A', 'K', 'B', 'F', 'G'].map((c) => `<label><input type="checkbox" value="${c}" ${cats.includes(c) ? 'checked' : ''}> ${c}</label>`).join('')}</div>
        <div class="muted">A motorcycle · K scooter · B car/van/jeep/pickup · F minitruck · G truck</div>
        <label for="lexp">Licence expiry</label><input id="lexp" type="date" value="${esc(l.expiry || '')}">
        ${partner ? `
        <label for="vt">Your vehicle</label><select id="vt">${vehicleOptions(v.type)}</select>
        <div class="row"><div><label for="fuel">Fuel</label><select id="fuel"><option value="petrol">Petrol</option><option value="diesel" ${v.fuel === 'diesel' ? 'selected' : ''}>Diesel</option><option value="ev" ${v.fuel === 'ev' ? 'selected' : ''}>Electric</option></select></div>
          <div><label for="seats">Seats</label><input id="seats" type="number" min="1" max="5" value="${esc(v.seats || 4)}"></div></div>
        <div class="row"><div><label for="plate">Number plate</label><input id="plate" value="${esc(v.plate || '')}" placeholder="GA 1 PA 4455"></div><div><label for="model">Model</label><input id="model" value="${esc(v.model || '')}"></div></div>
        <div class="row"><div><label for="bb">Bluebook no.</label><input id="bb" value="${esc(v.bluebookNo || '')}"></div><div><label for="ins">Insurance valid until</label><input id="ins" type="date" value="${esc(v.insuranceExpiry || '')}"></div></div>
        <label class="check"><input type="checkbox" id="pub" ${v.publicPlate ? 'checked' : ''}> Car has a public (black) plate</label>
        <label class="check"><input type="checkbox" id="gp" ${v.goodsPermit ? 'checked' : ''}> Goods vehicle registered for goods transport</label>`
        : `<label for="pv">Vehicle you want to drive</label><select id="pv">${vehicleOptions(a().preferredVehicle)}</select>`}`;
    },
    () => {
      const b = a().bank || {};
      $('#stepBody').innerHTML = `<p class="muted">Weekly payouts go only to an account in <b>your own name</b>.</p>
        <label for="bank">Bank</label><select id="bank"><option value="">Choose…</option>${S.cfg.kyc.banks.map((x) => `<option ${b.bank === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <label for="br">Branch</label><input id="br" value="${esc(b.branch || '')}" placeholder="e.g. Lakeside, Pokhara">
        <label for="an">Account holder name</label><input id="an" value="${esc(b.accountName || a().personal?.fullName || '')}">
        <label for="ac">Account number</label><input id="ac" inputmode="numeric" value="${esc(b.accountNumber || '')}">`;
    },
    () => {
      const docs = (a().requiredDocuments || []).filter((d) => d !== 'selfie');
      $('#stepBody').innerHTML = `<p class="muted">Take clear photos in good light. Max 1.5 MB each (we compress automatically).</p>
        ${docs.map((d) => `<div class="doc"><label for="f_${d}">${esc(DOC_LABELS[d] || d)}</label>
          <span>${a().documents?.[d] ? '<span class="pos">✓ uploaded</span>' : ''} <input id="f_${d}" data-doc="${d}" type="file" accept="image/*,application/pdf" capture="environment" style="width:auto"></span></div>`).join('')}
        <p class="muted" id="docMsg"></p>`;
      document.querySelectorAll('[data-doc]').forEach((inp) => {
        inp.onchange = async () => {
          const file = inp.files[0];
          if (!file) return;
          $('#docMsg').textContent = 'Uploading…';
          try {
            const data = await MR.fileToDataUrl(file);
            await api('POST', '/api/driver/application/documents', { kind: inp.dataset.doc, data }, S.token);
            if (inp.dataset.doc === 'licence' && data.startsWith('data:image')) {
              $('#docMsg').textContent = 'Reading the photo on your licence…';
              const idDescriptor = await MRFace.fromImage(data).catch(() => null);
              await save({ face: { idDescriptor } });
            }
            S.app = await api('GET', '/api/driver/application', null, S.token);
            STEP_RENDER[4]();
            toast('Uploaded');
          } catch (e) { $('#docMsg').textContent = e.message; }
        };
      });
    },
    () => {
      const f = a().face || {};
      $('#stepBody').innerHTML = `<p class="muted">Like Uber's Real-Time ID Check: we match your live selfie to your licence photo now, and ask for quick random selfies before and during shifts to make sure only you drive your account.</p>
        ${f.selfie ? `<div class="card"><span class="pos">✓ Selfie captured</span> ${f.liveness?.passed ? '· liveness passed' : ''}</div>` : ''}
        <div id="cam"></div><p class="muted" id="camMsg"></p>
        <button class="btn accent" id="snap">${f.selfie ? 'Retake selfie' : 'Start camera'}</button>`;
      $('#snap').onclick = async () => {
        $('#snap').disabled = true;
        try {
          const r = await MRFace.captureLive($('#cam'), { onStatus: (m) => { $('#camMsg').textContent = m; } });
          await api('POST', '/api/driver/application/documents', { kind: 'selfie', data: r.photo }, S.token);
          await save({ face: { selfieDescriptor: r.descriptor, liveness: r.liveness } });
          toast('Selfie saved');
          STEP_RENDER[5]();
        } catch (e) { $('#camMsg').textContent = e.message; $('#snap').disabled = false; }
      };
    },
    () => {
      $('#stepBody').innerHTML = `<div class="card"><b>Background check & consent</b>
        <p class="muted">I confirm the details are true. I consent to MyRide verifying my documents and police report, matching my face to my ID, and running random selfie checks. My data is used only for safety and payouts.</p>
        <label class="check"><input type="checkbox" id="consent" ${a().consent ? 'checked' : ''}> I agree</label></div>
        <div class="muted">Gandaki rules apply: max 12 driving hours a day; cars need a black plate and ≤ 5 seats.</div>`;
    },
  ];

  const STEP_SAVE = [
    async () => { if (!a().driverType) throw new Error('Choose how you want to work'); await save({ driverType: a().driverType }); },
    async () => save({ personal: { fullName: val('fn'), dob: val('dob'), gender: val('gen'), address: val('addr'), citizenshipNo: val('ctz'), citizenshipDistrict: val('ctzd'), nidNo: val('nid') || undefined, emergencyContact: val('emg') } }),
    async () => {
      const licence = { number: val('lic'), categories: [...document.querySelectorAll('.cats input:checked')].map((x) => x.value), expiry: val('lexp') };
      if (a().driverType === 'partner') return save({ licence, vehicle: { type: val('vt'), fuel: val('fuel'), seats: +val('seats'), plate: val('plate'), model: val('model'), bluebookNo: val('bb'), insuranceExpiry: val('ins'), publicPlate: $('#pub').checked, goodsPermit: $('#gp').checked } });
      return save({ licence, preferredVehicle: val('pv') });
    },
    async () => save({ bank: { bank: val('bank'), branch: val('br'), accountName: val('an'), accountNumber: val('ac') } }),
    async () => { const missing = (a().requiredDocuments || []).filter((d) => d !== 'selfie' && !a().documents?.[d]); if (missing.length) throw new Error(`Upload: ${missing.map((d) => DOC_LABELS[d]).join(', ')}`); },
    async () => { if (!a().face?.selfie) throw new Error('Take your selfie first'); },
    async () => {
      if (!$('#consent').checked) throw new Error('Please accept the consent');
      await save({ consent: true });
      try { S.app = await api('POST', '/api/driver/application/submit', {}, S.token); renderApply(); }
      catch (e) { throw new Error(e.message); }
    },
  ];

  // Reopening a draft continues at the first incomplete step.
  function resumeStep(app) {
    if (!app.driverType) return 0;
    if (!app.personal?.fullName) return 1;
    if (!app.licence?.number) return 2;
    if (!app.bank?.accountNumber) return 3;
    if ((app.requiredDocuments || []).some((d) => d !== 'selfie' && !app.documents?.[d])) return 4;
    if (!app.face?.selfie) return 5;
    return 6;
  }

  // =====================================================================
  // Random selfie check (Real-Time ID)
  // =====================================================================
  function faceCheckModal(reason) {
    show('#modal', true);
    $('#modal').innerHTML = `<div class="card"><div class="status">🤳 Quick selfie check</div>
      <p class="muted">${reason === 'random_while_online' ? 'Random safety check — ' : ''}Make sure it's really you driving. Takes 5 seconds.</p>
      <div id="mcam"></div><p class="muted" id="mmsg"></p><p class="err" id="merr"></p>
      <button class="btn" id="mgo">Open camera</button></div>`;
    $('#mgo').onclick = async () => {
      $('#mgo').disabled = true;
      try {
        const r = await MRFace.captureLive($('#mcam'), { liveness: true, onStatus: (m) => { $('#mmsg').textContent = m; } });
        const res = await api('POST', '/api/driver/face-check', { descriptor: r.descriptor, photo: r.photo }, S.token);
        if (res.passed) { show('#modal', false); toast('Verified — thanks!'); await refreshDash(); }
        else if (res.suspended) { $('#merr').textContent = 'We could not verify you. Your account is paused for review — call MyRide support.'; }
        else { $('#merr').textContent = 'Face did not match. Remove helmet/mask, face the light and try again.'; $('#mgo').disabled = false; }
      } catch (e) { $('#merr').textContent = e.message; $('#mgo').disabled = false; }
    };
  }

  // =====================================================================
  // Approved driver home
  // =====================================================================
  function renderHome() {
    show('#apply', false); show('#home', true);
    const d = D();
    const emp = d.driverType === 'employee';
    $('#dname').textContent = d.name;
    $('#drating').textContent = `★ ${d.rating}`;
    $('#dveh').innerHTML = `${esc(d.vehicle.model || d.vehicle.type)} · <b>${esc(d.vehicle.plate)}</b> ${d.vehicle.fuel === 'ev' ? '<span class="pill ev">EV</span>' : ''}`;
    $('#dtype').innerHTML = `${emp ? `<span class="pill">MyRide Fleet · ${rs(d.employment.monthlyWage)}/month</span>` : '<span class="pill">Partner</span>'} ${d.suspended ? `<span class="pill warn">${esc(d.suspended.reason)}</span>` : ''}`;
    const w = S.dash.thisWeek;
    const tiles = emp
      ? [['Hours this week', `${(w.regularHours + w.overtimeHours).toFixed(1)} h`], ['Trips this week', w.trips], ['Wages so far', rs(w.net)], ['Cash to deposit', rs(d.cashHeld || 0)], ['Hours left today', `${Math.max(0, d.hoursLeftToday).toFixed(1)} h`]]
      : [['Earned today', rs(d.earnings.today)], ['This week', rs(w.weekNet)], [d.wallet < 0 ? 'You owe (cash trips)' : 'Next payout', rs(Math.abs(d.wallet))], ['Trips (all time)', d.earnings.trips], ['Hours left today', `${Math.max(0, d.hoursLeftToday).toFixed(1)} h`]];
    $('#tiles').innerHTML = tiles.map(([l, v]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
    $('#week').innerHTML = w.lines.map((l) => `<div class="kv"><span>${esc(l.label)}</span><span class="${l.amount < 0 ? 'neg' : ''}">${rs(l.amount)}</span></div>`).join('')
      + (emp ? `<div class="kv total"><span>Net wages</span><span>${rs(w.net)}</span></div><div class="muted">Employer SSF (20% of basic) paid by MyRide: ${rs(w.ssfEmployer)}</div>` : `<div class="kv total"><span>Balance</span><span>${rs(w.balance)}</span></div>`)
      + (w.warnings || []).map((x) => `<div class="pill warn" style="margin-top:6px">${esc(x)}</div>`).join('')
      + `<div class="muted" style="margin-top:6px">Paid every Sunday to ${esc(d.bank?.bank || 'your bank')} ••••${esc(String(d.bank?.accountNumber || '').slice(-4))}</div>`;
    $('#payouts').innerHTML = S.dash.payouts.length ? S.dash.payouts.map((p) => `<div class="card"><div class="kv"><span>${esc(p.week.start)} → ${esc(p.week.end)}</span><b>${rs(p.amount)}</b></div><div class="muted">${esc(p.status.replace(/_/g, ' '))}</div></div>`).join('') : '<p class="muted">No payouts yet.</p>';
    $('#homeBtn').textContent = d.homeFilter ? `🏠 Heading home to ${d.homeFilter.ward || 'home'} — tap to stop` : '🏠 Heading home — only trips toward home (2/day)';
    $('#onBtn').textContent = d.online ? 'Go offline' : 'Go online';
    $('#onBtn').className = d.online ? 'btn danger' : 'btn';
    $('#hint').textContent = d.online ? (S.trip ? 'On a trip' : 'Online — waiting for requests') : 'Offline';
    if (d.loc && !S.loc) setLoc(d.loc);
  }

  async function refreshDash() {
    S.dash = await api('GET', '/api/driver/dashboard', null, S.token);
    if (S.dash.driver) renderHome();
  }

  $('#onBtn').onclick = async () => {
    try {
      await api('POST', '/api/driver/online', { online: !D().online, loc: S.loc }, S.token);
      await refreshDash();
      if (D().online) pollOffers();
    } catch (e) {
      if (/selfie/i.test(e.message)) faceCheckModal('go_online');
      else toast(e.message, 4000);
    }
  };

  // Home = the ward in the driver's KYC address if we can match it, else tap-to-set via current map position.
  $('#homeBtn').onclick = async () => {
    try {
      if (D().homeFilter) { await api('POST', '/api/driver/heading-home', { loc: null }, S.token); return refreshDash(); }
      const m = /Pokhara-(\d+)/i.exec(D().homeAddress || '') || null;
      const wards = S.wards || (S.wards = await api('GET', '/api/wards'));
      const w = m && wards.find((x) => x.ward === +m[1]);
      if (!w && !confirm('Your KYC address has no ward number (Pokhara-NN). Use the pin on the map as home?')) return;
      const loc = w ? { lat: w.lat, lng: w.lng } : S.loc;
      if (!loc) return toast('Tap the map where home is first');
      await api('POST', '/api/driver/heading-home', { loc }, S.token);
      toast(w ? `Only trips toward Ward ${w.ward} · ${w.name}` : 'Only trips toward your pinned home');
      refreshDash();
    } catch (e) { toast(e.message); }
  };

  async function pollOffers() {
    if (!D()?.online || S.trip) return;
    S.offers = await api('GET', '/api/driver/offers', null, S.token).catch(() => []);
    renderOffers();
  }

  function renderOffers() {
    $('#offers').innerHTML = S.offers.map((o) => {
      const secs = Math.max(0, Math.round((o.offerExpiresAt - Date.now()) / 1000));
      return `<div class="card" style="border:2px solid var(--accent)">
        <div class="kv"><b>${o.logistics ? '🚚 Logistics' : o.kind === 'delivery' ? '📦 Parcel' : '🧍 Ride'} · ${esc(o.service.replace('_', ' '))}</b><span class="muted">${secs}s</span></div>
        ${o.employee ? `<div class="kv"><span>Fare (company)</span><b>${rs(o.fare)}</b></div>` : `<div class="kv"><span>You earn</span><b class="pos">${rs(o.earning + o.deadKmBonus)}</b></div>`}
        ${o.deadKmBonus ? `<div class="muted">Includes ${rs(o.deadKmBonus)} long-pickup bonus (paid by MyRide)</div>` : ''}
        <div class="muted">Pickup ${o.pickupKm} km away · Trip ${o.km.toFixed(1)} km · ${o.payment}</div>
        <div class="muted">${esc(o.pickup.label)} → ${esc(o.drop.label)}</div>
        ${o.parcel ? `<div class="muted">${esc(o.parcel.goodsType || 'parcel')} · ${o.parcel.weightKg} kg ${o.parcel.helpers ? `· ${o.parcel.helpers} helpers` : ''} ${o.parcel.fragile ? '· fragile' : ''} ${o.parcel.codAmount ? `· collect COD ${rs(o.parcel.codAmount)}` : ''}</div>` : ''}
        <button class="btn" data-acc="${o.id}" style="margin-top:8px">Accept</button></div>`;
    }).join('');
    document.querySelectorAll('[data-acc]').forEach((b) => {
      b.onclick = async () => {
        try { showActive(await api('POST', `/api/trips/${b.dataset.acc}/accept`, {}, S.token)); S.offers = []; renderOffers(); }
        catch (e) { if (/selfie/i.test(e.message)) faceCheckModal('accept'); else toast(e.message); pollOffers(); }
      };
    });
  }

  function drawTrip(t) {
    for (const k of ['line', 'pickup', 'drop']) if (mk[k]) { mk[k].remove(); mk[k] = null; }
    if (!t) return;
    mk.pickup = L.marker([t.pickup.lat, t.pickup.lng], { icon: MR.dot('#0b7a6f') }).addTo(map);
    mk.drop = L.marker([t.drop.lat, t.drop.lng], { icon: MR.dot('#f29e1f') }).addTo(map);
    mk.line = L.polyline(t.geometry, { color: '#0b7a6f', weight: 5, opacity: 0.75 }).addTo(map);
    map.fitBounds(L.latLngBounds([[t.pickup.lat, t.pickup.lng], [t.drop.lat, t.drop.lng], ...(S.loc ? [[S.loc.lat, S.loc.lng]] : [])]), { padding: [40, 40] });
  }

  function showActive(t) {
    const first = !S.trip || S.trip.id !== t.id;
    S.trip = ['accepted', 'arrived', 'in_progress'].includes(t.status) ? t : null;
    if (first || !S.trip) drawTrip(S.trip);
    if (!S.trip) {
      $('#active').innerHTML = t.status === 'completed' ? `<div class="card"><b class="pos">Trip completed${t.earning != null ? ` · +${rs(t.earning)}` : ''}</b></div>` : t.status === 'cancelled' ? '<div class="card"><b>Trip cancelled by customer</b></div>' : '';
      refreshDash();
      return;
    }
    const target = t.status === 'in_progress' ? t.drop : t.pickup;
    const nav = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
    const goods = t.kind === 'delivery';
    $('#active').innerHTML = `<div class="card" style="border:2px solid var(--brand)">
      <div class="status">${{ accepted: 'Go to pickup', arrived: 'Waiting for customer', in_progress: goods ? 'Delivering' : 'Driving to drop' }[t.status]}</div>
      <div class="muted">${esc(t.status === 'in_progress' ? t.drop.label : t.pickup.label)}</div>
      <div class="kv"><span>${esc(t.riderName)}</span>${t.riderPhone ? `<a href="tel:${esc(t.riderPhone)}">📞 ${esc(t.riderPhone)}</a>` : ''}</div>
      ${t.note ? `<div class="muted">Note: ${esc(t.note)}</div>` : ''}
      ${t.recipient?.phone ? `<div class="kv"><span>Receiver ${esc(t.recipient.name)}</span><a href="tel:${esc(t.recipient.phone)}">📞 ${esc(t.recipient.phone)}</a></div>` : ''}
      <div class="kv"><span>Fare (${esc(t.payment)})</span><b>${rs(t.fare)}</b></div>
      <a class="btn ghost" href="${nav}" target="_blank" rel="noopener">🧭 Navigate</a><p></p>
      ${t.status === 'accepted' ? '<button class="btn" id="arrBtn">I have arrived</button>' : ''}
      ${t.status === 'arrived' ? '<label for="pinIn">Customer\'s 4-digit PIN</label><input id="pinIn" inputmode="numeric" maxlength="4"><p></p><button class="btn" id="startBtn">Start trip</button>' : ''}
      ${t.status === 'in_progress' && goods ? `<label for="otpIn">Receiver's delivery code</label><input id="otpIn" inputmode="numeric" maxlength="4">
        ${t.logistics ? '<label for="podIn">Proof-of-delivery photo</label><input id="podIn" type="file" accept="image/*" capture="environment">' : ''}
        ${t.parcel?.codAmount ? `<label class="check"><input type="checkbox" id="codIn"> I collected ${rs(t.parcel.codAmount)} cash-on-delivery</label>` : ''}` : ''}
      ${t.status === 'in_progress' ? `<p></p><button class="btn" id="doneBtn">${goods ? 'Confirm delivery' : 'Complete trip'}</button>` : ''}
      ${t.status !== 'in_progress' ? '<p></p><button class="btn ghost" id="dcancel" style="color:var(--danger)">Cancel (trip goes back to search)</button>' : ''}
      <p class="err" id="aerr2"></p></div>`;
    const act = (path, body) => async () => {
      $('#aerr2').textContent = '';
      try { showActive(await api('POST', `/api/trips/${t.id}/${path}`, typeof body === 'function' ? await body() : body, S.token)); } catch (e) { $('#aerr2').textContent = e.message; }
    };
    $('#arrBtn')?.addEventListener('click', act('arrived', {}));
    $('#startBtn')?.addEventListener('click', act('start', () => ({ pin: $('#pinIn').value.trim() })));
    $('#doneBtn')?.addEventListener('click', act('complete', async () => ({
      deliveryOtp: $('#otpIn')?.value.trim(), codCollected: $('#codIn')?.checked,
      podPhoto: $('#podIn')?.files[0] ? await MR.fileToDataUrl($('#podIn').files[0], 1280) : undefined,
    })));
    $('#dcancel')?.addEventListener('click', async () => {
      if (!confirm('Cancelling hurts your acceptance score. Continue?')) return;
      try { await api('POST', `/api/trips/${t.id}/cancel`, { reason: 'driver_cancelled' }, S.token); S.trip = null; drawTrip(null); $('#active').innerHTML = ''; refreshDash(); } catch (e) { $('#aerr2').textContent = e.message; }
    });
  }

  // Demo helper: move the driver along the road route so the rider sees live tracking.
  let drive = null;
  setInterval(() => {
    if (!$('#autoDrive').checked || !S.trip || !S.loc) { drive = null; return; }
    const phase = S.trip.status === 'in_progress' ? 'trip' : S.trip.status === 'accepted' ? 'pickup' : null;
    if (!phase) return;
    if (!drive || drive.phase !== phase || drive.tripId !== S.trip.id) {
      const pts = phase === 'trip' ? S.trip.geometry : [[S.loc.lat, S.loc.lng], [S.trip.pickup.lat, S.trip.pickup.lng]];
      drive = { phase, tripId: S.trip.id, pts, i: 0 };
    }
    drive.i = Math.min(drive.pts.length - 1, drive.i + Math.max(1, Math.ceil(drive.pts.length / 25)));
    const [lat, lng] = drive.pts[drive.i];
    setLoc({ lat, lng });
  }, 1000);

  // =====================================================================
  // Boot
  // =====================================================================
  let streams = false;
  async function boot() {
    show('#login', false); show('#logout', true);
    S.dash = await api('GET', '/api/driver/dashboard', null, S.token);
    if (!S.dash.driver) {
      S.app = S.dash.application || {};
      S.step = resumeStep(S.app);
      renderApply();
      return;
    }
    renderHome();
    const trips = await api('GET', '/api/trips', null, S.token);
    const active = trips.find((t) => ['accepted', 'arrived', 'in_progress'].includes(t.status));
    if (active) showActive(active);
    if (D().faceCheck?.pending) faceCheckModal(D().faceCheck.reason);
    if (streams) return;
    streams = true;
    MR.events(`token=${S.token}`, (msg) => {
      if (msg.type === 'offer') { S.offers = [msg.trip, ...S.offers.filter((o) => o.id !== msg.trip.id)]; renderOffers(); toast('New trip request!'); }
      if (msg.type === 'trip' && S.trip && msg.trip.id === S.trip.id) showActive(msg.trip);
      if (msg.type === 'trip' && !S.trip) { S.offers = S.offers.filter((o) => o.id !== msg.trip.id || msg.trip.status === 'searching'); renderOffers(); }
      if (msg.type === 'face_check') { if (msg.status === 'required') faceCheckModal('random_while_online'); else { toast(msg.message, 5000); refreshDash(); } }
    });
    setInterval(() => { pollOffers(); if (S.offers.length) renderOffers(); }, 3000);
    setInterval(() => !S.trip && D() && refreshDash().catch(() => {}), 15000);
  }
  $('#logout').onclick = () => { MR.store.del(MR.tokenKey('driver')); location.reload(); };

  (async () => {
    S.cfg = await api('GET', '/api/config');
    MR.drawBoundary(map, await api('GET', '/api/boundary').catch(() => null));
    if (S.token) {
      try { const me = await api('GET', '/api/me', null, S.token); if (me.portal === 'driver') return boot(); } catch { /* expired */ }
      MR.store.del(MR.tokenKey('driver')); S.token = null;
    }
    MR.loginFlow($('#login'), { portal: 'driver', title: 'Sign in to MyRide Drive', onDone: (r) => { S.token = r.token; boot(); } });
  })();
})();
