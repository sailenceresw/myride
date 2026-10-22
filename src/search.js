// Place search and reverse geocoding over the Pokhara gazetteer (tools/gazetteer.js, OpenStreetMap data).
// Search matches Nepali and English, any romanisation (see nepali.js), typos and half-typed words, and ranks
// by match quality, how important the place is and how near it is to the user.
const { haversineKm } = require('./geo');
const { keys } = require('./nepali');

function load(file) {
  try { return require(file); } catch { return null; } // gazetteer not built yet: search still works on curated places
}
const placesData = load('../data/pokhara-places.json');
const streetsData = load('../data/pokhara-streets.json');

const CAT_LABEL = { area: 'Area', transport: 'Transport', tourist: 'Attraction', health: 'Health', education: 'Education', food: 'Food', bank: 'Bank', worship: 'Temple', government: 'Office', shopping: 'Shopping', leisure: 'Leisure', hotel: 'Hotel', fuel: 'Petrol pump', building: 'Building', shop: 'Shop', office: 'Office' };

const entries = (placesData?.places ?? []).map(([id, name, ne, alt, cat, kind, lat, lng, ward, area, street, w]) => {
  const k = [...new Set([...keys(name), ...keys(ne), ...keys(alt)])];
  return { id, name, ne, cat, kind: kind || CAT_LABEL[cat] || null, lat, lng, ward, area, street, w, keys: k, joined: keys(name).join('') };
});

// Word index: every distinct word key → the places using it, plus the sorted word list for prefix lookups.
const byWord = new Map();
for (const e of entries) for (const k of e.keys) { if (!byWord.has(k)) byWord.set(k, []); byWord.get(k).push(e); }
const words = [...byWord.keys()].sort();
const byJoinedPrefix = new Map(); // first 3 letters of the space-less name → places (for "newroad" = "New Road")
for (const e of entries) { const p = e.joined.slice(0, 3); if (p.length === 3) { if (!byJoinedPrefix.has(p)) byJoinedPrefix.set(p, []); byJoinedPrefix.get(p).push(e); } }

/** Places with a word matching `q` (exactly, as a prefix, or with a typo). */
function candidates(q, last) {
  const out = new Set();
  const add = (w) => byWord.get(w).forEach((e) => out.add(e));
  if (q.length >= 2 || last) { // binary search to the first word ≥ q, then walk the prefix range
    let lo = 0, hi = words.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (words[mid] < q) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < words.length && words[i].startsWith(q); i++) add(words[i]);
  } else if (byWord.has(q)) add(q);
  if (q.length >= 4) for (const w of words) if (!w.startsWith(q) && Math.abs(w.length - q.length) <= 2 && (w.includes(q) || within(q, w, q.length >= 7 ? 2 : 1))) add(w);
  return out;
}

// Streets as sampled points, bucketed on a ~1 km grid for fast nearest-street lookups.
const GRID = 0.01;
const cell = (lat, lng) => `${Math.floor(lat / GRID)},${Math.floor(lng / GRID)}`;
const streetGrid = new Map();
for (const [name, ne, flat] of streetsData?.streets ?? []) {
  for (let i = 0; i < flat.length; i += 2) {
    const c = cell(flat[i], flat[i + 1]);
    if (!streetGrid.has(c)) streetGrid.set(c, []);
    streetGrid.get(c).push({ name, ne, lat: flat[i], lng: flat[i + 1] });
  }
}
const placeGrid = new Map();
for (const e of entries) {
  const c = cell(e.lat, e.lng);
  if (!placeGrid.has(c)) placeGrid.set(c, []);
  placeGrid.get(c).push(e);
}
const around = (grid, p) => {
  const [r, c] = cell(p.lat, p.lng).split(',').map(Number);
  const out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(grid.get(`${r + i},${c + j}`) ?? []));
  return out;
};

/** Edit distance with an early exit once it exceeds `max`. */
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** How well one query word matches a place's words: 3 exact, 2 prefix, 1 typo / inside a word, 0 no match. */
function wordScore(q, words, last) {
  let best = 0;
  for (const w of words) {
    if (w === q) return 3;
    if (w.startsWith(q) && (q.length >= 2 || last)) best = Math.max(best, last ? 2.5 : 2);
    else if (q.length >= 4 && within(q, w.slice(0, Math.max(q.length, w.length)), q.length >= 7 ? 2 : 1)) best = Math.max(best, 1.2);
    else if (q.length >= 4 && w.includes(q)) best = Math.max(best, 1);
  }
  return best;
}

