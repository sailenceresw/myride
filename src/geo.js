const path = require('path');
const { CITY, CITIES } = require('./config');
const places = require('../data/places.json');

const R = 6371;
const rad = (x) => (x * Math.PI) / 180;

function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isValidPoint(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

// ---------- polygons (GeoJSON, [lng, lat]) ----------
function inRing(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeo(geo, p) {
  if (!geo) return false;
  const polys = geo.type === 'Polygon' ? [geo.coordinates] : geo.type === 'MultiPolygon' ? geo.coordinates : [];
  return polys.some((poly) => inRing(poly[0], p.lng, p.lat) && !poly.slice(1).some((hole) => inRing(hole, p.lng, p.lat)));
}
function bbox(geo) {
  const pts = (geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates).flatMap((poly) => poly[0]);
  return pts.reduce((b, [lng, lat]) => [Math.min(b[0], lng), Math.min(b[1], lat), Math.max(b[2], lng), Math.max(b[3], lat)], [Infinity, Infinity, -Infinity, -Infinity]);
}

// Load each active city's official boundary and ward polygons.
const cities = {};
for (const [id, c] of Object.entries(CITIES)) {
  const city = { id, ...c, boundaryGeo: null, wards: [] };
  try {
    if (c.boundary) city.boundaryGeo = require(path.join('..', 'data', c.boundary)).geojson;
    if (c.wards) city.wards = require(path.join('..', 'data', c.wards)).wards.map((w) => ({ ...w, bbox: w.geojson ? bbox(w.geojson) : null }));
  } catch { /* boundary data not downloaded yet: fall back to radius */ }
  cities[id] = city;
}

function cityOf(p) {
  if (!isValidPoint(p)) return null;
  for (const c of Object.values(cities)) {
    if (!c.active) continue;
    if (c.boundaryGeo ? inGeo(c.boundaryGeo, p) : haversineKm(c.centre, p) <= CITY.maxRadiusKm) return c;
  }
  return null;
}

// Which ward of the city a point is in, e.g. { ward: 27, name: 'Tal Chowk', label: 'Pokhara-27, Tal Chowk' }.
function wardOf(p, city = cityOf(p)) {
  if (!city) return null;
  for (const w of city.wards) {
    const b = w.bbox;
    if (b && p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3] && inGeo(w.geojson, p)) {
      return { city: city.id, ward: w.ward, name: w.name, former: w.former, label: `${city.name}-${w.ward}, ${w.name}` };
    }
  }
  return null;
}

// Inside an active launch city (pickup rule).
function inLaunchCity(p) { return !!cityOf(p); }

// Within the provincial 20 km operating radius of an active city (passenger ride drop rule).
function inServiceArea(p) {
  if (!isValidPoint(p)) return false;
  return Object.values(cities).some((c) => c.active && haversineKm(c.centre, p) <= CITY.maxRadiusKm);
}

function estimateRoute(a, b) {
  const km = haversineKm(a, b) * CITY.detourFactor;
  return { km, min: (km / CITY.fallbackSpeedKmh) * 60, geometry: [[a.lat, a.lng], [b.lat, b.lng]], source: 'estimate' };
}

const cache = new Map();
const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';

// Real road route via OSRM; falls back to straight-line × measured detour factor if OSRM is unreachable.
async function route(a, b, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const key = [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(5)).join(',');
  if (cache.has(key)) return cache.get(key);
  if (process.env.MYRIDE_OFFLINE === '1' || !fetchImpl) return estimateRoute(a, b);
  try {
    const url = `${OSRM}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'MyRide/0.1' } });
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) return estimateRoute(a, b);
    const r = json.routes[0];
    const out = {
      km: r.distance / 1000,
      min: Math.max((r.duration / 60) * CITY.trafficFactor, 1),
      geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      source: 'osrm',
    };
    if (cache.size > 5000) cache.clear();
    cache.set(key, out);
    return out;
  } catch {
    return estimateRoute(a, b);
  }
}

function nearestPlace(p, maxKm = 0.6) {
  let best = null;
  for (const pl of places) {
    const d = haversineKm(p, pl);
    if (d <= maxKm && (!best || d < best.d)) best = { ...pl, d };
  }
  return best;
}

// Point at fraction t (0..1) along a polyline, by distance.
function alongPolyline(geometry, t) {
  if (geometry.length < 2) return { lat: geometry[0][0], lng: geometry[0][1] };
  const seg = [];
  let total = 0;
  for (let i = 1; i < geometry.length; i++) {
    const d = haversineKm({ lat: geometry[i - 1][0], lng: geometry[i - 1][1] }, { lat: geometry[i][0], lng: geometry[i][1] });
    seg.push(d);
    total += d;
  }
  let target = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(target / seg[i], 1) : 0;
      const [la1, ln1] = geometry[i];
      const [la2, ln2] = geometry[i + 1];
      return { lat: la1 + (la2 - la1) * f, lng: ln1 + (ln2 - ln1) * f };
    }
    target -= seg[i];
  }
}

module.exports = { haversineKm, isValidPoint, inServiceArea, inLaunchCity, cityOf, wardOf, inGeo, cities, estimateRoute, route, nearestPlace, alongPolyline, places };
