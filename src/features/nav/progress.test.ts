import { describe, expect, it } from 'vitest';
import type { Route, RouteStep } from '../../api/directions';
import { angleDiffDeg, bearingDeg, destinationPoint, haversineM, nearestPointOnLine } from '../../lib';
import type { LngLat } from '../../types';
import {
  ARRIVAL_MAX_SPEED_MPS,
  INITIAL_REROUTE_POLICY,
  OFF_ROUTE_TIME_MS,
  REROUTE_BACKOFF_RESET_MS,
  REROUTE_MAX_INTERVAL_MS,
  REROUTE_MIN_INTERVAL_MS,
  decideReroute,
  initialProgress,
  mercatorFraction,
  prepareRoute,
  rerouteIntervalMs,
  startTracker,
  trackProgress,
  type PreparedRoute,
  type Progress,
  type ProgressFix,
  type ReroutePolicy,
  type TrackerState,
} from './progress';

const START: LngLat = [-122.4, 37.79];
const T0 = 1_700_000_000_000;
const SPEED = 10; // m/s used for the synthetic step durations

/** A route from `legs` ([bearing, metres]) with a vertex every ≤ 25 m, like a Directions geometry. */
function makeRoute(legs: Array<[number, number]>, start: LngLat = START): Route {
  const line: LngLat[] = [start];
  const corners: LngLat[] = [start];
  for (const [bearing, metres] of legs) {
    const from = corners[corners.length - 1];
    const n = Math.max(1, Math.ceil(metres / 25));
    for (let k = 1; k <= n; k++) line.push(destinationPoint(from, bearing, (metres * k) / n));
    corners.push(line[line.length - 1]);
  }
  const steps: RouteStep[] = [];
  legs.forEach(([bearing, metres], i) => {
    const prevBearing = i === 0 ? bearing : legs[i - 1][0];
    const turn = angleDiffDeg(prevBearing, bearing);
    const modifier =
      i === 0 ? null : Math.abs(turn) > 150 ? 'uturn' : turn > 0 ? 'right' : turn < 0 ? 'left' : 'straight';
    steps.push({
      maneuver: {
        type: i === 0 ? 'depart' : 'turn',
        modifier,
        exit: null,
        location: corners[i],
        bearingAfter: bearing,
        instruction: '',
      },
      label: `Street ${i}`,
      distanceM: metres,
      durationS: metres / SPEED,
    });
  });
  steps.push({
    maneuver: { type: 'arrive', modifier: null, exit: null, location: corners[corners.length - 1], bearingAfter: 0, instruction: '' },
    label: '',
    distanceM: 0,
    durationS: 0,
  });
  const distanceM = legs.reduce((s, [, m]) => s + m, 0);
  return { line, distanceM, durationS: distanceM / SPEED, steps };
}

/** Point `along` metres along a polyline, shifted `offsetM` to the right of travel. */
function pointOn(p: PreparedRoute, along: number, offsetM = 0): { point: LngLat; bearing: number } {
  const a = Math.max(0, Math.min(p.lengthM, along));
  let i = 0;
  while (i < p.cum.length - 2 && p.cum[i + 1] < a) i++;
  const bearing = bearingDeg(p.line[i], p.line[i + 1]);
  const onLine = destinationPoint(p.line[i], bearing, a - p.cum[i]);
  return { point: offsetM ? destinationPoint(onLine, bearing + 90, offsetM) : onLine, bearing };
}

function fixAt(point: LngLat, t: number, extra: Partial<ProgressFix> = {}): ProgressFix {
  return { lng: point[0], lat: point[1], speedMps: SPEED, headingDeg: null, accuracyM: 5, timestamp: t, ...extra };
}

