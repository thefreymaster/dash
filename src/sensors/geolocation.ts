/**
 * T07 — Geolocation → `telemetry`.
 *
 * Two layers:
 *   1. Pure decision logic (unit-tested): normalising a raw position into a `Fix`, deriving
 *      speed/course when iOS leaves them out, ordering, stale detection, error → status.
 *   2. The fix pipeline (`ingestFix`, `ingestPositionError`, stale watch) that BOTH the
 *      GPS watcher below and the demo simulator feed, so everything downstream behaves the
 *      same whatever the source; plus the thin `watchPosition` driver.
 *
 * Telemetry is written once per fix (~1 Hz) and on status changes — never per frame.
 *
 * iOS notes
 *   - `coords.speed` / `coords.heading` are `null` (sometimes NaN or -1) when the fix comes
 *     from Wi-Fi/cell or the phone is stationary. Speed is then derived from consecutive
 *     fixes, but only when both are reasonably accurate, 0.5–5 s apart, and the car moved
 *     clearly further than the fixes' accuracy (otherwise it is GPS wander, not motion).
 *
 * Speed validity (`telemetry.speedKnown`)
 *   `true` only while the status is `tracking`, the latest fix is younger than
 *   `SPEED_STALE_AFTER_MS`, and the device or the position pair gave a usable speed. Whenever
 *   it is `false`, `telemetry.speedMps` is the placeholder 0 — never a remembered value.
 *   - The watch is suspended while the PWA is in the background and does not always come
 *     back by itself, so it is restarted on `visibilitychange` → visible.
 */
import { bearingDeg, haversineM, normalizeDeg, toLngLat } from '../lib';
import { telemetry } from '../state';
import type { Fix, GpsStatus, Telemetry } from '../types';
import { browserDocument, browserTimers, onVisibilityChange, safely, type DocLike, type Timers } from './env';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** No fix for this long while tracking → `stale`. */
export const STALE_AFTER_MS = 5_000;
/** No fix for this long → the speed is no longer known (`speedKnown` false), ms. Sooner than `stale`. */
export const SPEED_STALE_AFTER_MS = 3_000;
/** How often the stale watch looks at the clock. */
export const STALE_CHECK_INTERVAL_MS = 1_000;
/** Speeds below this are reported as 0 so the readout does not jitter at a red light, m/s (≈1.1 mph). */
export const STATIONARY_SPEED_MPS = 0.5;
/** Derive speed only from fix pairs at least this far apart in time, s. */
export const MIN_DERIVE_INTERVAL_S = 0.5;
/** …and at most this far apart (a longer gap averages over stops and turns), s. */
export const MAX_DERIVE_INTERVAL_S = 5;
/** Derive speed/course only when both fixes are at least this accurate, m. */
export const MAX_DERIVE_ACCURACY_M = 25;
/** A derived speed/course needs at least this much movement between the fixes, m. */
export const MIN_DERIVE_COURSE_DISTANCE_M = 2;
/**
 * Noise floor for deriving speed/course from positions: the displacement must exceed this
 * multiple of the WORSE of the two accuracies. Two fixes 12 m apart with 20 m accuracy are
 * one parked car, not 27 mph.
 */
export const DERIVE_NOISE_FACTOR = 1;
/** Derived speeds above this are treated as a position jump, not motion, m/s (≈200 mph). */
export const MAX_PLAUSIBLE_SPEED_MPS = 90;
/** Accuracy used when the device reports none, m. */
export const UNKNOWN_ACCURACY_M = 1_000;
/** A fix this much OLDER than the last one means the clock moved back — accept it, ms. */
export const CLOCK_JUMP_MS = 60_000;

/** `watchPosition` options: GPS-grade fixes, never a cached position, no timeout errors. */
export const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0 };

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/** Structural subset of `GeolocationPosition` (so tests can pass plain objects). */
export interface RawPosition {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number | null;
    heading: number | null;
  };
  timestamp: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Raw browser position → `Fix`, or `null` if the coordinates are unusable.
 * Missing/NaN/negative speed and heading become `null` (iOS uses -1 and NaN for "invalid");
 * a missing/invalid timestamp falls back to `now`.
 */
