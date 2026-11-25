/**
 * T28 Route progress — pure functions, no React, no map, no clock (time comes from fix
 * timestamps). Fed ~1 Hz from `telemetry` fixes by the nav engine, never from the 60 Hz pose.
 *
 *   prepareRoute(route, destination)   once per route: cumulative lengths, where each
 *                                      maneuver sits along the line, durations, mercator
 *                                      lengths for the map's line-trim.
 *   startTracker(route)                tracking state for a fresh route.
 *   trackProgress(prepared, tracker, fix) → { tracker, progress } for each fix:
 *       snap to the route (`nearestPointOnLine`, per segment, inside a window around where
 *       we expect to be), distance/time remaining, current step, distance to the next
 *       maneuver, off-route timing, arrival.
 *   decideReroute(policy, …)           whether to bump `nav.rerouteNonce` now.
 *
 * WHY A WINDOW: a plain "nearest point on the whole line" jumps to whichever part of the
 * route is geometrically closest — on a U-shaped route (out along one side of a divided road,
 * back on the other; a hairpin) GPS noise would put you kilometres ahead. Only segments from
 * `SNAP_WINDOW_BACK_M` behind the last position to `SNAP_WINDOW_AHEAD_M` (+ twice the distance
 * the car could have covered since) ahead are considered, and candidates far from the expected
 * position (last + speed × dt) pay a penalty, so a close far leg inside the window still loses
 * to the leg we are actually on.
 *
 * OFF-ROUTE: further than `max(OFF_ROUTE_DISTANCE_M, fix accuracy)` from the line, or driving
 * against it (≥ 135° off, above ~9 mph). Progress freezes while off-route. Sustained for
 * `OFF_ROUTE_TIME_MS` → reroute, no sooner than `rerouteIntervalMs` after the previous one;
 * that interval doubles with each reroute that did not get us back on the route (15 s → 2 min),
 * so a bad signal cannot spam the Directions API.
 *
 * ARRIVAL: within `ARRIVAL_RADIUS_M` of the destination (or of the route's end — the routed
 * point can be on the road beside a building) and at or below `ARRIVAL_MAX_SPEED_MPS`. Sticky.
 */
import type { Route, RouteStep } from '../../api/directions';
import { angleDiffDeg, bearingDeg, cumulativeLengthsM, haversineM, mphToMps, nearestPointOnLine } from '../../lib';
import type { LngLat } from '../../types';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Further than this from the route line counts as off-route (or the fix accuracy, if worse), m. */
export const OFF_ROUTE_DISTANCE_M = 50;
/** Off-route for this long before rerouting, ms. */
export const OFF_ROUTE_TIME_MS = 5_000;
/** Heading this far from the route's direction counts as driving the wrong way, degrees. */
export const WRONG_WAY_ANGLE_DEG = 135;
/** …but only above this speed (headings are noisy when slow), m/s (≈ 9 mph). */
export const WRONG_WAY_MIN_SPEED_MPS = 4;
/** Shortest gap between two automatic reroutes, ms. */
export const REROUTE_MIN_INTERVAL_MS = 15_000;
/** Longest back-off between reroutes that do not get us back on the route, ms. */
export const REROUTE_MAX_INTERVAL_MS = 120_000;
/** On the route this long resets the reroute back-off, ms. */
export const REROUTE_BACKOFF_RESET_MS = 30_000;
/** Arrived within this distance of the destination (or the route's end), m. */
export const ARRIVAL_RADIUS_M = 30;
/** …at or below this speed, m/s (10 mph). */
export const ARRIVAL_MAX_SPEED_MPS = mphToMps(10);
/** Snap window behind the last position (GPS noise, a slight roll back), m. */
export const SNAP_WINDOW_BACK_M = 60;
/** Snap window ahead of the last position, plus twice the distance covered since, m. */
export const SNAP_WINDOW_AHEAD_M = 250;
/** Longest gap between fixes extrapolated with the last speed (tunnels), s. */
export const SNAP_MAX_GAP_S = 60;
/** Candidates this close to the expected along-position pay no penalty (+ half the distance covered), m. */
export const SNAP_ALONG_TOLERANCE_M = 30;
/** Penalty per metre of along-route error beyond the tolerance, in metres of lateral distance. */
export const SNAP_ALONG_PENALTY = 0.5;
/** A maneuver counts as done this far before reaching it (1 Hz fixes lag a little), m. */
export const MANEUVER_PASSED_M = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the tracker needs from a fix (a `Fix` plus the best speed/heading from telemetry). */
export interface ProgressFix {
  lng: number;
  lat: number;
  /** m/s (0 when unknown). */
  speedMps: number;
  /** degrees, `null` when unknown/stopped. */
  headingDeg: number | null;
  accuracyM: number;
  /** epoch ms */
  timestamp: number;
}