/** Feed fixes in order; returns every progress. */
function run(p: PreparedRoute, fixes: ProgressFix[], tracker: TrackerState = startTracker({ originAt: T0 })) {
  const out: Progress[] = [];
  let t = tracker;
  for (const f of fixes) {
    const r = trackProgress(p, t, f);
    t = r.tracker;
    out.push(r.progress);
  }
  return { progress: out, tracker: t };
}

/** Deterministic noise in [-1, 1). */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return 2 * (x - Math.floor(x)) - 1;
}

// East 600 m, right (south) 400 m, arrive.
const L_ROUTE = makeRoute([
  [90, 600],
  [180, 400],
]);
const L_DEST = L_ROUTE.line[L_ROUTE.line.length - 1];

describe('prepareRoute', () => {
  it('places every maneuver along the line', () => {
    const p = prepareRoute(L_ROUTE, L_DEST);
    expect(p.lengthM).toBeCloseTo(1000, -1);
    expect(p.maneuverAlongM).toHaveLength(3);
    expect(p.maneuverAlongM[0]).toBe(0);
    expect(p.maneuverAlongM[1]).toBeCloseTo(600, -1);
    expect(p.maneuverAlongM[2]).toBeCloseTo(p.lengthM, 6);
    expect(p.durationAfterS[0]).toBeCloseTo(40, 6);
    expect(p.scale).toBeCloseTo(1, 2);
  });

  it('keeps maneuvers in order on a U-shaped route whose legs run side by side', () => {
    // East 400, south 30, west 400: the second turn is 30 m from the depart point's leg.
    const u = makeRoute([
      [90, 400],
      [180, 30],
      [270, 400],
    ]);
    const p = prepareRoute(u, u.line[u.line.length - 1]);
    expect(p.maneuverAlongM.map((m) => Math.round(m / 5) * 5)).toEqual([0, 400, 430, 830]);
  });

  it('mercatorFraction runs 0 → 1, monotonic, ≈ along/length on a city-sized route', () => {
    const p = prepareRoute(L_ROUTE, L_DEST);
    expect(mercatorFraction(p, 0)).toBe(0);
    expect(mercatorFraction(p, p.lengthM)).toBeCloseTo(1, 9);
    expect(mercatorFraction(p, -50)).toBe(0);
    expect(mercatorFraction(p, p.lengthM + 50)).toBeCloseTo(1, 9);
    let last = -1;
    for (let a = 0; a <= p.lengthM; a += 10) {
      const f = mercatorFraction(p, a);
      expect(f).toBeGreaterThanOrEqual(last);
      expect(Math.abs(f - a / p.lengthM)).toBeLessThan(0.15); // E-W vs N-S mercator stretch differs by cos(lat)
      last = f;
    }
  });
});