export function normalizeFix(raw: RawPosition, now: number): Fix | null {
  const c = raw?.coords;
  if (!c) return null;
  const { latitude: lat, longitude: lng } = c;
  if (!finite(lat) || !finite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat,
    lng,
    speedMps: finite(c.speed) && c.speed >= 0 ? c.speed : null,
    headingDeg: finite(c.heading) && c.heading >= 0 ? normalizeDeg(c.heading) : null,
    accuracyM: finite(c.accuracy) && c.accuracy >= 0 ? c.accuracy : UNKNOWN_ACCURACY_M,
    timestamp: finite(raw.timestamp) ? raw.timestamp : now,
  };
}

/**
 * Displacement prev → next in metres when the pair can be differenced: both accurate enough
 * (≤ 25 m), 0.5–5 s apart, and the car moved clearly beyond the measurement noise (more
 * than `DERIVE_NOISE_FACTOR` × the worse accuracy, and at least 2 m). Otherwise `null`:
 * the movement cannot be told apart from GPS wander.
 */
function clearDisplacementM(prev: Fix, next: Fix): number | null {
  const dt = (next.timestamp - prev.timestamp) / 1000;
  if (
    !(dt >= MIN_DERIVE_INTERVAL_S && dt <= MAX_DERIVE_INTERVAL_S) ||
    !(prev.accuracyM <= MAX_DERIVE_ACCURACY_M && next.accuracyM <= MAX_DERIVE_ACCURACY_M)
  ) {
    return null;
  }
  const d = haversineM(toLngLat(prev), toLngLat(next));
  const noise = Math.max(MIN_DERIVE_COURSE_DISTANCE_M, DERIVE_NOISE_FACTOR * Math.max(prev.accuracyM, next.accuracyM));
  return d > noise ? d : null;
}

/**
 * Speed from distance / time between two fixes, m/s — or `null` when the pair is too close
 * in time (< 0.5 s), too far apart (> 5 s), too inaccurate (> 25 m), implausibly fast, or
 * when the displacement is within the measurement noise (see `clearDisplacementM`).
 */
export function deriveSpeedMps(prev: Fix | null, next: Fix): number | null {
  if (!prev) return null;
  const d = clearDisplacementM(prev, next);
  if (d === null) return null;
  const speed = d / ((next.timestamp - prev.timestamp) / 1000);
  return speed <= MAX_PLAUSIBLE_SPEED_MPS ? speed : null;
}

/** Best speed and course for a new fix. */
export interface MotionEstimate {
  /** m/s, 0 below `STATIONARY_SPEED_MPS`; also 0 (a placeholder) when `speedKnown` is false. */
  speedMps: number;
  /** degrees [0, 360), `null` when stationary or unknown. */
  headingDeg: number | null;
  /** `false` when neither the device nor the position pair gives a usable speed. */
  speedKnown: boolean;
}

const UNKNOWN_MOTION: MotionEstimate = { speedMps: 0, headingDeg: null, speedKnown: false };

/**
 * Best current speed and course for `next`:
 *   speed  = device speed, else derived from `prev` (only when the movement clearly exceeds
 *            the GPS noise), else UNKNOWN (`speedKnown` false, never a guessed 0);
 *            clamped to 0 below 0.5 m/s.
 *   course = device heading, else the bearing prev → next under the same noise rule;
 *            always `null` when the speed is 0 or unknown (never spin at a stop).
 */
export function estimateMotion(prev: Fix | null, next: Fix): MotionEstimate {
  const derived = next.speedMps === null ? deriveSpeedMps(prev, next) : null;
  if (next.speedMps === null && derived === null) return UNKNOWN_MOTION;
  let speed = next.speedMps ?? derived ?? 0;
  if (!(speed >= STATIONARY_SPEED_MPS)) speed = 0;
  if (speed === 0) return { speedMps: 0, headingDeg: null, speedKnown: true };

  if (next.headingDeg !== null) return { speedMps: speed, headingDeg: next.headingDeg, speedKnown: true };
  if (prev && clearDisplacementM(prev, next) !== null) {
    return { speedMps: speed, headingDeg: bearingDeg(toLngLat(prev), toLngLat(next)), speedKnown: true };
  }
  return { speedMps: speed, headingDeg: null, speedKnown: true };
}