export interface PreparedRoute {
  line: LngLat[];
  /** Cumulative length at each vertex, m. */
  cum: number[];
  /** Line length, m. */
  lengthM: number;
  /** API metres per line metre (`route.distanceM / lengthM`, ≈ 1) — displayed distances match the API. */
  scale: number;
  /** Cumulative Web-Mercator length at each vertex (what Mapbox's `line-progress` measures). */
  mercCum: number[];
  steps: RouteStep[];
  /** Along-line position of each step's maneuver, m, non-decreasing. */
  maneuverAlongM: number[];
  /** Sum of the durations of the steps after step i, s. */
  durationAfterS: number[];
  durationS: number;
  /** Last point of the line (the routed end). */
  end: LngLat;
  /** The destination itself (may be off the road). */
  destination: LngLat;
}

export interface TrackerState {
  /** Last on-route position along the line, m. */
  alongM: number;
  /** Timestamp of the last fix (or the route's origin fix), epoch ms. */
  at: number | null;
  /** Position of the last fix (or the route's origin), `[lng, lat]`. */
  lastPoint: LngLat | null;
  offRouteSince: number | null;
  onRouteSince: number | null;
  arrived: boolean;
}

export interface NextManeuver {
  /** Step index of the maneuver. */
  index: number;
  /** Distance to it, m. */
  distanceM: number;
  step: RouteStep;
}

export interface Progress {
  /** Position along the line, m. */
  alongM: number;
  /** Distance from the fix to the route, m. */
  lateralM: number;
  /** Distance left to the end of the route, m. */
  remainingM: number;
  /** Time left, s (the route's traffic-aware step durations, pro rata within the current step). */
  remainingS: number;
  /** Index of the step being driven (its maneuver is behind us). */
  stepIndex: number;
  /** The upcoming maneuver (the arrival on the last step), or `null` past the end. */
  next: NextManeuver | null;
  /** Travelled fraction of the line in Web-Mercator length, [0, 1] — for `line-trim-offset`. */
  fraction: number;
  offRoute: boolean;
  /** How long we have been off-route, ms (0 when on it). */
  offRouteForMs: number;
  /** How long we have been on the route, ms (0 when off it). */
  onRouteForMs: number;
  arrived: boolean;
  /** Fix timestamp this progress is for, epoch ms. */
  at: number;
}

// ---------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;
const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin(Math.max(-85.051129, Math.min(85.051129, lat)) * RAD);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/** Cumulative planar Web-Mercator length at each vertex (Mapbox's `line-progress` metric). */
export function mercatorCumulative(line: readonly LngLat[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) total += Math.hypot(mercX(line[i][0]) - mercX(line[i - 1][0]), mercY(line[i][1]) - mercY(line[i - 1][1]));
    out.push(total);
  }
  return out;
}