describe('trackProgress — on route', () => {
  const p = prepareRoute(L_ROUTE, L_DEST);

  it('counts distance, time and the next maneuver down as the car drives', () => {
    const fixes = [];
    for (let s = 1; s <= 95; s++) fixes.push(fixAt(pointOn(p, s * SPEED).point, T0 + s * 1000));
    const { progress } = run(p, fixes);

    for (let i = 1; i < progress.length; i++) {
      expect(progress[i].alongM).toBeGreaterThan(progress[i - 1].alongM);
      expect(progress[i].remainingM).toBeLessThan(progress[i - 1].remainingM);
      expect(progress[i].remainingS).toBeLessThan(progress[i - 1].remainingS);
      expect(progress[i].offRoute).toBe(false);
    }
    const at30 = progress[29]; // 300 m along
    expect(at30.alongM).toBeCloseTo(300, 0);
    expect(at30.lateralM).toBeLessThan(0.5);
    expect(at30.stepIndex).toBe(0);
    expect(at30.next?.index).toBe(1);
    expect(at30.next?.step.maneuver.modifier).toBe('right');
    expect(at30.next?.distanceM).toBeCloseTo(300, -1);
    expect(at30.remainingM).toBeCloseTo(700, -1);
    expect(at30.remainingS).toBeCloseTo(70, 0);
    expect(at30.fraction).toBeGreaterThan(0.2);
    expect(at30.fraction).toBeLessThan(0.4);

    const at70 = progress[69]; // 700 m: past the turn, heading for the arrival
    expect(at70.stepIndex).toBe(1);
    expect(at70.next?.step.maneuver.type).toBe('arrive');
    expect(at70.next?.distanceM).toBeCloseTo(300, -1);
    expect(at70.arrived).toBe(false); // still at speed
  });

  it('initialProgress describes the route before the first fix', () => {
    const first = initialProgress(p, T0);
    expect(first.remainingM).toBeCloseTo(1000, -1);
    expect(first.remainingS).toBeCloseTo(100, 0);
    expect(first.next?.distanceM).toBeCloseTo(600, -1);
  });

  it('copes with a route requested a moment ago (the car already moved on)', () => {
    // Origin fix at T0, first fix 2 s later 25 m along.
    const { progress } = run(p, [fixAt(pointOn(p, 25).point, T0 + 2000)]);
    expect(progress[0].alongM).toBeCloseTo(25, 0);
  });

  it('follows a jump even when the speed is unknown (0) — the straight-line move widens the window', () => {
    const before = run(p, [fixAt(pointOn(p, 20).point, T0 + 2000, { speedMps: 0 })]);
    const after = trackProgress(p, before.tracker, fixAt(pointOn(p, 560).point, T0 + 62_000, { speedMps: 0 }));
    expect(after.progress.offRoute).toBe(false);
    expect(after.progress.alongM).toBeCloseTo(560, 0);
  });

  it('extrapolates through a tunnel: no fixes for 40 s, then 450 m further on', () => {
    const before = run(p, [fixAt(pointOn(p, 100).point, T0 + 10_000, { speedMps: 11 })]);
    const after = trackProgress(p, before.tracker, fixAt(pointOn(p, 550).point, T0 + 50_000, { speedMps: 11 }));
    expect(after.progress.offRoute).toBe(false);
    expect(after.progress.alongM).toBeCloseTo(550, 0);
  });
});

describe('trackProgress — GPS noise near the line', () => {
  const p = prepareRoute(L_ROUTE, L_DEST);

  it('never flags off-route for ±20 m of noise and never jumps', () => {
    const fixes = [];
    for (let s = 1; s <= 95; s++) {
      const { point } = pointOn(p, s * SPEED, 20 * noise(s));
      fixes.push(fixAt(point, T0 + s * 1000, { accuracyM: 15 }));
    }
    const { progress } = run(p, fixes);
    for (let i = 0; i < progress.length; i++) {
      expect(progress[i].offRoute).toBe(false);
      expect(Math.abs(progress[i].alongM - (i + 1) * SPEED)).toBeLessThan(25); // noise across a corner shifts along a little
    }
  });

  it('ignores a fix that is far off but very inaccurate', () => {
    const { point } = pointOn(p, 200, 80);
    const r = trackProgress(p, { ...startTracker({ originAt: T0 }), alongM: 190, at: T0 }, fixAt(point, T0 + 1000, { accuracyM: 120 }));
    expect(r.progress.offRoute).toBe(false);
  });
});