/**
 * `next` should replace `prev`: strictly newer, or so much older that the device clock must
 * have been set back (otherwise a backwards clock would freeze tracking forever).
 * Duplicates and re-delivered cached positions are rejected.
 */
export function isNewerFix(prev: Fix | null, next: Fix): boolean {
  if (!prev) return true;
  if (next.timestamp > prev.timestamp) return true;
  return prev.timestamp - next.timestamp > CLOCK_JUMP_MS;
}

/**
 * Telemetry after accepting `fix` (status → `tracking`, speed/course re-estimated against
 * the previous fix). Returns `t` itself when the fix is not newer.
 */
export function applyFix(t: Telemetry, fix: Fix): Telemetry {
  if (!isNewerFix(t.fix, fix)) return t;
  const { speedMps, headingDeg, speedKnown } = estimateMotion(t.fix, fix);
  return { ...t, status: 'tracking', fix, speedMps, headingDeg, speedKnown };
}

/** `tracking` → `stale` once no fix has been received for `STALE_AFTER_MS`. Other statuses pass through. */
export function staleStatus(status: GpsStatus, lastFixAt: number | null, now: number): GpsStatus {
  if (status === 'tracking' && lastFixAt !== null && now - lastFixAt >= STALE_AFTER_MS) return 'stale';
  return status;
}

/** `t` with a new status; leaving `tracking` also drops the speed (`speedKnown` false, `speedMps` 0). */
function withStatus(t: Telemetry, status: GpsStatus): Telemetry {
  if (status === 'tracking') return status === t.status ? t : { ...t, status };
  if (status === t.status && !t.speedKnown) return t;
  return { ...t, status, speedKnown: false, speedMps: 0 };
}

/**
 * Telemetry `now`, given the receipt time of the last fix: the speed expires after
 * `SPEED_STALE_AFTER_MS` without a fix (`speedKnown` false, `speedMps` 0), the status goes
 * `stale` after `STALE_AFTER_MS`. Returns `t` itself when nothing changes. Without a known
 * receipt time (`lastFixAt` null) nothing expires.
 */
export function expireTelemetry(t: Telemetry, lastFixAt: number | null, now: number): Telemetry {
  const next = withStatus(t, staleStatus(t.status, lastFixAt, now));
  if (next.speedKnown && lastFixAt !== null && now - lastFixAt >= SPEED_STALE_AFTER_MS) {
    return { ...next, speedKnown: false, speedMps: 0 };
  }
  return next;
}

/** `GeolocationPositionError.code` values (constants are not available in node tests). */
export const PERMISSION_DENIED = 1;
export const POSITION_UNAVAILABLE = 2;
export const TIMEOUT = 3;

/**
 * Status after a position error. `hadFix`: at least one fix was received from this source.
 *   1 PERMISSION_DENIED    → `denied`
 *   2 POSITION_UNAVAILABLE → `stale` if we had fixes (signal lost), else `unavailable`
 *   3 TIMEOUT              → `stale` if we had fixes, else keep waiting (`requesting`)
 *   anything else          → current status
 */
export function statusForError(code: number, hadFix: boolean, current: GpsStatus): GpsStatus {
  switch (code) {
    case PERMISSION_DENIED:
      return 'denied';
    case POSITION_UNAVAILABLE:
      return hadFix ? 'stale' : 'unavailable';
    case TIMEOUT:
      return hadFix ? 'stale' : 'requesting';
    default:
      return current;
  }
}

// ---------------------------------------------------------------------------
// Fix pipeline (shared by the GPS watcher and the simulator)
// ---------------------------------------------------------------------------

/** Receipt time (`Date.now()`) of the last accepted fix, for stale detection. */
let lastFixAt: number | null = null;
let staleTimer: unknown = null;
let staleTimers: Timers = browserTimers;

/**
 * Feed one fix into telemetry (status, fix, best speed and course). Returns `false` if it
 * was ignored (duplicate / older than the current fix).
 */
export function ingestFix(fix: Fix, now: number = Date.now()): boolean {
  const prev = telemetry.get();
  const next = applyFix(prev, fix);
  if (next === prev) return false;
  lastFixAt = now;
  telemetry.set(next);
  return true;
}

