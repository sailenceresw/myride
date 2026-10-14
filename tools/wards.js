// Research script: downloads the official OSM boundaries of Pokhara Metropolitan City (relation 6104486) and its
// 33 wards (Pokhara-01 … Pokhara-33, admin_level 9; wards 26–33 = former Lekhnath municipality), then measures each
// ward's area, centre and road distance/time from Zero Kilometer with OSRM.
// Output: data/wards.json, data/pokhara-boundary.json   Usage: node tools/wards.js
const fs = require('fs');
const path = require('path');

const UA = 'MyRideResearch/0.3 (pokhara ward coverage study)';
const CENTRE = { lat: 28.21286, lng: 83.97548 };
const CITY_REL = 6104486;
// OSM relation ids found via Overpass: relation["boundary"="administrative"]["admin_level"="9"] named Pokhara-NN
const WARD_REL = {
  1: 6273322, 2: 6276333, 3: 6273323, 4: 6276353, 5: 6273344, 6: 6275741, 7: 6272780, 8: 6272781, 9: 6272283, 10: 6270328,
  11: 6290413, 12: 6272231, 13: 6290683, 14: 6276303, 15: 6275777, 16: 6290826, 17: 6275780, 18: 6290824, 19: 6290823,
  20: 6290710, 21: 6290685, 22: 6290686, 23: 7374354, 24: 6104166, 25: 6290827, 26: 7376035, 27: 7376120, 28: 7376167,
  29: 7376122, 30: 7374518, 31: 7374469, 32: 7374453, 33: 6104746,
};
// Ward names and 2021 census population (Wikipedia ward table, sums to 513,504), former local unit before the 2017 merger.
const INFO = {
  1: ['Bagar', 13947], 2: ['Miruwa', 10100], 3: ['Nadipur', 8284], 4: ['Gairapatan', 9152], 5: ['Malepatan', 22325],
  6: ['Baidam (Lakeside)', 14455], 7: ['Masbar', 16139], 8: ['Shrijana Chowk', 25439], 9: ['Naya Bazar', 15981],
  10: ['Amarsingh', 18435], 11: ['Ranipauwa', 17594], 12: ['Sital Devi', 12710], 13: ['Miya Patan', 22399],
  14: ['Majheripatan', 31561], 15: ['Rambazar', 24406], 16: ['Batulechaur', 24465], 17: ['Birauta', 46005],
  18: ['Sarangkot', 12945], 19: ['Lamachaur / Puranchaur', 13855], 20: ['Bhalam', 3936], 21: ['Nirmal Pokhari', 9070],
  22: ['Pumdi Bhumdi', 7596], 23: ['Chapakot', 4276], 24: ['Kaskikot', 5950], 25: ['Hemja', 17597],
  26: ['Budhi Bazar', 16777], 27: ['Tal Chowk', 16377], 28: ['Kalika', 4224], 29: ['Bhandardhik', 16257],
  30: ['Khudi', 16192], 31: ['Begnas', 8702], 32: ['Gagangauda', 14683], 33: ['Bharat Pokhari', 11670],
};
const FORMER = (w) => (w >= 26 ? 'Lekhnath Municipality' : [18, 20, 21, 22, 23, 24, 25].includes(w) ? 'Village (VDC) merged 2014–17' : 'Pokhara Sub-Metropolitan City');

const rad = (x) => (x * Math.PI) / 180;
const hav = (a, b) => { const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };

