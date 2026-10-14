// Runs with Node 24's built-in TypeScript type stripping: `node --test test/`
import test from 'node:test';
import assert from 'node:assert/strict';
import { instruction, arrow, formatDistance, cumulative, stepOffsets, progress, announcement, simulatedPosition, distanceM, bearing, OFF_ROUTE_M, type NavRoute, type Step } from '../src/lib/nav.ts';

// A small L-shaped route in Lakeside: ~550 m east, then ~330 m north.
const A: [number, number] = [28.2090, 83.9595];
const B: [number, number] = [28.2090, 83.9651];
const C: [number, number] = [28.2120, 83.9651];
const step = (type: string, modifier: string, name: string, location: [number, number], distance = 0): Step => ({ type, modifier, name, location, distance, duration: distance / 8 });
const route: NavRoute = {
  geometry: [A, [28.2090, 83.9623], B, [28.2105, 83.9651], C],
  steps: [step('depart', 'straight', 'Lakeside Road', A, 550), step('turn', 'left', 'Baidam Road', B, 330), step('arrive', '', '', C)],
  km: 0.88, min: 2,
};
const cum = cumulative(route.geometry);
const offsets = stepOffsets(route, cum);

test('instructions read like a navigation app', () => {
  assert.equal(instruction(step('turn', 'left', 'Baidam Road', B)), 'Turn left onto Baidam Road');
  assert.equal(instruction(step('turn', 'slight right', '', B)), 'Turn slight right');
  assert.equal(instruction({ ...step('roundabout', '', 'Prithvi Highway', B), exit: 2 }), 'At the roundabout, take the 2nd exit onto Prithvi Highway');
  assert.equal(instruction(step('end of road', 'right', 'Baidam Road', B)), 'At the end of the road, turn right onto Baidam Road');
  assert.equal(instruction(step('fork', 'slight left', 'Mahendrapul', B)), 'Keep left towards Mahendrapul');
  assert.equal(instruction(step('new name', 'straight', 'Phewa Marg', B)), 'Continue onto Phewa Marg');
  assert.equal(instruction(step('continue', 'uturn', '', B)), 'Make a U-turn');
  assert.equal(instruction(step('arrive', '', '', C)), 'You have arrived');
  assert.equal(arrow(step('turn', 'left', '', B)), '←');
  assert.equal(arrow(step('turn', 'sharp right', '', B)), '↱');
});

test('distance formatting rounds like Uber (50 m steps, km with one decimal)', () => {
  assert.equal(formatDistance(7), '10 m');
  assert.equal(formatDistance(140), '150 m');
  assert.equal(formatDistance(1840), '1.8 km');
  assert.equal(formatDistance(23400), '23 km');
});

test('geometry helpers', () => {
  assert.ok(Math.abs(distanceM({ lat: A[0], lng: A[1] }, { lat: B[0], lng: B[1] }) - 548) < 10);
  assert.ok(Math.abs(bearing({ lat: A[0], lng: A[1] }, { lat: B[0], lng: B[1] }) - 90) < 1, 'east');
  assert.ok(Math.abs(bearing({ lat: B[0], lng: B[1] }, { lat: C[0], lng: C[1] }) - 0) < 1, 'north');
  assert.deepEqual(offsets.map((o) => Math.round(o)), [0, Math.round(cum[2]), Math.round(cum[4])]);
});

test('progress: snaps to the road, finds the next turn and remaining distance', () => {
  const s = progress(route, { lat: 28.20905, lng: 83.9610 }, { cum, offsets });
  assert.ok(s.offRouteM < 10);
  assert.equal(s.offRoute, false);
  assert.equal(s.next?.name, 'Baidam Road');
  assert.ok(Math.abs(s.toNextM - distanceM({ lat: 28.2090, lng: 83.9610 }, { lat: B[0], lng: B[1] })) < 15);
  assert.ok(Math.abs(s.heading - 90) < 2);
  assert.ok(s.remainingM > 715 && s.remainingM < 755, String(s.remainingM)); // 548 m + 332 m − 147 m travelled
  assert.equal(s.arrived, false);
  const after = progress(route, { lat: 28.2100, lng: 83.9651 }, { cum, offsets, hintIndex: s.segIndex });
  assert.equal(after.next?.type, 'arrive');
  assert.ok(Math.abs(after.heading) < 2 || Math.abs(after.heading - 360) < 2);
});

test('off-route detection triggers beyond 45 m; arrival within 35 m of the end', () => {
  const off = progress(route, { lat: 28.2080, lng: 83.9610 }, { cum, offsets });
  assert.ok(off.offRouteM > OFF_ROUTE_M);
  assert.equal(off.offRoute, true);
  assert.equal(progress(route, { lat: 28.2119, lng: 83.9651 }, { cum, offsets }).arrived, true);
});

test('voice prompts: far (~500 m), near (≤180 m), now (≤40 m) — each spoken once', () => {
  const spoken = new Set<string>();
  const at = (lng: number) => progress(route, { lat: 28.2090, lng }, { cum, offsets });
  assert.match(announcement(at(83.9604), spoken) ?? '', /^In 450 m, turn left onto Baidam Road$/);
  assert.equal(announcement(at(83.9605), spoken), null, 'not repeated');
  assert.match(announcement(at(83.9636), spoken) ?? '', /^In 150 m, turn left/);
  assert.equal(announcement(at(83.9648), spoken), 'Turn left onto Baidam Road');
});

test('simulated GPS walks the route (emulator demo mode)', () => {
  const start = simulatedPosition(route, cum, 0);
  assert.ok(distanceM(start, { lat: A[0], lng: A[1] }) < 1);
  const end = simulatedPosition(route, cum, 10_000);
  assert.ok(distanceM(end, { lat: C[0], lng: C[1] }) < 1);
  const mid = simulatedPosition(route, cum, 30, 10);
  assert.ok(Math.abs(mid.heading - 90) < 2);
});

test('field-style drive: noisy GPS (±12 m) never false-reroutes, never jumps back, speaks each prompt once, arrives', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5; // deterministic jitter
  const jitter = 12 / 111_000; // ≈ 12 m in degrees
  const spoken = new Set<string>();
  const said: string[] = [];
  let hint = 0, offStreak = 0, maxOffStreak = 0, arrived = false;
  for (let t = 0; t <= 140 && !arrived; t++) {
    const p = simulatedPosition(route, cum, t, 7); // ~25 km/h through Lakeside traffic
    const s = progress(route, { lat: p.lat + rand() * 2 * jitter, lng: p.lng + rand() * 2 * jitter }, { cum, offsets, hintIndex: hint });
    assert.ok(s.segIndex >= hint, `jumped back at t=${t}`);
    hint = s.segIndex;
    offStreak = s.offRoute ? offStreak + 1 : 0;
    maxOffStreak = Math.max(maxOffStreak, offStreak);
    const a = announcement(s, spoken);
    if (a) said.push(a);
    arrived = s.arrived;
  }
  assert.ok(arrived, 'reached the destination');
  assert.ok(maxOffStreak < 3, 'the Navigator reroutes after 3 off-route fixes — jitter must never trigger it');
  assert.equal(new Set(said).size, said.length, 'no repeated prompts');
  assert.ok(said.some((x) => x === 'Turn left onto Baidam Road'), said.join(' | '));
});

test('a GPS dropout that jumps ahead resumes on the right segment', () => {
  const s = progress(route, { lat: 28.2110, lng: 83.9651 }, { cum, offsets, hintIndex: 0 }); // reappears after the turn
  assert.equal(s.next?.type, 'arrive');
  assert.equal(s.offRoute, false);
});
