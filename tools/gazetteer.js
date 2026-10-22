// Builds MyRide's Pokhara gazetteer from OpenStreetMap (Overpass API): every named place people book to —
// toles, chowks, hotels, schools, shops, hospitals, offices… — plus named streets for reverse geocoding.
// Output: data/pokhara-places.json and data/pokhara-streets.json (© OpenStreetMap contributors, ODbL).
// Usage: node tools/gazetteer.js [--cache <dir>]   (re-run to refresh; Overpass downloads are cached in <dir>)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { CITY } = require('../src/config');
const { wardOf, cityOf, haversineKm } = require('../src/geo');
const { transliterate, hasDevanagari, titleCase, keys } = require('../src/nepali');
const curated = require('../data/places.json');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'MyRide/1.0 (Pokhara gazetteer build)';
const { lat: CLAT, lng: CLNG } = CITY.centre;
const AROUND = `(around:${CITY.maxRadiusKm * 1000},${CLAT},${CLNG})`;
const cacheDir = process.argv.includes('--cache') ? process.argv[process.argv.indexOf('--cache') + 1] : path.join(os.tmpdir(), 'myride-osm');

const QUERIES = {
  pois: `[out:json][timeout:180];(nwr["name"]["highway"!~"."]["boundary"!~"."]["admin_level"!~"."]${AROUND};);out center tags;`,
  streets: `[out:json][timeout:180];way["highway"]["name"]${AROUND};out geom tags;`,
};