describe('trackProgress — U-shaped route (far leg geometrically close)', () => {
  // East 400 m, a 40 m U, back west 400 m. At 100 m along, the far leg is 40 m away.
  const u = makeRoute([
    [90, 400],
    [180, 40],
    [270, 400],
  ]);
  const p = prepareRoute(u, u.line[u.line.length - 1]);

  it('a naive nearest-point snap would jump to the far leg (sanity check of the scenario)', () => {
    const noisy = pointOn(p, 100, 25).point; // 25 m toward the far leg (right of eastbound = south)
    const naive = nearestPointOnLine(p.line, noisy, p.cum)!;
    expect(naive.alongM).toBeGreaterThan(600);
  });

  it('progress stays on the leg being driven when noise pushes toward the far leg', () => {
    const fixes = [];
    for (let s = 1; s <= 30; s++) {
      const offset = s >= 8 && s <= 14 ? 25 : 3 * noise(s); // a burst of noise toward the far leg
      fixes.push(fixAt(pointOn(p, s * SPEED, offset).point, T0 + s * 1000, { accuracyM: 20 }));
    }
    const { progress } = run(p, fixes);
    for (let i = 0; i < progress.length; i++) {
      expect(Math.abs(progress[i].alongM - (i + 1) * SPEED)).toBeLessThan(15);
      expect(progress[i].next?.index).toBe(1); // still heading for the first turn
    }
  });

  it('also holds on a tight hairpin where the far leg is inside the snap window', () => {
    const h = makeRoute([
      [90, 100],
      [180, 30],
      [270, 100],
    ]);
    const hp = prepareRoute(h, h.line[h.line.length - 1]);
    const tracker: TrackerState = { ...startTracker({ originAt: T0 }), alongM: 40, at: T0 };
    // 18 m toward the far leg, which is only 12 m away from this fix.
    const r = trackProgress(hp, tracker, fixAt(pointOn(hp, 50, 18).point, T0 + 1000));
    expect(r.progress.alongM).toBeCloseTo(50, -1);
    expect(r.progress.stepIndex).toBe(0);
  });

  it('follows the route round the U normally', () => {
    const fixes = [];
    for (let s = 1; s <= 82; s++) fixes.push(fixAt(pointOn(p, s * SPEED, 4 * noise(s)).point, T0 + s * 1000));
    const { progress } = run(p, fixes);
    expect(progress[44].stepIndex).toBe(2); // 450 m: past both turns of the U
    expect(progress[44].next?.step.maneuver.type).toBe('arrive');
    expect(progress.every((q) => !q.offRoute)).toBe(true);
  });
});

describe('trackProgress — missed turn and wrong way', () => {
  const p = prepareRoute(L_ROUTE, L_DEST);

  it('flags off-route after driving past the turn, freezes progress, and times it', () => {
    const fixes = [];
    // On route to the turn at 600 m, then straight on east (missed the right turn).
    for (let s = 1; s <= 60; s++) fixes.push(fixAt(pointOn(p, s * SPEED).point, T0 + s * 1000, { headingDeg: 90 }));
    const corner = pointOn(p, 600).point;
    for (let k = 1; k <= 15; k++) fixes.push(fixAt(destinationPoint(corner, 90, k * SPEED), T0 + (60 + k) * 1000, { headingDeg: 90 }));
    const { progress } = run(p, fixes);

    const firstOff = progress.findIndex((q) => q.offRoute);
    expect(firstOff).toBeGreaterThan(60);
    const pastCorner = haversineM(corner, [fixes[firstOff].lng, fixes[firstOff].lat]);
    expect(pastCorner).toBeGreaterThan(50);
    expect(pastCorner).toBeLessThan(70);
    for (let i = firstOff; i < progress.length; i++) {
      expect(progress[i].offRoute).toBe(true);
      expect(progress[i].alongM).toBeLessThanOrEqual(progress[firstOff - 1].alongM + 1e-9);
    }
    expect(progress[progress.length - 1].offRouteForMs).toBe((progress.length - 1 - firstOff) * 1000);
    expect(progress[progress.length - 1].offRouteForMs).toBeGreaterThanOrEqual(OFF_ROUTE_TIME_MS);
  });

  it('counts driving against the route as off-route', () => {
    const { point } = pointOn(p, 200);
    const tracker: TrackerState = { ...startTracker({ originAt: T0 }), alongM: 210, at: T0 };
    const wrong = trackProgress(p, tracker, fixAt(point, T0 + 1000, { headingDeg: 270, speedMps: 10 }));
    expect(wrong.progress.offRoute).toBe(true);
    const slow = trackProgress(p, tracker, fixAt(point, T0 + 1000, { headingDeg: 270, speedMps: 2 }));
    expect(slow.progress.offRoute).toBe(false);
  });

  it('resets the off-route timer when back on the route', () => {
    const tracker: TrackerState = { ...startTracker({ originAt: T0 }), alongM: 200, at: T0, offRouteSince: T0 - 3000 };
    const r = trackProgress(p, tracker, fixAt(pointOn(p, 210).point, T0 + 1000));
    expect(r.progress.offRoute).toBe(false);
    expect(r.progress.offRouteForMs).toBe(0);
    expect(r.tracker.offRouteSince).toBeNull();
  });
});