/** Index of the last vertex with `cum[i] <= along` (0 for along below the start). */
function vertexAt(cum: readonly number[], along: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface Snap {
  point: LngLat;
  alongM: number;
  lateralM: number;
  segmentIndex: number;
}

/**
 * Nearest point on the segments overlapping `[loM, hiM]`, minimising
 * `lateral + SNAP_ALONG_PENALTY × max(0, |along − expected| − tolerance)`. `null` for an
 * empty line. Each segment is measured with `nearestPointOnLine`.
 */
export function snapInWindow(
  line: readonly LngLat[],
  cum: readonly number[],
  point: LngLat,
  expectedAlongM: number,
  loM: number,
  hiM: number,
  toleranceM: number,
): Snap | null {
  if (line.length === 0) return null;
  if (line.length === 1) return { point: line[0], alongM: 0, lateralM: haversineM(point, line[0]), segmentIndex: 0 };
  const last = line.length - 2;
  let i = Math.min(vertexAt(cum, Math.max(0, loM)), last);
  let best: Snap | null = null;
  let bestCost = Infinity;
  for (; i <= last && cum[i] <= hiM; i++) {
    const np = nearestPointOnLine([line[i], line[i + 1]], point, [cum[i], cum[i + 1]]);
    if (!np) continue;
    const cost = np.distanceM + SNAP_ALONG_PENALTY * Math.max(0, Math.abs(np.alongM - expectedAlongM) - toleranceM);
    if (cost < bestCost) {
      bestCost = cost;
      best = { point: np.point, alongM: np.alongM, lateralM: np.distanceM, segmentIndex: i };
    }
  }
  return best;
}

/** Precompute a route for tracking. `destination` is the chosen place (`[lng, lat]`). */
export function prepareRoute(route: Route, destination: LngLat): PreparedRoute {
  const line = route.line.length > 0 ? route.line : [destination];
  const cum = cumulativeLengthsM(line);
  const lengthM = cum[cum.length - 1] ?? 0;
  const steps = route.steps;

  // Where each maneuver sits along the line: in order, snapped near where the API's step
  // distances say it should be (robust to U-shapes and to overview ≠ concatenated steps).
  const apiStepsTotal = steps.reduce((sum, s) => sum + s.distanceM, 0);
  const k = apiStepsTotal > 0 ? lengthM / apiStepsTotal : 1;
  const maneuverAlongM: number[] = [];
  let apiAlong = 0;
  for (let i = 0; i < steps.length; i++) {
    if (i === 0) {
      maneuverAlongM.push(0);
      continue;
    }
    apiAlong += steps[i - 1].distanceM;
    const prev = maneuverAlongM[i - 1];
    const expected = Math.max(prev, apiAlong * k);
    const snap = snapInWindow(line, cum, steps[i].maneuver.location, expected, prev - 1, expected + 300, 20);
    const along = Math.min(lengthM, Math.max(prev, snap ? snap.alongM : expected));
    maneuverAlongM.push(steps[i].maneuver.type === 'arrive' && i === steps.length - 1 ? Math.max(along, lengthM) : along);
  }

  const durationAfterS: number[] = new Array(steps.length).fill(0);
  for (let i = steps.length - 2; i >= 0; i--) durationAfterS[i] = durationAfterS[i + 1] + steps[i + 1].durationS;

  return {
    line,
    cum,
    lengthM,
    scale: lengthM > 0 && route.distanceM > 0 ? route.distanceM / lengthM : 1,
    mercCum: mercatorCumulative(line),
    steps,
    maneuverAlongM,
    durationAfterS,
    durationS: route.durationS,
    end: line[line.length - 1],
    destination,
  };
}

/** Travelled fraction of the line by Web-Mercator length for an along-line position. */
export function mercatorFraction(p: Pick<PreparedRoute, 'cum' | 'mercCum' | 'lengthM'>, alongM: number): number {
  const total = p.mercCum[p.mercCum.length - 1] ?? 0;
  if (!(total > 0) || !(p.lengthM > 0)) return alongM > 0 ? 1 : 0;
  const a = Math.max(0, Math.min(p.lengthM, alongM));
  const i = Math.min(vertexAt(p.cum, a), p.cum.length - 2);
  const seg = p.cum[i + 1] - p.cum[i];
  const t = seg > 0 ? (a - p.cum[i]) / seg : 0;
  return Math.max(0, Math.min(1, (p.mercCum[i] + t * (p.mercCum[i + 1] - p.mercCum[i])) / total));
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

/** Tracking state for a fresh route, starting at its origin fix. */
export function startTracker(route: { originAt: number | null; origin?: LngLat | null }): TrackerState {
  return { alongM: 0, at: route.originAt, lastPoint: route.origin ?? null, offRouteSince: null, onRouteSince: null, arrived: false };
}

/** Remaining time from `alongM` on step `stepIndex`, s. */
function remainingSeconds(p: PreparedRoute, stepIndex: number, alongM: number): number {
  if (p.steps.length === 0) return p.lengthM > 0 ? p.durationS * Math.max(0, 1 - alongM / p.lengthM) : 0;
  const i = stepIndex;
  const start = p.maneuverAlongM[i];
  const end = i + 1 < p.steps.length ? p.maneuverAlongM[i + 1] : p.lengthM;
  const len = end - start;
  const left = len > 0 ? Math.max(0, Math.min(1, (end - alongM) / len)) : 0;
  return left * p.steps[i].durationS + p.durationAfterS[i];
}

/** One fix → updated tracker state and the progress to show. */
export function trackProgress(
  p: PreparedRoute,
  tracker: TrackerState,
  fix: ProgressFix,
): { tracker: TrackerState; progress: Progress } {
  const point: LngLat = [fix.lng, fix.lat];
  const speed = Number.isFinite(fix.speedMps) && fix.speedMps > 0 ? fix.speedMps : 0;
  const dtS = tracker.at === null ? 0 : Math.max(0, Math.min(SNAP_MAX_GAP_S, (fix.timestamp - tracker.at) / 1000));
  const travel = speed * dtS;
  const expected = tracker.alongM + travel;
  // The car covered at least the straight-line distance since the last fix, whatever the
  // (possibly stale or missing) speed says — widen the window by that too.
  const moved = tracker.lastPoint ? haversineM(tracker.lastPoint, point) : 0;
  const reach = Math.max(travel, moved);

  const snap =
    snapInWindow(
      p.line,
      p.cum,
      point,
      expected,
      tracker.alongM - SNAP_WINDOW_BACK_M,
      tracker.alongM + SNAP_WINDOW_AHEAD_M + 2 * reach,
      SNAP_ALONG_TOLERANCE_M + reach / 2,
    ) ?? { point, alongM: tracker.alongM, lateralM: 0, segmentIndex: 0 };

  // Off-route: too far from the line, or driving against it.
  const threshold = Math.max(OFF_ROUTE_DISTANCE_M, Number.isFinite(fix.accuracyM) ? fix.accuracyM : 0);
  let wrongWay = false;
  if (fix.headingDeg !== null && speed >= WRONG_WAY_MIN_SPEED_MPS && p.line.length > 1) {
    const i = Math.min(snap.segmentIndex, p.line.length - 2);
    if (haversineM(p.line[i], p.line[i + 1]) > 1) {
      wrongWay = Math.abs(angleDiffDeg(bearingDeg(p.line[i], p.line[i + 1]), fix.headingDeg)) >= WRONG_WAY_ANGLE_DEG;
    }
  }
  const offRoute = snap.lateralM > threshold || wrongWay;
  const alongM = offRoute ? tracker.alongM : Math.max(0, Math.min(p.lengthM, snap.alongM));
  const offRouteSince = offRoute ? (tracker.offRouteSince ?? fix.timestamp) : null;
  const onRouteSince = offRoute ? null : (tracker.onRouteSince ?? fix.timestamp);

  // Current step and the next maneuver.
  let stepIndex = 0;
  for (let i = 1; i < p.steps.length; i++) {
    if (p.maneuverAlongM[i] <= alongM + MANEUVER_PASSED_M) stepIndex = i;
    else break;
  }
  const nextIndex = stepIndex + 1;
  const next: NextManeuver | null =
    nextIndex < p.steps.length
      ? { index: nextIndex, distanceM: Math.max(0, p.maneuverAlongM[nextIndex] - alongM) * p.scale, step: p.steps[nextIndex] }
      : null;

  const remainingLineM = Math.max(0, p.lengthM - alongM);
  const toDestination = Math.min(haversineM(point, p.destination), haversineM(point, p.end));
  const near = toDestination <= ARRIVAL_RADIUS_M || (!offRoute && remainingLineM <= ARRIVAL_RADIUS_M);
  const arrived = tracker.arrived || (near && speed <= ARRIVAL_MAX_SPEED_MPS);

  const nextTracker: TrackerState = { alongM, at: fix.timestamp, lastPoint: point, offRouteSince, onRouteSince, arrived };
  const progress: Progress = {
    alongM,
    lateralM: snap.lateralM,
    remainingM: arrived ? 0 : remainingLineM * p.scale,
    remainingS: arrived ? 0 : remainingSeconds(p, stepIndex, alongM),
    stepIndex,
    next: arrived ? null : next,
    fraction: mercatorFraction(p, alongM),
    offRoute,
    offRouteForMs: offRouteSince === null ? 0 : fix.timestamp - offRouteSince,
    onRouteForMs: onRouteSince === null ? 0 : fix.timestamp - onRouteSince,
    arrived,
    at: fix.timestamp,
  };
  return { tracker: nextTracker, progress };
}

/** Progress for a route nobody has driven yet (before the first fix arrives). */
export function initialProgress(p: PreparedRoute, at: number): Progress {
  const next = p.steps.length > 1 ? { index: 1, distanceM: p.maneuverAlongM[1] * p.scale, step: p.steps[1] } : null;
  return {
    alongM: 0,
    lateralM: 0,
    remainingM: p.lengthM * p.scale,
    remainingS: remainingSeconds(p, 0, 0),
    stepIndex: 0,
    next,
    fraction: 0,
    offRoute: false,
    offRouteForMs: 0,
    onRouteForMs: 0,
    arrived: false,
    at,
  };
}

// ---------------------------------------------------------------------------
// Reroute policy
// ---------------------------------------------------------------------------

export interface ReroutePolicy {
  /** Time of the last automatic reroute, epoch ms. */
  lastAt: number | null;
  /** Reroutes since we were last settled on a route. */
  streak: number;
}

export const INITIAL_REROUTE_POLICY: ReroutePolicy = { lastAt: null, streak: 0 };

/** Minimum gap after the `streak`-th consecutive reroute: 15 s, 15 s, 30 s, 60 s, 120 s, 120 s … */
export function rerouteIntervalMs(streak: number): number {
  return Math.min(REROUTE_MAX_INTERVAL_MS, REROUTE_MIN_INTERVAL_MS * 2 ** Math.max(0, streak - 1));
}

/**
 * Should we reroute now? `canReroute` is false while a route request is in flight or the line
 * on screen is a placeholder, after arrival, or without a fresh fix.
 */
export function decideReroute(
  policy: ReroutePolicy,
  progress: Pick<Progress, 'offRouteForMs' | 'onRouteForMs' | 'arrived'>,
  now: number,
  canReroute: boolean,
): { reroute: boolean; policy: ReroutePolicy } {
  let next = policy;
  if (policy.streak > 0 && progress.onRouteForMs >= REROUTE_BACKOFF_RESET_MS) next = { ...policy, streak: 0 };
  if (!canReroute || progress.arrived || progress.offRouteForMs < OFF_ROUTE_TIME_MS) return { reroute: false, policy: next };
  if (next.lastAt !== null && now - next.lastAt < rerouteIntervalMs(next.streak)) return { reroute: false, policy: next };
  return { reroute: true, policy: { lastAt: now, streak: next.streak + 1 } };
}
