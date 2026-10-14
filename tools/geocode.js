// One-off research script: geocodes real Pokhara landmarks with OpenStreetMap Nominatim,
// then measures the real road distance/time between them with OSRM.
// Output: data/places.json and data/route-matrix.json
// Usage: node tools/geocode.js   (respects Nominatim's 1 request/second policy)
const fs = require('fs');
const path = require('path');

const { wardOf } = require('../src/geo'); // ward polygons from data/wards.json (run tools/wards.js first)
const UA ='MyRideResearch/0.1 (pokhara ride-hailing feasibility study)';
// Pokhara metropolitan bounding box (approx): lon 83.85–84.20, lat 28.05–28.35
const VIEWBOX = '83.85,28.35,84.20,28.05';

const PLACES = [
  ['lakeside', 'Lakeside', 'Lakeside, Pokhara', 'tourist'],
  ['hallan-chowk', 'Hallan Chowk', 'Hallan Chowk, Pokhara', 'tourist'],
  ['barahi-ghat', 'Tal Barahi Ghat', 'Tal Barahi Temple, Pokhara', 'tourist'],
  ['damside', 'Damside', 'Damside, Pokhara', 'tourist'],
  ['tourist-bus-park', 'Tourist Bus Park', 'Tourist Bus Park, Pokhara', 'transport'],
  ['prithvi-chowk', 'Prithvi Chowk', 'Prithvi Chowk, Pokhara', 'transport'],
  ['pokhara-intl-airport', 'Pokhara International Airport', 'Pokhara International Airport', 'transport'],
  ['old-airport', 'Old Domestic Airport', 'Pokhara Airport, Airport Road, Pokhara', 'transport'],
  ['chipledhunga', 'Chipledhunga', 'Chipledhunga, Pokhara', 'commercial'],
  ['mahendrapul', 'Mahendrapul', 'Mahendrapul, Pokhara', 'commercial'],
  ['new-road', 'New Road', 'New Road, Pokhara', 'commercial'],
  ['srijana-chowk', 'Srijana Chowk', 'Srijana Chowk, Pokhara', 'commercial'],
  ['zero-km', 'Zero Kilometer', 'Zero Kilometer, Pokhara', 'commercial'],
  ['bagar', 'Bagar', 'Bagar, Pokhara', 'residential'],
  ['bindhyabasini', 'Bindhyabasini Temple', 'Bindhyabasini Temple, Pokhara', 'tourist'],
  ['gandaki-hospital', 'Gandaki Hospital (Western Regional)', 'Western Regional Hospital, Pokhara', 'hospital'],
  ['manipal-hospital', 'Manipal Teaching Hospital', 'Manipal Teaching Hospital, Pokhara', 'hospital'],
  ['pn-campus', 'Prithvi Narayan Campus', 'Prithvi Narayan Campus, Pokhara', 'education'],
  ['pokhara-university', 'Pokhara University', 'Pokhara University, Lekhnath', 'education'],
  ['sarangkot', 'Sarangkot Viewpoint', 'Sarangkot, Pokhara', 'tourist'],
  ['peace-pagoda', 'World Peace Pagoda', 'World Peace Pagoda, Pokhara', 'tourist'],
  ['davis-falls', 'Davis Falls', "Devi's Fall, Pokhara", 'tourist'],
  ['gupteshwor', 'Gupteshwor Mahadev Cave', 'Gupteshwor Mahadev Cave, Pokhara', 'tourist'],
  ['mountain-museum', 'International Mountain Museum', 'International Mountain Museum, Pokhara', 'tourist'],
  ['mahendra-cave', 'Mahendra Cave', 'Mahendra Cave, Pokhara', 'tourist'],
  ['bat-cave', 'Bat Cave (Chamero Gufa)', 'Bat Cave, Pokhara', 'tourist'],
  ['begnas-lake', 'Begnas Lake', 'Begnas Lake', 'tourist'],
  ['rupa-lake', 'Rupa Lake', 'Rupa Lake', 'tourist'],
  ['talchowk', 'Talchowk (Lekhnath)', 'Talchowk, Lekhnath', 'residential'],
  ['hemja', 'Hemja', 'Hemja, Pokhara', 'residential'],
  ['pumdikot', 'Pumdikot Shiva Statue', 'Pumdikot, Pokhara', 'tourist'],
  ['batulechaur', 'Batulechaur', 'Batulechaur, Pokhara', 'residential'],
  ['lamachaur', 'Lamachaur', 'Lamachaur, Pokhara', 'residential'],
  ['chhorepatan', 'Chhorepatan', 'Chhorepatan, Pokhara', 'residential'],
  ['birauta', 'Birauta', 'Birauta, Pokhara', 'residential'],
  ['nadipur', 'Nadipur', 'Nadipur, Pokhara', 'residential'],
  ['bhadrakali', 'Bhadrakali Temple', 'Bhadrakali Temple, Pokhara', 'tourist'],
  ['ramghat', 'Ramghat', 'Ramghat, Pokhara', 'residential'],
  // Former Lekhnath municipality (wards 26–33)
  ['budhibazar', 'Budhibazar (Lekhnath)', 'Budhibazar, Pokhara', 'commercial'],
  ['sisuwa', 'Sisuwa (Lekhnath)', 'Sisuwa, Pokhara', 'commercial'],
  ['khudi', 'Khudi (Lekhnath)', 'Khudi, Pokhara', 'residential'],
];