async function overpass(name) {
  const file = path.join(cacheDir, `${name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).elements;
  console.log(`Downloading ${name} from Overpass…`);
  const res = await fetch(OVERPASS, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(QUERIES[name])}` });
  if (!res.ok) throw new Error(`Overpass ${name}: HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, text);
  return JSON.parse(text).elements;
}

// OSM tags → [app category, what to call it, importance 1–10]. null = not something people book a ride to.
const AMENITY = {
  hospital: ['health', 'Hospital', 9], clinic: ['health', 'Clinic', 6], health_post: ['health', 'Health post', 5], doctors: ['health', 'Clinic', 5],
  dentist: ['health', 'Dentist', 3], pharmacy: ['health', 'Pharmacy', 3], veterinary: ['health', 'Vet', 3],
  university: ['education', 'University', 8], college: ['education', 'College', 7], school: ['education', 'School', 5], kindergarten: ['education', 'School', 2],
  driving_school: ['education', 'Driving school', 2], library: ['education', 'Library', 4],
  bus_station: ['transport', 'Bus park', 9], taxi: ['transport', 'Taxi stand', 5], ferry_terminal: ['transport', 'Boat station', 6],
  restaurant: ['food', 'Restaurant', 4], cafe: ['food', 'Café', 4], fast_food: ['food', 'Fast food', 3], bar: ['food', 'Bar', 3], pub: ['food', 'Pub', 3],
  ice_cream: ['food', 'Ice cream', 2], food_court: ['food', 'Food court', 4],
  bank: ['bank', 'Bank', 4], atm: ['bank', 'ATM', 2], bureau_de_change: ['bank', 'Money exchange', 2], money_transfer: ['bank', 'Remittance', 2],
  place_of_worship: ['worship', 'Temple', 5], monastery: ['worship', 'Monastery', 6],
  townhall: ['government', 'Municipal office', 7], police: ['government', 'Police', 6], post_office: ['government', 'Post office', 5],
  courthouse: ['government', 'Court', 6], fire_station: ['government', 'Fire station', 5], community_centre: ['government', 'Community centre', 3],
  social_facility: ['government', 'Social service', 2], marketplace: ['shopping', 'Market', 6], fuel: ['fuel', 'Petrol pump', 5],
  cinema: ['leisure', 'Cinema', 6], theatre: ['leisure', 'Theatre', 5], events_venue: ['leisure', 'Party venue', 5], studio: ['office', 'Studio', 2],
  car_wash: ['shop', 'Car wash', 2], parking: ['transport', 'Parking', 3],
};
const TOURISM = {
  hotel: ['hotel', 'Hotel', 5], guest_house: ['hotel', 'Guest house', 4], hostel: ['hotel', 'Hostel', 4], resort: ['hotel', 'Resort', 6], motel: ['hotel', 'Hotel', 4],
  apartment: ['hotel', 'Apartment', 3], attraction: ['tourist', 'Attraction', 8], viewpoint: ['tourist', 'Viewpoint', 7], museum: ['tourist', 'Museum', 8],
  camp_site: ['hotel', 'Camping', 4], picnic_site: ['tourist', 'Picnic spot', 5], gallery: ['tourist', 'Gallery', 4], information: null, artwork: null,
};
const PLACE = {
  town: ['area', 'Town', 9], suburb: ['area', 'Area', 9], neighbourhood: ['area', 'Tole', 8], quarter: ['area', 'Area', 8], locality: ['area', 'Locality', 8],
  village: ['area', 'Village', 8], hamlet: ['area', 'Village', 6], square: ['area', 'Chowk', 8], isolated_dwelling: ['area', 'Place', 3],
};

function classify(t) {
  if (t.place) return PLACE[t.place] ?? null;
  if (t.junction || t['junction:name']) return ['area', 'Chowk', 8];
  if (t.aeroway === 'aerodrome' || t.aeroway === 'terminal') return ['transport', 'Airport', 10];
  if (t.public_transport === 'station') return ['transport', 'Bus park', 8];
  if (t.amenity) return AMENITY[t.amenity] ?? null;
  if (t.healthcare) return ['health', 'Clinic', 5];
  if (t.tourism) return TOURISM[t.tourism] ?? ['tourist', 'Attraction', 4];
  if (t.shop) return ['mall', 'department_store'].includes(t.shop) ? ['shopping', 'Shopping mall', 7] : t.shop === 'supermarket' ? ['shopping', 'Supermarket', 5] : ['shop', 'Shop', 2];
  if (t.leisure) return ['park', 'stadium', 'sports_centre', 'water_park', 'garden', 'resort'].includes(t.leisure) ? ['leisure', t.leisure === 'stadium' ? 'Stadium' : t.leisure === 'park' ? 'Park' : 'Sports', t.leisure === 'stadium' ? 7 : 5] : null;
  if (t.office) return t.office === 'government' ? ['government', 'Government office', 6] : ['office', 'Office', 2];
  if (t.historic) return ['tourist', 'Heritage', 6];
  if (t.natural === 'water' || t.water === 'lake') return ['tourist', 'Lake', 9];
  if (t.natural === 'peak' || t.natural === 'cave_entrance') return ['tourist', t.natural === 'peak' ? 'Hill' : 'Cave', 5];
  if (t.craft) return ['shop', 'Workshop', 1];
  if (t.building && !['yes', 'house', 'residential', 'hut', 'roof', 'shed'].includes(t.building)) return ['building', 'Building', 3];
  if (t.building) return ['building', 'Building', 2];
  return null;
}
// Temples / churches / mosques get the right word.
const WORSHIP = { buddhist: 'Monastery', christian: 'Church', muslim: 'Mosque', hindu: 'Temple' };

const latin = (s) => s && !hasDevanagari(s);
function names(t) {
  const ne = [t['name:ne'], t.name].find(hasDevanagari) || null;
  const display = t['name:en'] || [t.name, t.int_name, t['name:latin']].find(latin) || (ne ? titleCase(transliterate(ne)) : t.name);
  const extra = [t.name, t['name:en'], t['name:ne'], t.alt_name, t.old_name, t.short_name, t.int_name, t.official_name].filter(Boolean);
  const tidy = display.trim();
  return { display: tidy === tidy.toLowerCase() ? titleCase(tidy) : tidy, ne, search: [...new Set(extra)].join(' ') }; // "chipledhunga" → "Chipledhunga"
}

const round = (x) => Math.round(x * 1e5) / 1e5;
const pointOf = (e) => (e.type === 'node' ? { lat: e.lat, lng: e.lon } : e.center ? { lat: e.center.lat, lng: e.center.lon } : null);

async function main() {
  const [poiEls, streetEls] = [await overpass('pois'), await overpass('streets')];

  // ---------- places ----------
  const raw = [];
  for (const e of poiEls) {
    const t = e.tags || {};
    const p = pointOf(e);
    if (!p || !t.name || haversineKm(CITY.centre, p) > CITY.maxRadiusKm) continue;
    let c = classify(t);
    if (!c) continue;
    if (t.amenity === 'place_of_worship') c = ['worship', WORSHIP[t.religion] ?? 'Temple', 5];
    const n = names(t);
    raw.push({ id: `${e.type[0]}${e.id}`, ...n, cat: c[0], kind: c[1], w: c[2], ...p, street: t['addr:street'] || null });
  }
  // Curated landmarks (checked by hand) win over OSM duplicates.
  const CURATED_CAT = { residential: ['area', 'Area'], commercial: ['area', 'Market area'], hospital: ['health', 'Hospital'], education: ['education', 'College'], transport: ['transport', null], tourist: ['tourist', null] };
  for (const c of curated) {
    const [cat, kind] = CURATED_CAT[c.category] ?? ['tourist', null];
    raw.push({ id: c.id, display: c.name, ne: null, search: c.name, cat, kind, w: 10, lat: c.lat, lng: c.lng, street: null });
  }

  // Drop near-duplicates (same name within 120 m): keep the more important one.
  raw.sort((a, b) => b.w - a.w);
  const kept = [];
  const seen = new Map();
  for (const r of raw) {
    const k = keys(r.display).join(' ');
    const dupes = seen.get(k) || [];
    if (dupes.some((d) => haversineKm(d, r) < 0.12)) continue;
    dupes.push(r); seen.set(k, dupes); kept.push(r);
  }

  // Area context: the nearest tole / locality / village (not the place itself) and the ward.
  const areas = kept.filter((r) => r.cat === 'area' && r.kind !== 'Place');
  const out = kept.map((r) => {
    let near = null, best = 1.5;
    for (const a of areas) { if (a === r) continue; const d = haversineKm(a, r); if (d < best) { best = d; near = a; } }
    const w = wardOf(r);
    return [r.id, r.display, r.ne && r.ne !== r.display ? r.ne : null, r.search !== r.display ? r.search : null, r.cat, r.kind, round(r.lat), round(r.lng), w ? w.ward : cityOf(r) ? null : 0, near ? near.display : null, r.street, r.w];
  });

  // ---------- streets: named ways merged by name, sampled every ~60 m ----------
  const byName = new Map();
  for (const e of streetEls) {
    if (!e.geometry || !e.tags?.name) continue;
    const n = names(e.tags);
    const s = byName.get(n.display) || { name: n.display, ne: n.ne, pts: [] };
    let last = null;
    for (const g of e.geometry) {
      const p = { lat: g.lat, lng: g.lon };
      if (!last || haversineKm(last, p) >= 0.06) { s.pts.push([round(p.lat), round(p.lng)]); last = p; }
    }
    byName.set(n.display, s);
  }
  const streets = [...byName.values()].map((s) => [s.name, s.ne && s.ne !== s.name ? s.ne : null, s.pts.flat()]);

  const meta = { source: 'OpenStreetMap via Overpass API', attribution: '© OpenStreetMap contributors (ODbL)', generated: new Date().toISOString().slice(0, 10) };
  const fields = ['id', 'name', 'ne', 'alt', 'cat', 'kind', 'lat', 'lng', 'ward (0 = outside Pokhara)', 'area', 'street', 'importance'];
  fs.writeFileSync(path.join(__dirname, '../data/pokhara-places.json'), JSON.stringify({ ...meta, fields, places: out }));
  fs.writeFileSync(path.join(__dirname, '../data/pokhara-streets.json'), JSON.stringify({ ...meta, fields: ['name', 'ne', 'points (lat,lng,lat,lng…)'], streets }));
  const count = {};
  out.forEach((p) => { count[p[4]] = (count[p[4]] || 0) + 1; });
  console.log(`${out.length} places (${raw.length - kept.length} duplicates dropped), ${streets.length} streets`, count);
}

main().catch((e) => { console.error(e); process.exit(1); });
