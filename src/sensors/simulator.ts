/**
 * T11 — Simulator / demo mode: a believable drive around downtown San Francisco that feeds
 * the SAME fix pipeline as the GPS (`ingestFix`, ~1 Hz, `telemetry.source = 'sim'`), so the
 * motion loop, map, speedometer and trip behave exactly as on a real drive.
 *
 * Route: a fixed loop of waypoints (Embarcadero → Bay St → Van Ness → California St →
 * back to the Ferry Building). With a Mapbox token the Directions API is asked ONCE per
 * session for a driving route through them, so the car follows real streets; without a
 * token, or if that fails, the car drives straight between denser corner waypoints.
 * (This fetch is deliberately self-contained; the real directions module comes later.)
 *
 * Driving model (pure, deterministic for a given seed — see `advanceSim`):
 *   - cruise speed wanders between 25 and 45 mph along the route (smooth value noise);
 *   - corners are found from the route geometry and taken slowly (sharper = slower);
 *   - some sharp corners and some "traffic lights" on long straights are stops, held for
 *     3–9 s; which ones changes every lap;
 *   - acceleration and braking are limited, and braking is planned ahead;
 *   - it loops forever.
 */
import { MAPBOX_TOKEN, fetchJson, hasMapboxToken } from '../api/client';
import { angleDiffDeg, bearingDeg, cumulativeLengthsM, destinationPoint, haversineM, mphToMps, nearestPointOnLine } from '../lib';
import type { Fix, LngLat } from '../types';
import { browserDocument, browserTimers, onVisibilityChange, type DocLike, type Timers } from './env';
import { ingestFix, resetForSource } from './geolocation';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** One simulated fix per second, like an iPhone GPS. */
export const SIM_FIX_INTERVAL_MS = 1_000;
/** Physics sub-step, s. */
export const SIM_STEP_S = 0.1;
/** Longest gap simulated in one tick (the drive pauses while the app is in the background), s. */
export const SIM_MAX_TICK_S = 2;
/** Cruise speed range. */
export const SIM_MIN_CRUISE_MPS = mphToMps(25);
export const SIM_MAX_CRUISE_MPS = mphToMps(45);
/** Distance between cruise-speed knots (a new target speed every few blocks), m. */
export const SIM_CRUISE_KNOT_M = 500;
/** Maximum acceleration, m/s² (0–30 mph in ≈ 7 s). */
export const SIM_MAX_ACCEL_MPS2 = 2;
/** Deceleration used to plan braking for corners and stops, m/s². */
export const SIM_PLAN_DECEL_MPS2 = 2;
/** Hardest braking the model will use, m/s². */
export const SIM_MAX_DECEL_MPS2 = 3.5;
/** How far ahead corners and stops are considered, m. */
export const SIM_LOOKAHEAD_M = 200;
/** Half-window over which a corner's turn angle is measured, m. */
export const SIM_CORNER_WINDOW_M = 12;
/** Turns gentler than this need no slowing, degrees. */
export const SIM_CORNER_MIN_TURN_DEG = 20;
/** Corner candidates closer than this are one corner, m. */
export const SIM_CORNER_MERGE_M = 25;
/** Speed through a 90° corner, m/s (≈ 11 mph). */
export const SIM_RIGHT_ANGLE_SPEED_MPS = 5;
/** Speed through a hairpin / U-turn (≥ 135°), m/s. */
export const SIM_HAIRPIN_SPEED_MPS = 4;
/** Corners at least this sharp may be a stop, degrees. */
export const SIM_STOP_TURN_DEG = 60;
/** Chance per lap that a sharp corner is a stop. */
export const SIM_CORNER_STOP_CHANCE = 0.4;
/** The stop line sits this far before the corner, m. */
export const SIM_STOP_LINE_OFFSET_M = 6;
/** A "traffic light" every this many metres on long straights, m. */
export const SIM_LIGHT_SPACING_M = 450;
/** Chance per lap that such a light is red. */
export const SIM_LIGHT_STOP_CHANCE = 0.3;
/** Stop duration range, s. */
export const SIM_STOP_MIN_S = 3;
export const SIM_STOP_MAX_S = 9;
/** Parked at the start for this long before pulling away, s. */
export const SIM_START_HOLD_S = 2;
/** Reported horizontal accuracy: base + up to `SIM_ACCURACY_NOISE_M` of noise, m. */
export const SIM_ACCURACY_BASE_M = 4;
export const SIM_ACCURACY_NOISE_M = 5;
/** Below this the simulated GPS reports no heading, as iOS does when stationary, m/s. */
export const SIM_HEADING_MIN_SPEED_MPS = 0.3;
/** Default seed for the deterministic drive. */
export const SIM_SEED = 1906;
/** Directions request timeout, ms. */
export const SIM_DIRECTIONS_TIMEOUT_MS = 6_000;

