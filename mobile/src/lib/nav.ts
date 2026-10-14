// Uber-style turn-by-turn navigation engine (pure TypeScript — no React Native imports, unit-tested in test/).
// Input: route polyline + OSRM maneuver steps from GET /api/navigate. Output per GPS fix: snapped position,
// next instruction, distance to it, remaining distance/time, off-route flag and what to announce by voice.

export type LatLng = { lat: number; lng: number };
export type Step = {
  type: string; // depart | turn | new name | continue | merge | on ramp | off ramp | fork | end of road | roundabout | rotary | arrive …
  modifier: string; // left | right | slight left | slight right | sharp left | sharp right | straight | uturn
  name: string;
  exit?: number;
  distance: number; // metres of this step
  duration: number; // seconds
  location: [number, number]; // [lat, lng] of the maneuver
};
export type NavRoute = { geometry: [number, number][]; steps: Step[]; km: number; min: number };

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const pt = ([lat, lng]: [number, number]): LatLng => ({ lat, lng });

// Project p onto segment ab in a local metric plane; returns distance (m) and fraction t along the segment.
function projectOnSegment(p: LatLng, a: LatLng, b: LatLng) {
  const kx = Math.cos(rad(p.lat)) * 111320, ky = 110574;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const cx = ax + t * dx, cy = ay + t * dy;
  return { dist: Math.hypot(cx, cy), t, point: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t } };
}

/** Cumulative distance (m) at every polyline vertex. */
export function cumulative(geometry: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < geometry.length; i++) out.push(out[i - 1] + distanceM(pt(geometry[i - 1]), pt(geometry[i])));
  return out;
}

/** Distance along the route (m) at which each step's maneuver happens. */
export function stepOffsets(route: NavRoute, cum = cumulative(route.geometry)): number[] {
  let from = 0;
  return route.steps.map((s) => {
    let best = from, bestD = Infinity;
    for (let i = from; i < route.geometry.length; i++) {
      const d = distanceM(pt(route.geometry[i]), pt(s.location));
      if (d < bestD) { bestD = d; best = i; }
      if (bestD < 3 && d > bestD + 50) break; // passed it
    }
    from = best;
    return cum[best];
  });
}

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];

/** Human instruction, e.g. "Turn left onto Baidam Road". */
export function instruction(s: Step): string {
  const onto = s.name ? ` onto ${s.name}` : '';
  const m = s.modifier;
  switch (s.type) {
    case 'depart': return `Head ${s.name ? `along ${s.name}` : 'out'}`;
    case 'arrive': return 'You have arrived';
    case 'roundabout':
    case 'rotary':
      return s.exit ? `At the roundabout, take the ${ORD[s.exit] || `${s.exit}th`} exit${onto}` : `Enter the roundabout${onto}`;
    case 'exit roundabout': case 'exit rotary': return `Exit the roundabout${onto}`;
    case 'merge': return `Merge ${m.replace('slight ', '')}${onto}`;
    case 'on ramp': return `Take the ramp${onto}`;
    case 'off ramp': return `Take the exit${onto}`;
    case 'fork': return `Keep ${m.includes('left') ? 'left' : 'right'}${s.name ? ` towards ${s.name}` : ''}`;
    case 'end of road': return `At the end of the road, turn ${m.includes('left') ? 'left' : 'right'}${onto}`;
    case 'new name': case 'continue':
      if (m === 'uturn') return `Make a U-turn${onto}`;
      return m && m !== 'straight' ? `Keep ${m.includes('left') ? 'left' : 'right'}${onto}` : `Continue${onto || ' straight'}`;
    default:
      if (m === 'uturn') return 'Make a U-turn';
      if (m === 'straight') return `Continue straight${onto}`;
      return `Turn ${m || 'ahead'}${onto}`;
  }
}

/** Arrow glyph for the maneuver banner. */
export function arrow(s: Step): string {
  if (s.type === 'arrive') return '🏁';
  if (s.type === 'roundabout' || s.type === 'rotary') return '⟳';
  const m = s.modifier;
  if (m === 'uturn') return '↶';
  if (m.includes('sharp left')) return '↰';
  if (m.includes('sharp right')) return '↱';
  if (m.includes('slight left')) return '↖';
  if (m.includes('slight right')) return '↗';
  if (m.includes('left')) return '←';
  if (m.includes('right')) return '→';
  return '↑';
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  if (m >= 100) return `${Math.round(m / 50) * 50} m`;
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
}

