// Shared helpers for MyRide web apps.
const MR = (() => {
  const POKHARA = [28.2096, 83.9856];
  const tokenKey = (role) => `myride.token.${role}`;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };

  async function api(method, path, body, token) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  function map(el, opts = {}) {
    const m = L.map(el, { zoomControl: false, ...opts }).setView(POKHARA, 13);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    return m;
  }

  const dot = (color) => L.divIcon({ className: '', html: `<div class="marker-dot" style="background:${color}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
  const vehicleIcon = (type) => L.divIcon({ className: '', html: `<div class="veh">${type === 'car' ? '🚗' : type === 'jeep' ? '🚙' : type === 'van' ? '🚐' : ['cargo', 'pickup', 'truck_light', 'truck'].includes(type) ? '🚚' : '🛵'}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });

  function toast(msg, ms = 3000) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function events(query, onMsg) {
    let es;
    const open = () => {
      es = new EventSource(`/api/events?${query}`);
      es.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch { /* ignore */ } };
      es.onerror = () => { es.close(); setTimeout(open, 3000); };
    };
    open();
    return () => es && es.close();
  }

  const rs = (n) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);

  // Phone + OTP login. Each portal (rider app, MyRide Drive, Ops) keeps its own session token.
  function loginFlow(root, { portal = 'rider', onDone, title = '', referral = false }) {
    const ref = new URLSearchParams(location.search).get('ref') || '';
    root.innerHTML = `
      ${title ? `<h3 style="margin:4px 0 10px">${title}</h3>` : ''}
      <label for="ph">Mobile number</label>
      <div class="row"><span class="shrink muted">+977</span><input id="ph" inputmode="numeric" maxlength="10" placeholder="98XXXXXXXX" autocomplete="tel"></div>
      <div id="otpBox" class="hidden">
        <label for="otp">6-digit code sent by SMS</label><input id="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
        <label for="nm">Your name</label><input id="nm" placeholder="e.g. Aarati Gurung" autocomplete="name">
        ${referral ? `<label for="refc">Referral code (optional)</label><input id="refc" maxlength="8" placeholder="MRXXXXXX" value="${esc(ref)}">` : ''}
        <p class="muted" id="devOtp"></p>
      </div>
      <p class="err" id="lerr"></p>
      <button class="btn" id="lgo">Send code</button>`;
    let sent = false;
    $('#lgo', root).onclick = async () => {
      $('#lerr', root).textContent = '';
      const phone = $('#ph', root).value.trim();
      try {
        if (!sent) {
          const r = await api('POST', '/api/auth/otp', { phone });
          sent = true;
          $('#otpBox', root).classList.remove('hidden');
          $('#lgo', root).textContent = 'Verify & continue';
          if (r.devOtp) $('#devOtp', root).textContent = `Dev mode — your code is ${r.devOtp}`;
        } else {
          const r = await api('POST', '/api/auth/verify', { phone, otp: $('#otp', root).value.trim(), name: $('#nm', root).value, portal, referralCode: $('#refc', root)?.value.trim() || undefined });
          store.set(tokenKey(portal), r.token);
          onDone(r);
        }
      } catch (e) { $('#lerr', root).textContent = e.message; }
    };
  }

  // Private files (KYC docs, selfies) need the auth header, so load them as blobs.
  async function authedImage(fileId, token) {
    const res = await fetch(`/api/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Could not load file');
    return URL.createObjectURL(await res.blob());
  }

  // Resize/compress a camera photo before upload (documents ≤ 1600 px, JPEG ~0.8).
  function fileToDataUrl(file, max = 1600) {
    return new Promise((resolve, reject) => {
      if (file.type === 'application/pdf') { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(file); return; }
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => reject(new Error('Not an image'));
      img.src = URL.createObjectURL(file);
    });
  }

  function drawBoundary(m, geo) {
    if (!geo) return null;
    return L.geoJSON(geo, { style: { color: '#0b7a6f', weight: 2, fillOpacity: 0.03, dashArray: '6 4' }, interactive: false }).addTo(m);
  }

  return { api, map, dot, vehicleIcon, toast, events, rs, esc, $, store, tokenKey, loginFlow, authedImage, fileToDataUrl, drawBoundary, POKHARA };
})();