// ---------------------------------------------------------------------------
// The loop (OpenStreetMap intersection nodes; on the correct carriageway of divided roads)
// ---------------------------------------------------------------------------

/** Waypoints sent to the Directions API, in driving order (the loop closes back to the first). */
export const SIM_WAYPOINTS: readonly LngLat[] = [
  [-122.395336, 37.796768], // The Embarcadero (northbound) at Washington St — by the Ferry Building
  [-122.399036, 37.800976], // The Embarcadero (northbound) at Green St — Exploratorium
  [-122.417163, 37.805185], // Bay St at Columbus Ave
  [-122.423534, 37.795732], // Van Ness Ave (southbound) at Broadway
  [-122.409235, 37.792044], // California St at Powell St — top of Nob Hill
  [-122.39648, 37.793664], // California St at Drumm St
];

/** Straight-line fallback: the same loop with every corner, so straight segments follow streets. */
export const SIM_FALLBACK_LOOP: readonly LngLat[] = [
  [-122.395336, 37.796768], // The Embarcadero at Washington St
  [-122.399036, 37.800976], // The Embarcadero at Green St
  [-122.405631, 37.80669], // The Embarcadero at Bay St
  [-122.417163, 37.805185], // Bay St at Columbus Ave
  [-122.425202, 37.804142], // Van Ness Ave at Bay St
  [-122.423534, 37.795732], // Van Ness Ave at Broadway
  [-122.42242, 37.790326], // Van Ness Ave at California St
  [-122.409235, 37.792044], // California St at Powell St
  [-122.404426, 37.792656], // California St at Kearny St
  [-122.39648, 37.793664], // California St at Drumm St
];

// ---------------------------------------------------------------------------
// Pure: route geometry
// ---------------------------------------------------------------------------

export interface SimCorner {
  /** Position of the corner along the loop, m. */
  alongM: number;
  /** Signed turn, degrees (positive = right). */
  turnDeg: number;
  /** Speed to take it at, m/s. */
  maxSpeedMps: number;
}

export interface SimStop {
  /** Stop line position along the loop, m. */
  alongM: number;
  /** Chance per lap that the car has to stop here. */
  chance: number;
}

export interface SimRoute {
  /** Closed polyline (`line[last]` equals `line[0]`), `[lng, lat]`. */
  line: LngLat[];
  /** Cumulative length at each vertex, m. */
  cum: number[];
  /** Loop length, m. */
  totalM: number;
  /** Speed-limiting corners, sorted by `alongM`. */
  corners: SimCorner[];
  /** Candidate stops, sorted by `alongM`. */
  stops: SimStop[];
  /**
   * Navigation hand-off only (`buildRouteSimRoute`): the car stops for good at this odometer
   * value instead of looping. Absent for the demo loop.
   */
  endM?: number;
}

/** Drop near-duplicate consecutive points and close the loop (last point = first). */
export function closeLoop(points: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const p of points) {
    if (out.length === 0 || haversineM(out[out.length - 1], p) >= 0.5) out.push([p[0], p[1]]);
  }
  if (out.length > 1 && haversineM(out[out.length - 1], out[0]) < 0.5) out.pop();
  if (out.length > 0) out.push([out[0][0], out[0][1]]);
  return out;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Point at `alongM` metres along the loop (wraps around), `[lng, lat]`. */