describe('arrival', () => {
  const p = prepareRoute(L_ROUTE, L_DEST);

  it('needs to be close AND slow, then sticks', () => {
    const tracker: TrackerState = { ...startTracker({ originAt: T0 }), alongM: 960, at: T0 };
    const fast = trackProgress(p, tracker, fixAt(pointOn(p, 980).point, T0 + 1000, { speedMps: 12 }));
    expect(fast.progress.arrived).toBe(false);
    const far = trackProgress(p, tracker, fixAt(pointOn(p, 940).point, T0 + 1000, { speedMps: 1 }));
    expect(far.progress.arrived).toBe(false);
    const slow = trackProgress(p, fast.tracker, fixAt(pointOn(p, 985).point, T0 + 2000, { speedMps: ARRIVAL_MAX_SPEED_MPS - 0.5 }));
    expect(slow.progress.arrived).toBe(true);
    expect(slow.progress.remainingM).toBe(0);
    expect(slow.progress.next).toBeNull();
    const later = trackProgress(p, slow.tracker, fixAt(pointOn(p, 1000).point, T0 + 3000, { speedMps: 8 }));
    expect(later.progress.arrived).toBe(true);
  });

  it('counts the destination itself, even when the route ends on the road beside it', () => {
    const building = destinationPoint(L_DEST, 270, 22); // 22 m off the end of the route
    const q = prepareRoute(L_ROUTE, building);
    const tracker: TrackerState = { ...startTracker({ originAt: T0 }), alongM: 900, at: T0 };
    const parked = trackProgress(q, tracker, fixAt(destinationPoint(building, 90, 5), T0 + 1000, { speedMps: 0 }));
    expect(parked.progress.arrived).toBe(true);
  });

  it('crawling past the destination on the far side of a divided road, U-turn still ahead, is not arriving (regression)', () => {
    // East 300 m on the north carriageway, U-turn across a 25 m median, back west 150 m to the
    // destination on the south side. At 150 m along, the destination is 25 m away, and the car
    // crawls in traffic — but 325 m of route are still to go.
    const divided = makeRoute([
      [90, 300],
      [180, 25],
      [270, 150],
    ]);
    const dest = divided.line[divided.line.length - 1];
    const dp = prepareRoute(divided, dest);
    const tracker: TrackerState = { ...startTracker({ originAt: T0 }), alongM: 148, at: T0 };
    const passing = trackProgress(dp, tracker, fixAt(pointOn(dp, 150).point, T0 + 1000, { speedMps: 1.5, headingDeg: 90 }));
    expect(passing.progress.alongM).toBeCloseTo(150, -1);
    expect(haversineM(pointOn(dp, 150).point, dest)).toBeLessThan(30);
    expect(passing.progress.offRoute).toBe(false);
    expect(passing.progress.arrived).toBe(false);
    // Driving on round the U-turn and back: arrives at the end as usual.
    const fixes = [];
    for (let s = 1; s <= 33; s++) fixes.push(fixAt(pointOn(dp, 150 + s * 10).point, T0 + (1 + s) * 1000, { speedMps: s < 30 ? 10 : 2 }));
    const { progress } = run(dp, fixes, passing.tracker);
    expect(progress[progress.length - 1].arrived).toBe(true);
  });

  it('off the route, reaching the destination your own way still counts', () => {
    const tracker: TrackerState = { ...startTracker({ originAt: T0 }), alongM: 300, at: T0, lastPoint: pointOn(p, 300).point };
    // 60 m west of the route's end, i.e. well off the line, next to the destination.
    const building = destinationPoint(L_DEST, 270, 60);
    const q = prepareRoute(L_ROUTE, building);
    const r = trackProgress(q, tracker, fixAt(destinationPoint(building, 0, 8), T0 + 1000, { speedMps: 0 }));
    expect(r.progress.offRoute).toBe(true);
    expect(r.progress.arrived).toBe(true);
  });

  it('stops tracking time and distance at a full stop on arrival', () => {
    const fixes = [];
    for (let s = 1; s <= 100; s++) {
      const v = s < 94 ? SPEED : Math.max(0, SPEED - (s - 93) * 2.5);
      fixes.push(fixAt(pointOn(p, Math.min(995, s * SPEED)).point, T0 + s * 1000, { speedMps: v }));
    }
    const { progress } = run(p, fixes);
    const first = progress.findIndex((q) => q.arrived);
    expect(first).toBeGreaterThan(90);
    expect(progress.slice(first).every((q) => q.arrived)).toBe(true);
  });
});