/** Feed a position error code into `telemetry.status`. */
export function ingestPositionError(code: number): void {
  telemetry.set((t) => withStatus(t, statusForError(code, t.fix !== null, t.status)));
}

/**
 * Switch telemetry to a new source: forget the old fix (the next fix is a fresh start, so
 * trip/motion consumers do not see a jump between sources) and wait for the first fix.
 * The compass reading is kept — it does not depend on the position source.
 */
export function resetForSource(source: Telemetry['source'], status: GpsStatus = 'requesting'): void {
  lastFixAt = null;
  telemetry.set((t) => ({ ...t, source, status, fix: null, speedMps: 0, speedKnown: false, headingDeg: null }));
}

/** Re-check staleness now (exported for tests; the stale watch calls it every second). */
export function checkStale(now: number = Date.now()): void {
  const t = telemetry.get();
  const next = expireTelemetry(t, lastFixAt, now);
  if (next !== t) telemetry.set(next);
}

/** Start the 1 s stale watch. Idempotent. */
export function startStaleWatch(timers: Timers = browserTimers): void {
  if (staleTimer !== null) return;
  staleTimers = timers;
  staleTimer = timers.setInterval(() => checkStale(), STALE_CHECK_INTERVAL_MS);
}

/** Stop the stale watch. Idempotent. */
export function stopStaleWatch(): void {
  if (staleTimer === null) return;
  staleTimers.clearInterval(staleTimer);
  staleTimer = null;
}

// ---------------------------------------------------------------------------
// GPS watcher
// ---------------------------------------------------------------------------

export interface GeolocationDeps {
  /** Defaults to `navigator.geolocation`; `null` simulates a browser without geolocation. */
  geolocation?: Pick<Geolocation, 'watchPosition' | 'clearWatch'> | null;
  /** Defaults to `document`. */
  doc?: DocLike | null;
  /** Wall clock, epoch ms. Defaults to `Date.now`. */
  now?: () => number;
}

interface Watcher {
  geo: Pick<Geolocation, 'watchPosition' | 'clearWatch'>;
  now: () => number;
  watchId: number | null;
  unlisten: () => void;
}

let watcher: Watcher | null = null;

function defaultGeolocation(): Pick<Geolocation, 'watchPosition' | 'clearWatch'> | null {
  try {
    return typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
  } catch {
    return null;
  }
}

function beginWatch(w: Watcher): void {
  safely(() => {
    w.watchId = w.geo.watchPosition(
      (position) => {
        if (watcher !== w) return; // a callback from a watch we already replaced
        const fix = normalizeFix(position, w.now());
        if (fix) ingestFix(fix, w.now());
      },
      (error) => {
        if (watcher !== w) return;
        ingestPositionError(error?.code ?? POSITION_UNAVAILABLE);
      },
      WATCH_OPTIONS,
    );
  });
}

function endWatch(w: Watcher): void {
  if (w.watchId === null) return;
  const id = w.watchId;
  w.watchId = null;
  safely(() => w.geo.clearWatch(id));
}

/**
 * Start watching the device position (high accuracy) into telemetry, with source `gps`.
 * Sets status `requesting` (or `unavailable` without geolocation support). Restarts the
 * watch whenever the page becomes visible again. Idempotent.
 */
export function startGeolocation(deps: GeolocationDeps = {}): void {
  if (watcher) return;
  const geo = deps.geolocation === undefined ? defaultGeolocation() : deps.geolocation;
  if (!geo) {
    resetForSource('gps', 'unavailable');
    return;
  }
  resetForSource('gps', 'requesting');
  const w: Watcher = { geo, now: deps.now ?? Date.now, watchId: null, unlisten: () => {} };
  watcher = w;
  w.unlisten = onVisibilityChange(deps.doc === undefined ? browserDocument() : deps.doc, (visible) => {
    if (!visible || watcher !== w) return;
    endWatch(w);
    beginWatch(w);
  });
  beginWatch(w);
}

/** Stop the GPS watch. Leaves telemetry as it is (the caller decides what comes next). Idempotent. */
export function stopGeolocation(): void {
  const w = watcher;
  if (!w) return;
  watcher = null;
  w.unlisten();
  endWatch(w);
}

/** `true` while the GPS watcher is running. */
export function isGeolocationRunning(): boolean {
  return watcher !== null;
}