const subtitle = (e) => {
  const parts = [e.kind, e.street, e.area, e.ward ? `Ward ${e.ward}` : e.ward === 0 ? 'Outside Pokhara' : null];
  const seen = new Set([keys(e.name).join(' ')]);
  return parts.filter((p) => { if (!p) return false; const k = keys(p).join(' '); if (seen.has(k)) return false; seen.add(k); return true; }).join(' · ');
};
const view = (e, near) => ({
  id: e.id, name: e.name, ne: e.ne, category: e.cat, kind: e.kind, lat: e.lat, lng: e.lng, ward: e.ward || null,
  subtitle: subtitle(e), outside: e.ward === 0, km: near ? Math.round(haversineKm(near, e) * 10) / 10 : undefined,
});

/**
 * Places matching `q`: every query word must match a word of the name (the last one may be half-typed).
 * `near` (the user / pickup) breaks ties towards closer places.
 */
function search(q, { near = null, limit = 20 } = {}) {
  const qk = keys(q);
  if (!qk.length) return [];
  const joinedQ = qk.join('');
  // Only score places that match the rarest-looking (longest) word, or start with the space-less query.
  const anchor = qk.reduce((a, b) => (b.length > a.length ? b : a));
  const pool = candidates(anchor, anchor === qk[qk.length - 1]);
  if (joinedQ.length >= 5) for (const e of byJoinedPrefix.get(joinedQ.slice(0, 3)) ?? []) if (e.joined.startsWith(joinedQ)) pool.add(e);
  const scored = [];
  for (const e of pool) {
    let s = 0;
    let ok = true;
    for (let i = 0; i < qk.length; i++) {
      const m = wordScore(qk[i], e.keys, i === qk.length - 1);
      if (!m) { ok = false; break; }
      s += m;
    }
    // "newroad" typed for "New Road", "lakeside" for "Lake Side": compare with spaces removed.
    if (!ok) { if (joinedQ.length >= 5 && e.joined.startsWith(joinedQ)) s = 2 * qk.length; else continue; }
    if (e.keys[0] === qk[0] || e.keys[0]?.startsWith(qk[0])) s += 1.5; // name starts with what was typed
    if (qk.length === e.keys.length && s >= 3 * qk.length) s += 3; // the whole name, exactly
    s += e.w * 0.45; // a Hospital or Chowk beats a small shop of the same name
    if (near) s -= Math.min(4, haversineKm(near, e) / 2.5);
    scored.push([s, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([, e]) => view(e, near));
}

/**
 * Human address for a point: the place you're at (≤ 40 m), else the street, else "Near …", plus area and ward.
 * e.g. { label: 'Hallan Chowk', subtitle: 'Baidam Road · Ward 6' }.
 */
function reverse(p, wardOf) {
  let place = null, pd = Infinity, street = null, sd = Infinity, area = null, ad = Infinity;
  for (const e of around(placeGrid, p)) {
    const d = haversineKm(p, e);
    if (e.cat === 'area' && d < ad && d < 1.5) { ad = d; area = e; }
    if (d < 0.15 && e.w >= 2 && d - e.w * 0.004 < pd) { pd = d - e.w * 0.004; place = e; }
  }
  for (const s of around(streetGrid, p)) {
    const d = haversineKm(p, s);
    if (d < sd) { sd = d; street = s; }
  }
  const w = wardOf(p);
  const streetName = street && sd < 0.06 ? street.name : null;
  const exact = place && haversineKm(p, place) < 0.04;
  const label = exact ? place.name : streetName ?? (place ? `Near ${place.name}` : area ? `Near ${area.name}` : w ? `Ward ${w.ward}, ${w.name}` : 'Dropped pin');
  const parts = [exact && streetName ? streetName : null, area && !label.includes(area.name) ? area.name : null, w ? `Ward ${w.ward}` : 'Outside Pokhara'];
  return { label, subtitle: parts.filter(Boolean).join(' · '), lat: p.lat, lng: p.lng, ward: w ? w.ward : null };
}

module.exports = { search, reverse, size: () => entries.length };