describe('reroute policy', () => {
  const off = (ms: number) => ({ offRouteForMs: ms, onRouteForMs: 0, arrived: false });

  it('reroutes only after the off-route time', () => {
    expect(decideReroute(INITIAL_REROUTE_POLICY, off(OFF_ROUTE_TIME_MS - 1), T0, true).reroute).toBe(false);
    const r = decideReroute(INITIAL_REROUTE_POLICY, off(OFF_ROUTE_TIME_MS), T0, true);
    expect(r.reroute).toBe(true);
    expect(r.policy).toEqual({ lastAt: T0, streak: 1 });
  });

  it('never reroutes while a request is in flight or after arrival', () => {
    expect(decideReroute(INITIAL_REROUTE_POLICY, off(60_000), T0, false).reroute).toBe(false);
    expect(decideReroute(INITIAL_REROUTE_POLICY, { ...off(60_000), arrived: true }, T0, true).reroute).toBe(false);
  });

  it('spaces reroutes out and backs off while they do not help (bad signal cannot spam the API)', () => {
    expect(rerouteIntervalMs(1)).toBe(REROUTE_MIN_INTERVAL_MS);
    expect(rerouteIntervalMs(2)).toBe(2 * REROUTE_MIN_INTERVAL_MS);
    expect(rerouteIntervalMs(10)).toBe(REROUTE_MAX_INTERVAL_MS);

    // Permanently "off-route" for an hour: count the reroutes.
    let policy: ReroutePolicy = INITIAL_REROUTE_POLICY;
    let count = 0;
    for (let t = 0; t < 3_600_000; t += 1000) {
      const r = decideReroute(policy, off(60_000), T0 + t, true);
      policy = r.policy;
      if (r.reroute) count++;
    }
    expect(count).toBeLessThanOrEqual(3_600_000 / REROUTE_MAX_INTERVAL_MS + 4);
    expect(count).toBeGreaterThan(20);
  });

  it('resets the back-off after a while back on the route', () => {
    const policy: ReroutePolicy = { lastAt: T0, streak: 4 };
    const settled = decideReroute(policy, { offRouteForMs: 0, onRouteForMs: REROUTE_BACKOFF_RESET_MS, arrived: false }, T0 + 40_000, true);
    expect(settled.reroute).toBe(false);
    expect(settled.policy.streak).toBe(0);
    // Off again: the short interval applies again.
    expect(decideReroute(settled.policy, off(OFF_ROUTE_TIME_MS), T0 + 40_000, true).reroute).toBe(true);
  });
});
