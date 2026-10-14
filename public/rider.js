(() => {
  const { api, $, rs, esc, toast } = MR;
  const npr = (n) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const I18N = {
    ne: {
      tagline: 'पोखराको उचित भाडा — राइड, पार्सल र ढुवानी', ride: 'राइड', delivery: 'पार्सल', logistics: 'ढुवानी', history: 'यात्रा', account: 'खाता',
      pickup: 'लिने ठाउँ', drop: 'पुर्‍याउने ठाउँ', fixed: 'पर्यटक निश्चित भाडा (कहिल्यै बढी छैन)', weight: 'तौल (केजी)', payment: 'भुक्तानी',
      women: 'महिला चालक रोज्नुहोस्', schedule: 'पछिको लागि बुक गर्नुहोस्', book: 'बुक गर्नुहोस्',
    },
  };
  let lang = MR.store.get('myride.lang') || 'en';
  const EN = {};
  document.querySelectorAll('[data-i18n]').forEach((el) => { EN[el.dataset.i18n] = el.textContent; });
  function applyLang() {
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = (lang === 'ne' && I18N.ne[el.dataset.i18n]) || EN[el.dataset.i18n]; });
    $('#lang').textContent = lang === 'ne' ? 'English' : 'नेपाली';
    document.documentElement.lang = lang;
  }
  $('#lang').onclick = () => { lang = lang === 'ne' ? 'en' : 'ne'; MR.store.set('myride.lang', lang); applyLang(); renderQuotes(); };

  const S = { token: MR.store.get(MR.tokenKey('rider')), profile: null, cfg: null, places: [], kind: 'ride', pickup: null, drop: null, quotes: [], sel: null, trip: null, route: null };
  const map = MR.map('map');
  const mk = { pickup: null, drop: null, driver: null, line: null };

  // ---------- map interactions ----------
  function setPoint(which, p, label) {
    S[which] = { lat: p.lat, lng: p.lng, label };
    if (mk[which]) mk[which].remove();
    mk[which] = L.marker([p.lat, p.lng], { icon: MR.dot(which === 'pickup' ? '#0b7a6f' : '#f29e1f'), draggable: !S.trip }).addTo(map);
    mk[which].on('dragend', (e) => { const ll = e.target.getLatLng(); setPoint(which, ll, 'Pinned location'); $(`#${which === 'pickup' ? 'from' : 'to'}`).value = 'Pinned location'; refreshQuote(); });
    $('#hint').textContent = !S.pickup ? 'Tap the map to set pickup' : !S.drop ? 'Tap the map to set drop' : 'Drag pins to adjust';
  }
  map.on('click', (e) => {
    if (S.trip || !S.profile) return;
    const which = !S.pickup ? 'pickup' : 'drop';
    setPoint(which, e.latlng, 'Pinned location');
    $(`#${which === 'pickup' ? 'from' : 'to'}`).value = 'Pinned location';
    refreshQuote();
  });
  const placeByName = (name) => S.places.find((p) => p.name.toLowerCase() === String(name).trim().toLowerCase());
  for (const [id, which] of [['from', 'pickup'], ['to', 'drop']]) {
    $(`#${id}`).addEventListener('change', (e) => {
      const p = placeByName(e.target.value) || (which === 'drop' && S.cfg.logistics.destinations.find((d) => d.name.toLowerCase() === e.target.value.trim().toLowerCase()));
      if (p) { setPoint(which, p, p.name); map.panTo([p.lat, p.lng]); refreshQuote(); }
    });
  }
  $('#locate').onclick = () => {
    if (!navigator.geolocation) return toast('Location not available');
    navigator.geolocation.getCurrentPosition((pos) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setPoint('pickup', p, 'My location');
      $('#from').value = 'My location';
      map.setView([p.lat, p.lng], 15);
      refreshQuote();
    }, () => toast('Could not get your location — tap the map instead'));
  };

  function drawRoute(geometry) {
    if (mk.line) mk.line.remove();
    if (!geometry?.length) return;
    mk.line = L.polyline(geometry, { color: '#0b7a6f', weight: 5, opacity: 0.8 }).addTo(map);
    map.fitBounds(mk.line.getBounds(), { padding: [40, 40] });
  }

  // ---------- tabs ----------
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      const k = b.dataset.kind;
      show('#planner', !['history', 'account'].includes(k));
      show('#history', k === 'history');
      show('#account', k === 'account');
      if (k === 'history') return renderHistory();
      if (k === 'account') return renderAccount();
      S.kind = k;
      show('#parcelForm', k !== 'ride');
      show('#parcelOnly', k === 'delivery');
      show('#logiOnly', k === 'logistics');
      show('#sizeWrap', k === 'delivery');
      show('#goodsWrap', k === 'logistics');
      show('#popular', k === 'ride');
      show('#intercity', k === 'logistics');
      show('#womenWrap', k === 'ride');
      $('#pw').value = k === 'logistics' ? 300 : 1;
      S.sel = null;
      refreshQuote();
    };
  });
  ['pw', 'fragile', 'cod', 'helpers', 'dval', 'insure', 'gtype', 'useCredits'].forEach((id) => $(`#${id}`).addEventListener('change', () => refreshQuote()));
  $('#promo').addEventListener('change', () => refreshQuote());
  $('#schedOn').onchange = (e) => show('#schedAt', e.target.checked);

  const parcel = () => (S.kind === 'logistics'
    ? { weightKg: +$('#pw').value || 0, goodsType: $('#gtype').value, description: $('#pdesc').value, helpers: +$('#helpers').value || 0, declaredValue: +$('#dval').value || 0, insure: $('#insure').checked }
    : { weightKg: +$('#pw').value || 0, size: $('#psize').value, description: $('#pdesc').value, fragile: $('#fragile').checked, codAmount: +$('#cod').value || 0 });

  // ---------- quotes ----------
  let qSeq = 0;
  async function refreshQuote() {
    $('#qerr').textContent = '';
    if (!S.pickup || !S.drop) { $('#quotes').innerHTML = ''; show('#options', false); return; }
    const seq = ++qSeq;
    $('#quotes').innerHTML = '<div class="card"><span class="spinner"></span> Measuring the road route…</div>';
    try {
      const r = await api('POST', '/api/quote', { pickup: S.pickup, drop: S.drop, kind: S.kind, parcel: S.kind !== 'ride' ? parcel() : undefined, promoCode: $('#promo').value.trim() || undefined, useCredits: $('#useCredits').checked }, S.token);
      if (seq !== qSeq) return;
      S.quotes = r.quotes;
      S.route = r.route;
      S.recommend = r.recommend;
      if (r.recommend && !S.sel) S.sel = r.recommend;
      $('#fromWard').textContent = r.pickupWard || '';
      $('#toWard').textContent = r.dropWard || (S.kind === 'logistics' ? 'Outside Pokhara — intercity' : '');
      if (r.promoError) $('#qerr').textContent = r.promoError;
      drawRoute(r.route.geometry);
      if (!S.sel || !S.quotes.find((q) => q.service === S.sel && !q.unavailable)) S.sel = (S.quotes.find((q) => !q.unavailable) || {}).service;
      renderQuotes();
    } catch (e) {
      if (seq !== qSeq) return;
      $('#quotes').innerHTML = '';
      show('#options', false);
      $('#qerr').textContent = e.message;
    }
  }

  function renderQuotes() {
    if (!S.quotes.length || !S.route) return;
    const ne = lang === 'ne';
    $('#quotes').innerHTML = `<div class="muted">${S.route.km.toFixed(1)} km by road · ~${Math.round(S.route.min)} min ${S.route.source === 'estimate' ? '(estimated)' : ''}</div>` + S.quotes.map((q) => {
      if (q.unavailable) return `<div class="card quote na"><div><div class="name">${esc(q.label)}</div><div class="meta">${esc(q.unavailable)}</div></div></div>`;
      const svc = S.cfg.services[q.service];
      const cheapest = q.competitors?.length ? q.competitors.reduce((a, c) => (c.estimate < a.estimate ? c : a)) : null;
      const disc = q.discounts.map((d) => `${esc(d.label)} −${rs(d.amount)}`).join(' · ');
      return `<div class="card quote ${S.sel === q.service ? 'sel' : ''}" data-s="${q.service}">
        <div><div class="name">${esc(ne ? svc.labelNe : q.label)} ${svc.fuel === 'ev' ? '<span class="pill ev">EV</span>' : ''} ${q.intercity ? '<span class="pill">intercity</span>' : ''} ${S.recommend === q.service ? '<span class="pill" style="background:var(--accent);color:#1d1405">recommended for hill roads</span>' : ''}</div>
          <div class="meta">${q.available ? `${q.available} nearby` : '<span class="pill warn">few drivers nearby</span>'} · ${q.min} min</div></div>
        <div><div class="price">${q.total === 0 ? '<span class="pos">FREE</span>' : rs(q.total)}</div>${q.split.promoCost ? `<div class="meta" style="text-align:right;text-decoration:line-through">${rs(q.gross)}</div>` : ''}
          ${cheapest && cheapest.estimate > q.total ? `<div class="save">Save ${rs(cheapest.estimate - q.total)} vs ${esc(cheapest.name)}</div>` : ''}</div>
        ${disc ? `<div class="meta pos" style="grid-column:1/-1">${disc}</div>` : ''}
        ${q.legalCap ? `<div class="meta" style="grid-column:1/-1">Legal max ${rs(q.legalCap)} (Gandaki &amp; national rules) · No surge pricing</div>` : ''}
      </div>`;
    }).join('');
    document.querySelectorAll('.quote[data-s]').forEach((el) => { el.onclick = () => { S.sel = el.dataset.s; renderQuotes(); }; });
    show('#options', !!S.sel);
  }

  // ---------- booking ----------
  $('#bookBtn').onclick = async () => {
    $('#berr').textContent = '';
    const body = {
      service: S.sel, pickup: S.pickup, drop: S.drop, payment: $('#pay').value, useCredits: $('#useCredits').checked,
      promoCode: $('#promo').value.trim() || undefined, note: $('#note').value || undefined,
      womenOnly: S.kind === 'ride' && $('#women').checked,
      scheduledAt: $('#schedOn').checked && $('#schedAt').value ? new Date($('#schedAt').value).toISOString() : undefined,
    };
    if (S.kind !== 'ride') { body.parcel = parcel(); body.recipient = { name: $('#rname').value.trim(), phone: $('#rphone').value.trim() }; }
    $('#bookBtn').disabled = true;
    try {
      showTrip(await api('POST', '/api/trips', body, S.token));
      loadProfile();
    } catch (e) { $('#berr').textContent = e.message; }
    $('#bookBtn').disabled = false;
  };

  const STATUS = {
    scheduled: ['Scheduled', 'We will find a driver before pickup time.'],
    searching: ['Finding your driver…', 'Offering your trip to the nearest drivers.'],
    accepted: ['Driver on the way', 'Share the PIN only when you meet the driver.'],
    arrived: ['Driver has arrived', 'Free waiting time has started. Tell the driver your PIN.'],
    in_progress: ['On the way', 'Share your trip with family.'],
    completed: ['Completed', 'Thank you for choosing MyRide.'],
    cancelled: ['Cancelled', ''],
    no_driver: ['No driver available', 'Sorry — try again or choose another vehicle.'],
  };

  function showTrip(t) {
    S.trip = t;
    show('#book', false);
    show('#tripView', true);
    show('#sosBtn', ['accepted', 'arrived', 'in_progress'].includes(t.status));
    drawRoute(t.route.geometry);
    for (const w of ['pickup', 'drop']) setPoint(w, t[w], t[w].label);
    if (t.driver?.loc) {
      if (!mk.driver) mk.driver = L.marker([t.driver.loc.lat, t.driver.loc.lng], { icon: MR.vehicleIcon(t.driver.vehicle.type) }).addTo(map);
      else mk.driver.setLatLng([t.driver.loc.lat, t.driver.loc.lng]);
    } else if (mk.driver) { mk.driver.remove(); mk.driver = null; }

    const [title, help] = STATUS[t.status] || [t.status, ''];
    const d = t.driver;
    const live = ['searching', 'accepted', 'arrived', 'in_progress', 'scheduled'].includes(t.status);
    const shareUrl = `${location.origin}/track.html?t=${t.shareToken}`;
    $('#tripView').innerHTML = `
      <div class="status">${t.status === 'searching' ? '<span class="spinner"></span> ' : ''}${esc(title)}</div>
      <p class="muted">${esc(help)}${t.status === 'cancelled' && t.cancellation?.fee ? (t.cancellation.waivedByPlus ? ' Cancellation fee waived by MyRide Plus.' : ` Cancellation fee ${rs(t.cancellation.fee)} will be added to your next trip.`) : ''}</p>
      <div class="card"><div class="kv"><span>${esc(t.quote.label)}</span><b>${t.fare === 0 ? '<span class="pos">FREE</span>' : rs(t.fare)}</b></div>
        <div class="muted">${esc(t.pickup.label)} → ${esc(t.drop.label)} · ${t.route.km.toFixed(1)} km</div>
        <div class="muted">Payment: ${esc(t.payment.method)} · ${esc(t.payment.status.replace(/_/g, ' '))}</div></div>
      ${d ? `<div class="card"><div class="kv"><b>${esc(d.name)} ${d.fleet ? '<span class="pill">MyRide fleet</span>' : ''}</b><span>★ ${d.rating}</span></div>
        <div class="muted">${esc(d.vehicle.model)} · <b>${esc(d.vehicle.plate)}</b> ${d.vehicle.fuel === 'ev' ? '<span class="pill ev">EV</span>' : ''}</div>
        <div class="row" style="margin-top:8px"><a class="btn ghost small" href="tel:${esc(d.phone)}">📞 Call</a><a class="btn ghost small" href="sms:${esc(d.phone)}">💬 SMS</a></div></div>` : ''}
      ${['accepted', 'arrived'].includes(t.status) ? `<div class="muted">Your trip PIN</div><div class="pin">${esc(t.pin)}</div>` : ''}
      ${t.kind === 'delivery' && live ? `<div class="card"><b>Delivery code for ${esc(t.recipient.name)}</b><div class="pin">${esc(t.deliveryOtp)}</div><div class="muted">Share with the receiver (${esc(t.recipient.phone)}). The driver needs it to complete the delivery${t.parcel.codAmount ? ` and will collect ${rs(t.parcel.codAmount)} COD` : ''}.</div></div>` : ''}
      ${live ? '<button class="btn ghost" id="shareBtn">🔗 Share live trip</button>' : ''}
      ${['scheduled', 'searching', 'accepted', 'arrived'].includes(t.status) ? '<p></p><button class="btn ghost" id="cancelBtn" style="color:var(--danger)">Cancel trip</button>' : ''}
      ${t.status === 'completed' ? receipt(t) : ''}
      ${['completed', 'cancelled', 'no_driver'].includes(t.status) ? '<p></p><button class="btn" id="newBtn">Book another</button>' : ''}`;

    $('#shareBtn')?.addEventListener('click', async () => {
      try { if (navigator.share) await navigator.share({ title: 'My MyRide trip', url: shareUrl }); else { await navigator.clipboard.writeText(shareUrl); toast('Link copied — send it on Viber/WhatsApp'); } } catch { toast(shareUrl, 6000); }
    });
    $('#cancelBtn')?.addEventListener('click', async () => {
      if (!confirm('Cancel this trip?')) return;
      try { showTrip(await api('POST', `/api/trips/${t.id}/cancel`, { reason: 'rider_cancelled' }, S.token)); } catch (e) { toast(e.message); }
    });
    $('#newBtn')?.addEventListener('click', resetBooking);
    $('#payBtn')?.addEventListener('click', () => payTrip(t));
    document.querySelectorAll('.stars button').forEach((b) => {
      b.onclick = async () => {
        try { await api('POST', `/api/trips/${t.id}/rate`, { stars: +b.dataset.v }, S.token); t.riderRating = { stars: +b.dataset.v }; showTrip(t); toast('Thanks for rating!'); } catch (e) { toast(e.message); }
      };
    });
  }

  function receipt(t) {
    const lines = t.quote.lines.map((l) => `<div class="kv"><span>${esc(l.label)}</span><span class="${l.amount < 0 ? 'pos' : ''}">${l.amount < 0 ? '−' : ''}${rs(Math.abs(l.amount))}</span></div>`).join('');
    const rated = t.riderRating?.stars;
    return `<div class="card"><b>Receipt</b>${t.business ? `<div class="muted">${esc(t.business.name)} · PAN ${esc(t.business.pan)}</div>` : ''}${lines}
      ${t.dues ? `<div class="kv"><span>Previous cancellation fee</span><span>${rs(t.dues)}</span></div>` : ''}
      <div class="kv total"><span>Total (incl. 5% VAT)</span><span>${rs(t.fare)}</span></div>
      <div class="muted">Your driver earns ${rs(t.quote.split.driver)} — discounts are paid by MyRide, not the driver.</div></div>
      ${t.payment.method !== 'cash' && t.payment.status !== 'paid' && t.fare > 0 ? `<button class="btn accent" id="payBtn">Pay ${rs(t.fare)} with ${t.payment.method === 'esewa' ? 'eSewa' : 'Khalti'}</button>` : ''}
      <div class="card"><div class="muted">${rated ? 'You rated' : 'Rate your driver'}</div><div class="stars">${[1, 2, 3, 4, 5].map((v) => `<button data-v="${v}" class="${rated >= v ? 'on' : ''}" ${rated ? 'disabled' : ''}>★</button>`).join('')}</div></div>`;
  }

  function submitProvider(r) {
    if (r.provider === 'esewa') {
      const f = document.createElement('form');
      f.method = 'POST'; f.action = r.action;
      for (const [k, v] of Object.entries(r.fields)) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); }
      document.body.appendChild(f); f.submit();
    } else if (r.payment_url) location.href = r.payment_url;
    else toast(r.message || 'Payment provider not configured', 5000);
  }
  async function payTrip(t) {
    try { submitProvider(await api('POST', `/api/trips/${t.id}/pay`, {}, S.token)); } catch (e) { toast(e.message); }
  }

  function resetBooking() {
    S.trip = null;
    show('#tripView', false);
    show('#book', true);
    show('#sosBtn', false);
    if (mk.driver) { mk.driver.remove(); mk.driver = null; }
    refreshQuote();
  }

  $('#sosBtn').onclick = async () => {
    if (!S.trip) return;
    let loc = null;
    try { loc = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), no, { timeout: 3000 })); } catch { /* send without location */ }
    try {
      const r = await api('POST', `/api/trips/${S.trip.id}/sos`, { loc }, S.token);
      $('#tripView').insertAdjacentHTML('afterbegin', `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">MyRide safety team alerted</b>
        <div class="row" style="margin-top:8px"><a class="btn danger small" href="tel:${r.call.police}">Police ${r.call.police}</a><a class="btn danger small" href="tel:${r.call.touristPolice}">Tourist Police ${r.call.touristPolice}</a><a class="btn danger small" href="tel:${r.call.ambulance}">Ambulance ${r.call.ambulance}</a></div></div>`);
    } catch (e) { toast(e.message); }
  };

  async function renderHistory() {
    const list = await api('GET', '/api/trips', null, S.token).catch(() => []);
    $('#history').innerHTML = list.length ? list.map((t) => `<div class="card quote" data-id="${t.id}"><div><div class="name">${esc(t.quote?.label || t.service)}</div><div class="meta">${esc(t.pickup.label)} → ${esc(t.drop.label)}</div><div class="meta">${new Date(t.createdAt).toLocaleString()}</div></div><div><div class="price">${t.fare === 0 ? 'FREE' : rs(t.fare)}</div><div class="meta" style="text-align:right">${esc(t.status.replace('_', ' '))}</div></div></div>`).join('') : '<p class="muted">No trips yet.</p>';
    document.querySelectorAll('#history .quote').forEach((el) => { el.onclick = async () => showTrip(await api('GET', `/api/trips/${el.dataset.id}`, null, S.token)); });
  }

  // ---------- account: membership, credits, referral, business, drive ----------
  async function loadProfile() {
    S.profile = await api('GET', '/api/profile', null, S.token);
    show('#plusBadge', S.profile.membership.active);
    show('#freeBanner', S.profile.firstRideFree);
    $('#creditsLbl').textContent = `Use MyRide credits (${rs(S.profile.credits)})`;
    show('#creditsWrap', S.profile.credits > 0);
    return S.profile;
  }

  async function renderAccount() {
    const p = await loadProfile();
    const m = p.membership;
    const plans = S.cfg.membership.plans;
    const b = S.cfg.membership.benefits;
    const refLink = `${location.origin}/?ref=${p.referral.code}`;
    $('#account').innerHTML = `
      <div class="card" style="border:2px solid ${m.active ? 'var(--accent)' : 'var(--line)'}">
        <div class="kv"><b style="font-size:1.1rem">${m.active ? '⭐ MyRide Plus' : 'Free plan'}</b>${m.active ? `<span class="pill">${m.trial ? 'Trial' : esc(m.label.replace('MyRide Plus · ', ''))}</span>` : ''}</div>
        ${m.active ? `<div class="muted">Active until ${new Date(m.expiresAt).toLocaleDateString()} · ${m.freeCancellationsLeft} free cancellations left · saved ${rs(m.savedTotal)} so far</div>` : '<div class="muted">Upgrade for savings on every trip.</div>'}
        <ul class="muted" style="padding-left:18px;margin:8px 0">
          <li>${Math.round(b.rideDiscountPct * 100)}% off every ride, parcel and logistics job (up to ${rs(b.maxDiscountPerTrip)} per trip)</li>
          <li>${b.freeCancellationsPerMonth} free cancellations each month</li>
          <li>Rs 0 cash-on-delivery handling fee</li>
          <li>Priority matching — wider driver search when it's busy</li>
        </ul>
        ${m.active ? `${m.autoRenew ? '<button class="btn ghost small" id="mCancel">Turn off renewal</button>' : '<span class="muted">Renewal off</span>'}` : `
        <div class="row">
          <button class="btn" data-plan="plus_monthly">${npr(plans.plus_monthly.price)} / month</button>
          <button class="btn accent" data-plan="plus_yearly">${npr(plans.plus_yearly.price)} / year<br><small>2 months free (save 17%)</small></button>
        </div>
        <label for="mPay">Pay with</label><select id="mPay"><option value="esewa">eSewa</option><option value="khalti">Khalti</option><option value="sandbox">Sandbox (dev only)</option></select>
        ${m.trialAvailable ? `<p></p><button class="btn ghost" id="mTrial">Try Plus free for ${S.cfg.membership.trialDays} days</button>` : ''}`}
      </div>

      <div class="card"><div class="kv"><b>MyRide credits</b><b>${rs(p.credits)}</b></div>
        <div class="muted">Credits apply automatically at booking.${p.dues ? ` You owe ${rs(p.dues)} (cancellation) — added to your next trip.` : ''}</div></div>

      <div class="card"><b>Invite friends, ride free</b>
        <div class="muted">Friends get their first trip free (up to Rs 100). You get Rs 50 credit when they finish it.</div>
        <div class="pin" style="font-size:1.4rem;letter-spacing:.15em">${esc(p.referral.code)}</div>
        <button class="btn ghost small" id="refShare">Share invite link</button> <span class="muted">Earned ${rs(p.referral.earned)}</span>
        ${!p.referral.referredBy && !p.completedTrips ? `<label for="refIn">Have a friend's code?</label><div class="row"><input id="refIn" maxlength="8" placeholder="MRXXXXXX"><button class="btn small shrink" id="refApply">Apply</button></div>` : ''}
      </div>

      <div class="card"><b>Business account</b><div class="muted">Add your PAN/VAT number to get it on receipts and invoices for logistics and staff rides.</div>
        <div class="row"><input id="bizName" placeholder="Company name" value="${esc(p.business?.name || '')}"><input id="bizPan" placeholder="PAN (9 digits)" maxlength="9" value="${esc(p.business?.pan || '')}"></div>
        <p></p><button class="btn ghost small" id="bizSave">Save</button></div>

      <div class="card" style="background:var(--bg)"><b>🛵 Drive or deliver with MyRide</b>
        <div class="muted">Partners keep at least 90% of every fare (max Rs 10 fee on motorcycle trips) and get paid weekly to their bank. Or join our salaried fleet. Same mobile number — separate Drive portal.</div>
        <p></p><a class="btn" href="/driver.html">Open MyRide Drive</a>
        ${p.driverApplication ? `<div class="muted" style="margin-top:6px">Your application: <b>${esc(p.driverApplication.status)}</b></div>` : ''}</div>

      <div class="card"><div class="kv"><span>Name</span><input id="pName" value="${esc(p.name)}" style="max-width:60%"></div>
        <div class="kv"><span>Mobile</span><span>${esc(p.phone)}</span></div><button class="btn ghost small" id="pSave">Update name</button></div>`;

    document.querySelectorAll('[data-plan]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const r = await api('POST', '/api/membership/checkout', { plan: btn.dataset.plan, payment: $('#mPay').value }, S.token);
          if (r.provider === 'sandbox') { toast('MyRide Plus is active (sandbox)'); renderAccount(); } else submitProvider(r);
        } catch (e) { toast(e.message); }
      };
    });
    $('#mTrial')?.addEventListener('click', async () => { try { await api('POST', '/api/membership/trial', { plan: 'plus_monthly' }, S.token); toast('Your 7-day Plus trial has started'); renderAccount(); } catch (e) { toast(e.message); } });
    $('#mCancel')?.addEventListener('click', async () => { await api('POST', '/api/membership/cancel', {}, S.token).catch((e) => toast(e.message)); renderAccount(); });
    $('#refShare').onclick = async () => { try { if (navigator.share) await navigator.share({ title: 'Ride free on MyRide', text: `Use my code ${p.referral.code} for a free first ride in Pokhara`, url: refLink }); else { await navigator.clipboard.writeText(refLink); toast('Invite link copied'); } } catch { toast(refLink, 6000); } };
    $('#refApply')?.addEventListener('click', async () => { try { await api('POST', '/api/profile/referral', { code: $('#refIn').value }, S.token); toast('Referral applied'); renderAccount(); } catch (e) { toast(e.message); } });
    $('#bizSave').onclick = async () => { try { await api('PATCH', '/api/profile', { business: $('#bizPan').value ? { name: $('#bizName').value, pan: $('#bizPan').value } : null }, S.token); toast('Saved'); } catch (e) { toast(e.message); } };
    $('#pSave').onclick = async () => { try { await api('PATCH', '/api/profile', { name: $('#pName').value }, S.token); toast('Saved'); } catch (e) { toast(e.message); } };
  }

  // ---------- boot ----------
  async function start() {
    show('#login', false);
    show('#book', true);
    show('#logout', true);
    await loadProfile();
    MR.events(`token=${S.token}`, (msg) => { if (msg.type === 'trip' && S.trip && msg.trip.id === S.trip.id) showTrip(msg.trip); });
    const active = (await api('GET', '/api/trips', null, S.token)).find((t) => ['scheduled', 'searching', 'accepted', 'arrived', 'in_progress'].includes(t.status));
    if (active) showTrip(active);
    const q = new URLSearchParams(location.search).get('payment');
    if (q) { toast({ paid: 'Payment successful — thank you!', membership_active: 'Welcome to MyRide Plus!' }[q] || `Payment ${q}`); history.replaceState(null, '', '/'); }
  }
  $('#logout').onclick = () => { MR.store.del(MR.tokenKey('rider')); location.reload(); };

  (async () => {
    applyLang();
    let boundary;
    [S.cfg, S.places, boundary] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/places'), api('GET', '/api/boundary').catch(() => null)]);
    MR.drawBoundary(map, boundary);
    $('#placeList').innerHTML = [...S.places.map((p) => p.name), ...S.cfg.logistics.destinations.map((d) => d.name)].map((n) => `<option value="${esc(n)}">`).join('');
    $('#gtype').innerHTML = S.cfg.logistics.goodsTypes.map((g) => `<option value="${g}">${g[0].toUpperCase() + g.slice(1)}</option>`).join('');
    $('#fixedChips').innerHTML = S.cfg.fixedRoutes.map((r, i) => `<button class="chip" data-i="${i}">${esc(r.from)} → ${esc(r.to.replace('Pokhara International ', ''))} · 🛵 ${rs(r.bike)} · 🚗 ${rs(r.car)}</button>`).join('');
    document.querySelectorAll('#fixedChips .chip').forEach((c) => {
      c.onclick = () => {
        const r = S.cfg.fixedRoutes[+c.dataset.i];
        const a = placeByName(r.from), b = placeByName(r.to);
        setPoint('pickup', a, a.name); setPoint('drop', b, b.name);
        $('#from').value = a.name; $('#to').value = b.name;
        refreshQuote();
      };
    });
    $('#laneChips').innerHTML = S.cfg.logistics.destinations.map((d, i) => `<button class="chip" data-i="${i}">→ ${esc(d.name)}</button>`).join('');
    document.querySelectorAll('#laneChips .chip').forEach((c) => {
      c.onclick = () => {
        const d = S.cfg.logistics.destinations[+c.dataset.i];
        if (!S.pickup) { const a = placeByName('Prithvi Chowk'); setPoint('pickup', a, a.name); $('#from').value = a.name; }
        setPoint('drop', d, d.name); $('#to').value = d.name;
        refreshQuote();
      };
    });
    if (S.token) {
      try { const me = await api('GET', '/api/me', null, S.token); if (me.portal === 'rider') return start(); } catch { /* expired */ }
      MR.store.del(MR.tokenKey('rider')); S.token = null;
    }
    MR.loginFlow($('#login'), { portal: 'rider', referral: true, title: 'Welcome to MyRide', onDone: (r) => { S.token = r.token; start(); } });
  })();
})();