// Planar area (km²) of a lon/lat ring using a local equirectangular projection — accurate at city scale.
function ringAreaKm2(ring, lat0) {
  const kx = 111.32 * Math.cos(rad(lat0)), ky = 110.57;
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
  return Math.abs(s) / 2;
}
function polyAreaKm2(geo, lat0) {
  const polys = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
  return polys.reduce((sum, p) => sum + ringAreaKm2(p[0], lat0) - p.slice(1).reduce((h, r) => h + ringAreaKm2(r, lat0), 0), 0);
}
function inRing(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Interior label point: grid point inside the polygon farthest from its boundary (≈ pole of inaccessibility),
// so concave wards (e.g. 7, 9, 10) still get a centre that lies inside them.
function interiorPoint(geo) {
  const polys = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
  const outer = polys.reduce((a, p) => (p[0].length > a.length ? p[0] : a), []);
  const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = null;
  const N = 40;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const lng = x0 + ((x1 - x0) * i) / N, lat = y0 + ((y1 - y0) * j) / N;
    if (!inRing(outer, lng, lat)) continue;
    let dmin = Infinity;
    for (const [px, py] of outer) dmin = Math.min(dmin, hav({ lat, lng }, { lat: py, lng: px }));
    if (!best || dmin > best.d) best = { lat, lng, d: dmin };
  }
  return best;
}
const bboxCentre = interiorPoint;

async function main() {
  const ids = [CITY_REL, ...Object.values(WARD_REL)].map((id) => `R${id}`).join(',');
  const res = await fetch(`https://nominatim.openstreetmap.org/lookup?format=json&polygon_geojson=1&polygon_threshold=0.0002&osm_ids=${ids}`, { headers: { 'User-Agent': UA } });
  const rows = await res.json();
  const byId = Object.fromEntries(rows.map((r) => [r.osm_id, r]));

  const city = byId[CITY_REL];
  if (!city?.geojson) throw new Error('City boundary not returned');
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'pokhara-boundary.json'), JSON.stringify({
    source: 'OpenStreetMap relation 6104486 via Nominatim (© OpenStreetMap contributors, ODbL)', name: 'Pokhara Metropolitan City',
    areaKm2: +polyAreaKm2(city.geojson, 28.2).toFixed(1), geojson: city.geojson,
  }));

  const wards = [];
  for (const [w, rel] of Object.entries(WARD_REL)) {
    const r = byId[rel];
    const [name, population] = INFO[w];
    const centre = r?.geojson ? bboxCentre(r.geojson) : null;
    const areaKm2 = r?.geojson ? +polyAreaKm2(r.geojson, 28.2).toFixed(2) : null;
    wards.push({ ward: +w, name, population, former: FORMER(+w), osmRelation: rel, areaKm2, density: areaKm2 ? Math.round(population / areaKm2) : null,
      lat: centre && +centre.lat.toFixed(5), lng: centre && +centre.lng.toFixed(5), straightKmFromCentre: centre && +hav(CENTRE, centre).toFixed(2), geojson: r?.geojson || null });
  }
  // Road distance/time from Zero Kilometer to each ward centre (snapped to nearest road by OSRM)
  const coords = [CENTRE, ...wards].map((p) => `${p.lng},${p.lat}`).join(';');
  const t = await (await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=distance,duration`, { headers: { 'User-Agent': UA } })).json();
  wards.forEach((w, i) => { w.roadKmFromCentre = +(t.distances[0][i + 1] / 1000).toFixed(2); w.freeFlowMin = +(t.durations[0][i + 1] / 60).toFixed(1); });
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'wards.json'), JSON.stringify({ source: 'OSM ward relations Pokhara-01…33; population: 2021 census (ward table)', measured: new Date().toISOString().slice(0, 10), wards }));
  for (const w of wards) console.log(String(w.ward).padStart(2), w.name.padEnd(24), String(w.population).padStart(6), `${w.areaKm2} km²`.padStart(11), `${w.density}/km²`.padStart(9), `${w.straightKmFromCentre} km air`.padStart(12), `${w.roadKmFromCentre} km road`.padStart(13), w.former);
  console.log('city area', polyAreaKm2(city.geojson, 28.2).toFixed(1), 'km², ward area sum', wards.reduce((s, w) => s + (w.areaKm2 || 0), 0).toFixed(1));
}
main().catch((e) => { console.error(e); process.exit(1); });