// Nominatim returns a point in the wrong ward for these; corrected against the OSM ward polygons
// (Lakeside & Damside are Ward 6 Baidam, Chhorepatan is Ward 17, Talchowk is Ward 27).
const OVERRIDE = {
  lakeside: { lat: 28.2090, lng: 83.9595 },
  damside: { lat: 28.2005, lng: 83.9660 },
  chhorepatan: { lat: 28.1895, lng: 83.9640 },
  talchowk: { lat: 28.1748, lng: 84.0559 },
};

// Places Nominatim could not resolve; coordinates read off the OSM map by hand.
const MANUAL = {
  'barahi-ghat': { lat: 28.2105, lng: 83.9565 },
  'tourist-bus-park': { lat: 28.2015, lng: 83.9695 },
  'old-airport': { lat: 28.2009, lng: 83.9821 },
  'pn-campus': { lat: 28.2398, lng: 83.9933 },
  'gupteshwor': { lat: 28.1883, lng: 83.9600 },
};

const sleep =(ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const json = await res.json();
  return json[0] ? { lat: +(+json[0].lat).toFixed(5), lng: +(+json[0].lon).toFixed(5), osm: json[0].display_name } : null;
}

async function main() {
  const places = [];
  for (const [id, name, query, category] of PLACES) {
    let hit = OVERRIDE[id] ? { ...OVERRIDE[id], osm: 'manual correction (checked against OSM ward polygon)' } : await geocode(query);
    if (!hit) { await sleep(1100); hit = await geocode(name); }
    if (!hit && MANUAL[id]) hit = { ...MANUAL[id], osm: 'manual (approximate, not in Nominatim)' };
    const ward = hit && wardOf(hit);
    console.log(hit ? 'OK  ' : 'MISS', id, hit ? `${hit.lat},${hit.lng} ${ward ? ward.label : 'outside Pokhara Metropolitan City'}` : '');
    if (hit) places.push({ id, name, category, lat: hit.lat, lng: hit.lng, ward: ward?.ward ?? null, osm: hit.osm });
    await sleep(1100);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'places.json'), JSON.stringify(places, null, 2));

  // OSRM table: real road distance (m) and duration (s) for every pair
  const coords = places.map((p) => `${p.lng},${p.lat}`).join(';');
  const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance,duration`, { headers: { 'User-Agent': UA } });
  const table = await res.json();
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'route-matrix.json'), JSON.stringify({
    source: 'OSRM (router.project-osrm.org) over OpenStreetMap, measured ' + new Date().toISOString().slice(0, 10),
    ids: places.map((p) => p.id),
    distances_m: table.distances,
    durations_s: table.durations,
  }));
  console.log('matrix', table.code);
}

main().catch((e) => { console.error(e); process.exit(1); });