export function pointAlong(route: Pick<SimRoute, 'line' | 'cum' | 'totalM'>, alongM: number): LngLat {
  const { line, cum, totalM } = route;
  if (line.length === 1 || !(totalM > 0)) return line[0];
  const s = mod(alongM, totalM);
  // Last vertex with cum <= s.
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const i = Math.min(lo, line.length - 2);
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (s - cum[i]) / seg : 0;
  const a = line[i];
  const b = line[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Direction of travel at `alongM`, degrees (measured over ±3 m so corners turn smoothly). */
export function headingAlong(route: Pick<SimRoute, 'line' | 'cum' | 'totalM'>, alongM: number): number {
  return bearingDeg(pointAlong(route, alongM - 3), pointAlong(route, alongM + 3));
}

/** Speed for a corner turning `turnDeg` degrees (either way), m/s; `Infinity` for gentle bends. */
export function cornerSpeedMps(turnDeg: number): number {
  const t = Math.abs(turnDeg);
  if (t <= SIM_CORNER_MIN_TURN_DEG) return Infinity;
  if (t >= 135) return SIM_HAIRPIN_SPEED_MPS;
  if (t >= 90) return SIM_RIGHT_ANGLE_SPEED_MPS;
  const k = (90 - t) / (90 - SIM_CORNER_MIN_TURN_DEG); // 1 at the gentlest, 0 at 90°
  return SIM_RIGHT_ANGLE_SPEED_MPS + (SIM_MAX_CRUISE_MPS - SIM_RIGHT_ANGLE_SPEED_MPS) * k * k;
}

/** Precompute everything the drive needs from a loop of points (at least two distinct points). */
export function buildSimRoute(points: readonly LngLat[]): SimRoute {
  const line = closeLoop(points);
  if (line.length < 3) throw new Error('simulator route needs at least two distinct points');
  const cum = cumulativeLengthsM(line);
  const totalM = cum[cum.length - 1];
  const base = { line, cum, totalM };

  // Corner candidates: turn measured over a ±window around each vertex, merged per corner.
  const corners: SimCorner[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const s = cum[i];
    const turn = angleDiffDeg(
      bearingDeg(pointAlong(base, s - SIM_CORNER_WINDOW_M), line[i]),
      bearingDeg(line[i], pointAlong(base, s + SIM_CORNER_WINDOW_M)),
    );
    if (Math.abs(turn) <= SIM_CORNER_MIN_TURN_DEG) continue;
    const last = corners[corners.length - 1];
    if (last && s - last.alongM <= SIM_CORNER_MERGE_M) {
      if (Math.abs(turn) > Math.abs(last.turnDeg)) {
        last.alongM = s;
        last.turnDeg = turn;
        last.maxSpeedMps = cornerSpeedMps(turn);
      }
      continue;
    }
    corners.push({ alongM: s, turnDeg: turn, maxSpeedMps: cornerSpeedMps(turn) });
  }
  // A corner just before the end of the loop and one at its start are the same corner.
  if (corners.length > 1) {
    const first = corners[0];
    const last = corners[corners.length - 1];
    if (first.alongM + totalM - last.alongM <= SIM_CORNER_MERGE_M) {
      if (Math.abs(last.turnDeg) > Math.abs(first.turnDeg)) corners.shift();
      else corners.pop();
    }
  }

  // Stops: sharp corners, plus "lights" spread along long straights.
  const stops: SimStop[] = corners
    .filter((c) => Math.abs(c.turnDeg) >= SIM_STOP_TURN_DEG)
    .map((c) => ({ alongM: mod(c.alongM - SIM_STOP_LINE_OFFSET_M, totalM), chance: SIM_CORNER_STOP_CHANCE }));
  const nearCorner = (s: number) =>
    corners.some((c) => {
      const d = Math.abs(c.alongM - s);
      return Math.min(d, totalM - d) < SIM_LIGHT_SPACING_M / 3;
    });
  for (let s = SIM_LIGHT_SPACING_M; s < totalM - SIM_LIGHT_SPACING_M / 3; s += SIM_LIGHT_SPACING_M) {
    if (!nearCorner(s)) stops.push({ alongM: s, chance: SIM_LIGHT_STOP_CHANCE });
  }
  stops.sort((a, b) => a.alongM - b.alongM);

  return { line, cum, totalM, corners, stops };
}

// ---------------------------------------------------------------------------
// Pure: deterministic randomness and the speed profile
// ---------------------------------------------------------------------------

/** Deterministic hash of integers → [0, 1). */
export function hash01(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h ^= h >>> 15;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

/** Cruise speed the driver wants at odometer `odoM` (smooth, between 25 and 45 mph), m/s. */
export function cruiseSpeedMps(odoM: number, seed: number = SIM_SEED): number {
  const x = Math.max(0, odoM) / SIM_CRUISE_KNOT_M;
  const k = Math.floor(x);
  const f = x - k;
  const a = hash01(seed, 1, k);
  const b = hash01(seed, 1, k + 1);
  const s = f * f * (3 - 2 * f);
  return SIM_MIN_CRUISE_MPS + (SIM_MAX_CRUISE_MPS - SIM_MIN_CRUISE_MPS) * (a + (b - a) * s);
}

/** How long the car stops at candidate `stopIndex` on lap `lap`, s (0 = no stop this lap). */
export function stopDurationS(seed: number, lap: number, stopIndex: number, chance: number): number {
  if (hash01(seed, 2, lap, stopIndex) >= chance) return 0;
  return SIM_STOP_MIN_S + (SIM_STOP_MAX_S - SIM_STOP_MIN_S) * hash01(seed, 3, lap, stopIndex);
}

export interface SimState {
  /** Total distance driven, m (monotonic; position on the loop is `odoM mod totalM`). */
  odoM: number;
  /** Current speed, m/s. */
  speedMps: number;
  /** Remaining time stopped at a stop, s. */
  holdS: number;
  /** Odometer of the last stop served (so it is not served twice), m. */
  servedStopOdoM: number;
}

export const INITIAL_SIM_STATE: SimState = { odoM: 0, speedMps: 0, holdS: SIM_START_HOLD_S, servedStopOdoM: -1 };

interface Ahead {
  /** Highest speed that still allows braking for every corner/stop ahead, m/s. */
  limitMps: number;
  /** Next stop the car must make, if any within the lookahead. */
  stop: { odoM: number; durationS: number } | null;
}

/** Constraints within `SIM_LOOKAHEAD_M` of the car. */
export function lookAhead(route: SimRoute, state: SimState, seed: number = SIM_SEED): Ahead {
  const total = route.totalM;
  const pos = mod(state.odoM, total);
  const lapStart = state.odoM - pos;
  const lap = Math.round(lapStart / total);
  let limitMps = Infinity;
  let stop: Ahead['stop'] = null;
  const brakeLimit = (vEnd: number, d: number) => Math.sqrt(vEnd * vEnd + 2 * SIM_PLAN_DECEL_MPS2 * Math.max(0, d));

  for (let wrap = 0; wrap * total - pos <= SIM_LOOKAHEAD_M; wrap++) {
    for (const c of route.corners) {
      const d = c.alongM + wrap * total - pos;
      if (d < 0 || d > SIM_LOOKAHEAD_M) continue;
      limitMps = Math.min(limitMps, brakeLimit(c.maxSpeedMps, d));
    }
    for (let i = 0; i < route.stops.length; i++) {
      const d = route.stops[i].alongM + wrap * total - pos;
      if (d < -0.01 || d > SIM_LOOKAHEAD_M) continue;
      const odoM = lapStart + wrap * total + route.stops[i].alongM;
      if (odoM <= state.servedStopOdoM + 0.01) continue;
      const durationS = stopDurationS(seed, lap + wrap, i, route.stops[i].chance);
      if (durationS <= 0) continue;
      limitMps = Math.min(limitMps, brakeLimit(0, d));
      if (!stop || odoM < stop.odoM) stop = { odoM, durationS };
    }
  }
  // Navigation hand-off: a final stop at the end of the route, held forever.
  if (route.endM !== undefined) {
    const d = route.endM - state.odoM;
    if (d >= -0.01 && d <= SIM_LOOKAHEAD_M) {
      limitMps = Math.min(limitMps, brakeLimit(0, d));
      if (!stop || route.endM < stop.odoM) stop = { odoM: route.endM, durationS: Infinity };
    }
  }
  return { limitMps, stop };
}

function subStep(route: SimRoute, s: SimState, dt: number, seed: number): SimState {
  if (s.holdS > 0) return { ...s, speedMps: 0, holdS: Math.max(0, s.holdS - dt) };

  const ahead = lookAhead(route, s, seed);
  if (ahead.stop) {
    const d = ahead.stop.odoM - s.odoM;
    if (d <= Math.max(0.5, s.speedMps * dt) && s.speedMps <= 3) {
      return { odoM: ahead.stop.odoM, speedMps: 0, holdS: ahead.stop.durationS, servedStopOdoM: ahead.stop.odoM };
    }
  }

  const target = Math.min(cruiseSpeedMps(s.odoM, seed), ahead.limitMps);
  let v = s.speedMps;
  if (v < target) {
    const accel = Math.min(SIM_MAX_ACCEL_MPS2, Math.max(0.5, 0.8 * (target - v)));
    v = Math.min(target, v + accel * dt);
  } else {
    v = Math.max(target, v - SIM_MAX_DECEL_MPS2 * dt);
  }
  return { ...s, odoM: s.odoM + ((s.speedMps + v) / 2) * dt, speedMps: v };
}

/**
 * The pure progression function: the drive `dtS` seconds after `state` (integrated in
 * `SIM_STEP_S` sub-steps). Deterministic for a given route, state, dt and seed.
 */
export function advanceSim(state: SimState, route: SimRoute, dtS: number, seed: number = SIM_SEED): SimState {
  if (!(dtS > 0) || !(route.totalM > 0)) return state;
  const n = Math.max(1, Math.ceil(dtS / SIM_STEP_S - 1e-9));
  const h = dtS / n;
  let s = state;
  for (let i = 0; i < n; i++) s = subStep(route, s, h, seed);
  return s;
}

/**
 * The fix a GPS would report for `state`: position on the route, speed, heading along the
 * route (`null` when stopped, like iOS) and a mildly noisy accuracy (`noise01` in [0, 1)).
 */
export function simFix(state: SimState, route: SimRoute, timestamp: number, noise01: number): Fix {
  const [lng, lat] = pointAlong(route, state.odoM);
  const moving = state.speedMps >= SIM_HEADING_MIN_SPEED_MPS;
  const noise = Math.min(1, Math.max(0, Number.isFinite(noise01) ? noise01 : 0));
  return {
    lat,
    lng,
    speedMps: Math.round(state.speedMps * 100) / 100,
    headingDeg: moving ? headingAlong(route, state.odoM) : null,
    accuracyM: Math.round((SIM_ACCURACY_BASE_M + SIM_ACCURACY_NOISE_M * noise) * 10) / 10,
    timestamp,
  };
}

/** `?demo=1` (or `?demo=true`) in a query string. */
export function parseDemoParam(search: string): boolean {
  try {
    const value = new URLSearchParams(search).get('demo');
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Directions (one request per session, only with a token)
// ---------------------------------------------------------------------------

/** Mapbox Directions URL for a driving loop through `waypoints` (closed back to the first). */
export function directionsUrl(waypoints: readonly LngLat[], token: string): string {
  const coords = [...waypoints, waypoints[0]].map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const params = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    steps: 'false',
    alternatives: 'false',
    access_token: token,
  });
  return `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?${params.toString()}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The first route's line from a Directions response, or `null` if the response is unusable. */
export function parseDirectionsLine(json: unknown): LngLat[] | null {
  const routes = isRecord(json) ? json.routes : undefined;
  const route = Array.isArray(routes) ? (routes[0] as unknown) : undefined;
  const geometry = isRecord(route) ? route.geometry : undefined;
  const coords = isRecord(geometry) ? geometry.coordinates : undefined;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const line: LngLat[] = [];
  for (const c of coords as unknown[]) {
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    line.push([c[0], c[1]]);
  }
  return line;
}

export interface SimLineDeps {
  token?: string;
  fetcher?: (url: string, options: { signal?: AbortSignal }) => Promise<unknown>;
  timeoutMs?: number;
}

export interface SimLine {
  /** The polyline to drive, `[lng, lat]`. */
  line: LngLat[];
  /** `true` when it came from the Directions API (follows real streets). */
  routed: boolean;
}

const fallbackLine = (): SimLine => ({ line: SIM_FALLBACK_LOOP.map((p) => [p[0], p[1]] as LngLat), routed: false });

/**
 * The drive's polyline: a Directions route through `SIM_WAYPOINTS` when a token is
 * configured and the request succeeds, otherwise `SIM_FALLBACK_LOOP`. Never rejects.
 */
export async function loadSimLine(deps: SimLineDeps = {}): Promise<SimLine> {
  const token = deps.token ?? (hasMapboxToken ? MAPBOX_TOKEN : '');
  if (!token) return fallbackLine();
  const fetcher = deps.fetcher ?? ((url, options) => fetchJson<unknown>(url, options));
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = setTimeout(() => controller?.abort(), deps.timeoutMs ?? SIM_DIRECTIONS_TIMEOUT_MS);
  try {
    const url = directionsUrl(SIM_WAYPOINTS, token);
    const line = parseDirectionsLine(await fetcher(url, { signal: controller?.signal }));
    if (line && closeLoop(line).length >= 3) return { line, routed: true };
  } catch {
    // Offline, bad token, rate limited, timed out: drive the straight-line loop instead.
  } finally {
    clearTimeout(timer);
  }
  return fallbackLine();
}

let cachedLine: Promise<SimLine> | null = null;

/** `loadSimLine()` memoised for the session; a fallback result is not kept, so it is retried next time. */
function sessionLine(): Promise<LngLat[]> {
  if (!cachedLine) {
    const pending = loadSimLine();
    cachedLine = pending;
    void pending.then((result) => {
      if (!result.routed && cachedLine === pending) cachedLine = null;
    });
  }
  return cachedLine.then((result) => result.line);
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export interface SimulatorDeps {
  /** Wall clock, epoch ms (fix timestamps). Defaults to `Date.now`. */
  now?: () => number;
  timers?: Timers;
  /** Accuracy noise source, [0, 1). Defaults to `Math.random`. */
  random?: () => number;
  /** Route polyline loader. Defaults to the session-cached `loadSimLine`. */
  loadLine?: () => Promise<LngLat[]>;
  /** Defaults to `document` (a fix is emitted right away when the app comes back). */
  doc?: DocLike | null;
  seed?: number;
}

interface Sim {
  now: () => number;
  timers: Timers;
  random: () => number;
  seed: number;
  route: SimRoute | null;
  state: SimState;
  lastTickAt: number;
  timer: unknown;
  unlisten: () => void;
  /** The demo loop, kept aside while a navigation route is being driven (`simDriveRoute`). */
  loop: SimRoute | null;
  /** A navigation route handed over before the loop had loaded. */
  pendingNav: NavSimRoute | null;
}

let sim: Sim | null = null;

function emit(s: Sim): void {
  if (!s.route) return;
  const now = s.now();
  ingestFix(simFix(s.state, s.route, now, s.random()), now);
}

function tick(s: Sim): void {
  if (sim !== s || !s.route) return;
  const now = s.now();
  const dt = Math.min(SIM_MAX_TICK_S, Math.max(0, (now - s.lastTickAt) / 1000));
  s.lastTickAt = now;
  s.state = advanceSim(s.state, s.route, dt, s.seed);
  emit(s);
}

/**
 * Start the simulated drive: switches telemetry to source `sim` (status `requesting` until
 * the route is ready), then emits a fix every second. Idempotent.
 */
export function startSimulator(deps: SimulatorDeps = {}): void {
  if (sim) return;
  resetForSource('sim', 'requesting');
  const s: Sim = {
    now: deps.now ?? Date.now,
    timers: deps.timers ?? browserTimers,
    random: deps.random ?? Math.random,
    seed: deps.seed ?? SIM_SEED,
    route: null,
    state: INITIAL_SIM_STATE,
    lastTickAt: 0,
    timer: null,
    unlisten: () => {},
    loop: null,
    pendingNav: null,
  };
  sim = s;
  const load = deps.loadLine ?? sessionLine;
  let pending: Promise<LngLat[]>;
  try {
    pending = load();
  } catch {
    pending = Promise.resolve(SIM_FALLBACK_LOOP.map((p) => [p[0], p[1]] as LngLat));
  }
  pending
    .catch(() => SIM_FALLBACK_LOOP.map((p) => [p[0], p[1]] as LngLat))
    .then((line) => {
      if (sim !== s) return;
      try {
        s.route = buildSimRoute(line);
      } catch {
        s.route = buildSimRoute(SIM_FALLBACK_LOOP);
      }
      if (s.pendingNav) {
        const nav = s.pendingNav;
        s.pendingNav = null;
        s.loop = s.route;
        handOver(s, nav, nav.startM);
      }
      s.lastTickAt = s.now();
      emit(s);
      s.timer = s.timers.setInterval(() => tick(s), SIM_FIX_INTERVAL_MS);
      s.unlisten = onVisibilityChange(deps.doc === undefined ? browserDocument() : deps.doc, (visible) => {
        if (visible) tick(s);
      });
    });
}

/** Stop the simulated drive. Leaves telemetry as it is. Idempotent. */
export function stopSimulator(): void {
  const s = sim;
  if (!s) return;
  sim = null;
  s.unlisten();
  if (s.timer !== null) s.timers.clearInterval(s.timer);
}

/** `true` while the simulator is the running source. */
export function isSimulatorRunning(): boolean {
  return sim !== null;
}

// ---------------------------------------------------------------------------
// Navigation hand-off (demo mode): drive a navigation route, then back to the loop
// ---------------------------------------------------------------------------

/** A handed navigation route: `startM`/`endM` = odometer of its first/last point. */
export type NavSimRoute = SimRoute & { startM: number; endM: number };

/** Straight lead-in before and run-out after a handed route, so its ends never see loop artefacts, m. */
export const SIM_ROUTE_PAD_M = 60;
/** A handed route is joined where it passes the car within this distance, m (else at its start). */
export const SIM_ROUTE_JOIN_M = 100;
/** …searching this far along it (the route starts where the car was a moment ago), m. */
export const SIM_ROUTE_JOIN_SEARCH_M = 400;

/**
 * A `SimRoute` that drives an OPEN line once (a navigation route) and stops for good at its
 * end. The line gets straight pads before and after and is closed like the loop, so all the
 * loop maths (corners, stops, wrap-around) works unchanged; `startM`/`endM` are the odometer
 * values of the line's first and last points. Throws for fewer than two distinct points.
 */
export function buildRouteSimRoute(points: readonly LngLat[]): NavSimRoute {
  const pts: LngLat[] = [];
  for (const p of points) {
    if (pts.length === 0 || haversineM(pts[pts.length - 1], p) >= 0.5) pts.push([p[0], p[1]]);
  }
  if (pts.length < 2) throw new Error('route needs at least two distinct points');
  const n = pts.length;
  const leadIn = destinationPoint(pts[0], bearingDeg(pts[0], pts[1]) + 180, SIM_ROUTE_PAD_M);
  const runOut = destinationPoint(pts[n - 1], bearingDeg(pts[n - 2], pts[n - 1]), SIM_ROUTE_PAD_M);
  const route = buildSimRoute([leadIn, ...pts, runOut]);
  // Vertices: leadIn = 0, pts = 1…n (closeLoop dropped nothing: all are ≥ 0.5 m apart, pads are 60 m).
  const startM = route.cum[1];
  const endM = route.cum[n];
  return { ...route, startM, endM };
}

/** Odometer on `next` closest to `here`, searching `[fromM, toM]` (all of it when omitted). */
function joinOdo(next: SimRoute, here: LngLat, fromM = 0, toM = Infinity): { odoM: number; distanceM: number } {
  let i0 = 0;
  while (i0 < next.cum.length - 2 && next.cum[i0 + 1] <= fromM) i0++;
  let i1 = i0 + 1;
  while (i1 < next.cum.length - 1 && next.cum[i1] < toM) i1++;
  const np = nearestPointOnLine(next.line.slice(i0, i1 + 1), here, next.cum.slice(i0, i1 + 1));
  return np ? { odoM: np.alongM, distanceM: np.distanceM } : { odoM: fromM, distanceM: Infinity };
}

/**
 * Switch the running sim to `next`, continuing from where the car is (speed and any hold
 * kept). `startM` given → a navigation route, joined near its start; else the loop, joined
 * at its nearest point.
 */
function handOver(s: Sim, next: SimRoute, startM?: number): void {
  const current = s.route;
  if (!current) return;
  const here = pointAlong(current, s.state.odoM);
  let odoM: number;
  if (startM !== undefined && next.endM !== undefined) {
    const join = joinOdo(next, here, startM, startM + SIM_ROUTE_JOIN_SEARCH_M);
    odoM = join.distanceM <= SIM_ROUTE_JOIN_M ? Math.max(startM, Math.min(next.endM, join.odoM)) : startM;
  } else {
    odoM = joinOdo(next, here).odoM;
  }
  s.route = next;
  s.state = {
    odoM,
    speedMps: s.state.speedMps,
    // Waiting at the end of a previous route forever → pull away after the usual start pause.
    holdS: Number.isFinite(s.state.holdS) ? s.state.holdS : SIM_START_HOLD_S,
    servedStopOdoM: odoM,
  };
}

/**
 * DEMO MODE ONLY. Drive `line` (a navigation route, `[lng, lat]`) from the car's current
 * position — joining it where it passes the car, normally its first metres — and stop for
 * good at its end. Call again to switch routes (reroute, refresh); `simReleaseRoute()` goes
 * back to the loop. If the loop is still loading, the route is driven as soon as it is ready.
 * Returns `false` when the simulator is not running or the line has fewer than two distinct points.
 */
export function simDriveRoute(line: readonly LngLat[]): boolean {
  const s = sim;
  if (!s) return false;
  let next: NavSimRoute;
  try {
    next = buildRouteSimRoute(line);
  } catch {
    return false;
  }
  if (!s.route) {
    s.pendingNav = next;
    return true;
  }
  if (!s.loop) s.loop = s.route;
  handOver(s, next, next.startM);
  return true;
}

/**
 * Back to the demo loop after `simDriveRoute`, continuing from the nearest point of the loop
 * (a jump if the route took the car away from it). No-op when no route is being driven.
 */
export function simReleaseRoute(): void {
  const s = sim;
  if (!s) return;
  s.pendingNav = null;
  const loop = s.loop;
  if (!loop) return;
  s.loop = null;
  handOver(s, loop);
}

/** `true` while the simulator drives a navigation route rather than the loop. */
export function isSimDrivingRoute(): boolean {
  return sim !== null && (sim.loop !== null || sim.pendingNav !== null);
}