export type NavState = {
  snapped: LatLng; // position on the route
  offRouteM: number; // distance from the route
  offRoute: boolean;
  along: number; // metres travelled along the route
  remainingM: number;
  remainingMin: number;
  stepIndex: number; // index of the NEXT maneuver
  next: Step | null;
  toNextM: number;
  heading: number; // road bearing at the snapped point (for camera)
  arrived: boolean;
};

export const OFF_ROUTE_M = 45;
export const ARRIVE_M = 35;

/** Progress of `pos` along the route. `hintIndex` = last segment index (speeds up search, avoids jumping back). */
export function progress(route: NavRoute, pos: LatLng, ctx: { cum: number[]; offsets: number[]; hintIndex?: number }): NavState & { segIndex: number } {
  const g = route.geometry;
  const start = Math.max(0, (ctx.hintIndex ?? 0) - 5);
  let best = { dist: Infinity, t: 0, point: pos, i: start };
  for (let i = start; i < g.length - 1; i++) {
    const r = projectOnSegment(pos, pt(g[i]), pt(g[i + 1]));
    if (r.dist < best.dist) best = { ...r, i };
    if (best.dist < 15 && i > best.i + 30) break; // close match found; stop scanning far ahead
  }
  if (g.length === 1) best = { dist: distanceM(pos, pt(g[0])), t: 0, point: pt(g[0]), i: 0 };
  const segLen = g.length > 1 ? ctx.cum[best.i + 1] - ctx.cum[best.i] : 0;
  const along = ctx.cum[best.i] + segLen * best.t;
  const total = ctx.cum[ctx.cum.length - 1];
  const remainingM = Math.max(0, total - along);
  let stepIndex = ctx.offsets.findIndex((o, i) => i > 0 && o > along + 5);
  if (stepIndex < 0) stepIndex = route.steps.length - 1;
  const next = route.steps[stepIndex] ?? null;
  const toNextM = Math.max(0, (ctx.offsets[stepIndex] ?? total) - along);
  const heading = g.length > 1 ? bearing(pt(g[best.i]), pt(g[Math.min(best.i + 1, g.length - 1)])) : 0;
  const speed = total > 0 && route.min > 0 ? total / (route.min * 60) : 6; // m/s implied by the route ETA
  const end = pt(g[g.length - 1]);
  return {
    snapped: best.point, offRouteM: best.dist, offRoute: best.dist > OFF_ROUTE_M, along, remainingM,
    remainingMin: remainingM / speed / 60, stepIndex, next, toNextM, heading,
    arrived: distanceM(pos, end) < ARRIVE_M || remainingM < ARRIVE_M, segIndex: best.i,
  };
}

/** Voice prompts at ~500 m, ~150 m and at the maneuver. Returns the text to speak, or null. */
export function announcement(state: NavState, spoken: Set<string>): string | null {
  if (!state.next) return null;
  const key = (band: string) => `${state.stepIndex}:${band}`;
  const say = (band: string, text: string) => { if (spoken.has(key(band))) return null; spoken.add(key(band)); return text; };
  const ins = instruction(state.next);
  if (state.next.type === 'arrive') return state.toNextM < 60 ? say('now', 'You have arrived at your destination') : null;
  if (state.toNextM <= 40) return say('now', ins);
  if (state.toNextM <= 180) return say('near', `In ${formatDistance(state.toNextM)}, ${ins.charAt(0).toLowerCase()}${ins.slice(1)}`);
  if (state.toNextM <= 600 && state.toNextM > 300) return say('far', `In ${formatDistance(state.toNextM)}, ${ins.charAt(0).toLowerCase()}${ins.slice(1)}`);
  return null;
}

/** Synthetic GPS along the route for emulator demos: position after `seconds` at `speedMps`. */
export function simulatedPosition(route: NavRoute, cum: number[], seconds: number, speedMps = 9): LatLng & { heading: number } {
  const g = route.geometry;
  const d = Math.min(seconds * speedMps, cum[cum.length - 1]);
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < d) i++;
  const seg = cum[i + 1] - cum[i] || 1;
  const t = (d - cum[i]) / seg;
  const a = pt(g[i]), b = pt(g[Math.min(i + 1, g.length - 1)]);
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, heading: bearing(a, b) };
}
