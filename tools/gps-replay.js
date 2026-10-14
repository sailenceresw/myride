// Field-test the MyRide Drive navigation on an Android emulator by feeding its real GPS (not the in-app simulation)
// along an OSRM road route, at a realistic speed with GPS noise and an optional wrong turn to exercise rerouting.
//
//   node tools/gps-replay.js --from lakeside --to mahendrapul [--kmh 30] [--noise 8] [--detour] [--device emulator-5554]
//
// Accept a trip in the Drive app first; the Navigator then follows these fixes like a real drive.
const { execFileSync } = require('child_process');
const path = require('path');
const { places, navigationRoute, alongPolyline, haversineKm } = require('../src/geo');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] ?? true; };
const place = (id) => places.find((p) => p.id === id) || (console.error(`Unknown place "${id}". Try: ${places.slice(0, 8).map((p) => p.id).join(', ')}…`), process.exit(1));
const adb = path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk/platform-tools/adb');
const device = arg('device', 'emulator-5554');
const fix = ({ lat, lng }) => execFileSync(adb, ['-s', device, 'emu', 'geo', 'fix', String(lng), String(lat)]); // adb wants lng first

(async () => {
  const from = place(arg('from', 'lakeside')), to = place(arg('to', 'mahendrapul'));
  const kmh = +arg('kmh', 30), noiseM = +arg('noise', 8), detour = !!arg('detour', false);
  const r = await navigationRoute(from, to);
  if (r.steps.length <= 2) console.warn('OSRM unavailable — straight-line route, turn prompts will be minimal');
  const km = r.km, secs = Math.ceil((km / kmh) * 3600);
  console.log(`${from.name} → ${to.name}: ${km.toFixed(2)} km, ${r.steps.length} steps, ~${Math.round(secs / 60)} min at ${kmh} km/h${detour ? ', with a wrong turn at 40%' : ''}`);
  const jitter = () => ((Math.random() - 0.5) * 2 * noiseM) / 111_000;
  for (let t = 0; t <= secs; t++) {
    const f = t / secs;
    let p = alongPolyline(r.geometry, f);
    if (detour && f > 0.4 && f < 0.48) p = { lat: p.lat + 0.0009, lng: p.lng }; // ~100 m off the road for a few fixes
    fix({ lat: p.lat + jitter(), lng: p.lng + jitter() });
    if (t % 15 === 0) console.log(`  ${Math.round(f * 100)}%  ${(haversineKm(p, to) * 1000).toFixed(0)} m to go`);
    await new Promise((res) => setTimeout(res, 1000));
  }
  fix(to);
  console.log('Arrived.');
})();
