/**
 * T08 — Compass heading: a live smoothed value for the motion loop (`getCompassDeg`, read
 * every frame without touching the query cache) and a low-rate snapshot in
 * `telemetry.compassDeg` (≤ 1 write/s, only on a ≥ 5° change — every telemetry write re-runs
 * every `telemetry.use` selector, and nothing needs the compass faster than that there).
 *
 * iOS
 *   - `DeviceOrientationEvent.requestPermission()` exists only on iOS and must be called
 *     synchronously inside a user gesture. `requestCompassPermission` does exactly that and
 *     resolves `'granted'` immediately on browsers without a permission model.
 *   - `webkitCompassHeading` is degrees clockwise from north of the TOP OF THE DEVICE in
 *     portrait. The cluster runs in landscape, so the screen rotation angle is added to get
 *     the heading of the top of the screen as the driver sees it (`correctForScreen`).
 *   - It is MAGNETIC north, and only meaningful with a real `webkitCompassAccuracy`: WebKit
 *     reports heading 0 with accuracy -1 when it has no heading. Readings whose accuracy is
 *     missing, negative or worse than `COMPASS_MAX_ACCURACY_DEG` are ignored, and the live
 *     value lapses to `null` when no good reading arrived for `COMPASS_RESET_GAP_MS`.
 * Elsewhere `deviceorientationabsolute` / absolute `alpha` is used (alpha is counter-clockwise).
 */
import { angleDiffDeg, dampAngleDeg, lambdaFromHalfLife, normalizeDeg } from '../lib';
import { telemetry } from '../state';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Half-life of the angle-aware smoothing applied to raw compass events, s. */
export const COMPASS_HALF_LIFE_S = 0.25;
/** Minimum time between `telemetry.compassDeg` writes, ms (≤ 1 write/s). */
export const COMPASS_WRITE_INTERVAL_MS = 1_000;
/** Skip a cache write unless the heading moved at least this much, degrees. */
export const COMPASS_WRITE_MIN_DELTA_DEG = 5;
/**
 * Gaps between good readings longer than this restart the smoothing from the new reading,
 * and `getCompassDeg` returns `null` once the last good reading is older than this, ms.
 */
export const COMPASS_RESET_GAP_MS = 2_000;
/** iOS readings with a `webkitCompassAccuracy` worse than this (or negative = no heading) are ignored, degrees. */
export const COMPASS_MAX_ACCURACY_DEG = 25;

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/** The fields of a `DeviceOrientationEvent` the compass reads (iOS adds the `webkit…` ones). */
export interface OrientationReading {
  alpha?: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number | null;
  webkitCompassAccuracy?: number | null;
}

/** `webkitCompassAccuracy` is a real, good-enough value (0 … `COMPASS_MAX_ACCURACY_DEG`). */
export function compassAccuracyOk(accuracyDeg: number | null | undefined): boolean {
  return typeof accuracyDeg === 'number' && accuracyDeg >= 0 && accuracyDeg <= COMPASS_MAX_ACCURACY_DEG;
}

/**
 * Heading of the top of the device (portrait), degrees clockwise from north, or `null`.
 * Prefers iOS `webkitCompassHeading`, but only with a real accuracy (`compassAccuracyOk`):
 * WebKit's "no heading" is heading 0 / accuracy -1, which must not read as north. Otherwise
 * uses `alpha` only when the event is absolute (earth-referenced) — a relative alpha is not
 * a compass.
 */
export function readDeviceHeading(e: OrientationReading, absolute = e.absolute === true): number | null {
  const webkit = e.webkitCompassHeading;
  if (typeof webkit === 'number' && Number.isFinite(webkit) && webkit >= 0) {
    return compassAccuracyOk(e.webkitCompassAccuracy) ? normalizeDeg(webkit) : null;
  }
  if (absolute && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) return normalizeDeg(360 - e.alpha);
  return null;
}

/**
 * Device heading (top of the device in portrait) → heading of the top of the screen as
 * displayed. `screenAngleDeg` is the screen rotation counter-clockwise from portrait:
 * `screen.orientation.angle` (0, 90, 180, 270) or legacy `window.orientation` (0, 90, -90, 180).
 *
 * Landscape with the phone turned counter-clockwise (angle 90): the device top points left
 * of the driver, so the view direction is 90° clockwise of it. Turned clockwise (270 / -90):
 * 90° counter-clockwise of it.
 */
export function correctForScreen(deviceHeadingDeg: number, screenAngleDeg: number): number {
  const angle = Number.isFinite(screenAngleDeg) ? screenAngleDeg : 0;
  return normalizeDeg(deviceHeadingDeg + angle);
}

/** The bits of `window` used to find the screen rotation. */
export interface ScreenSource {
  screen?: { orientation?: { angle?: number } | null } | null;
  /** Legacy iOS `window.orientation`: 0, 90, -90 or 180. */
  orientation?: number;
}

/** Current screen rotation angle, degrees [0, 360). 0 when unknown. */
export function readScreenAngle(win: ScreenSource | null | undefined): number {
  try {
    const angle = win?.screen?.orientation?.angle;
    if (typeof angle === 'number' && Number.isFinite(angle)) return normalizeDeg(angle);
    const legacy = win?.orientation;
    if (typeof legacy === 'number' && Number.isFinite(legacy)) return normalizeDeg(legacy);
  } catch {
    // Some embedded browsers throw on access.
  }
  return 0;
}

export interface CompassFilter {
  /**
   * Feed one screen-corrected heading taken at `nowMs`. Returns the smoothed heading and,
   * when it is time to update the cache, the value to write (`null` = skip this write).
   */
  push(headingDeg: number, nowMs: number): { smoothedDeg: number; write: number | null };
  /** Current smoothed heading, or `null` before the first reading. */
  value(): number | null;
  reset(): void;
}

/**
 * Angle-aware exponential smoothing plus write throttling (at most one cache write per
 * `COMPASS_WRITE_INTERVAL_MS`, and only after moving `COMPASS_WRITE_MIN_DELTA_DEG`).
 */
export function createCompassFilter(
  halfLifeS: number = COMPASS_HALF_LIFE_S,
  writeIntervalMs: number = COMPASS_WRITE_INTERVAL_MS,
  minDeltaDeg: number = COMPASS_WRITE_MIN_DELTA_DEG,
): CompassFilter {
  const lambda = lambdaFromHalfLife(halfLifeS);
  let smoothed: number | null = null;
  let lastAt = 0;
  let lastWriteAt = -Infinity;
  let lastWritten: number | null = null;

  return {
    push(headingDeg, nowMs) {
      const gap = nowMs - lastAt;
      smoothed =
        smoothed === null || gap > COMPASS_RESET_GAP_MS || gap < 0
          ? normalizeDeg(headingDeg)
          : dampAngleDeg(smoothed, headingDeg, lambda, gap / 1000);
      lastAt = nowMs;

      let write: number | null = null;
      const due = nowMs - lastWriteAt >= writeIntervalMs;
      const moved = lastWritten === null || Math.abs(angleDiffDeg(lastWritten, smoothed)) >= minDeltaDeg;
      if (due && moved) {
        write = normalizeDeg(Math.round(smoothed * 10) / 10);
        lastWritten = write;
        lastWriteAt = nowMs;
      }
      return { smoothedDeg: smoothed, write };
    },
    value: () => smoothed,
    reset() {
      smoothed = null;
      lastAt = 0;
      lastWriteAt = -Infinity;
      lastWritten = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

export type CompassPermission = 'granted' | 'denied' | 'unsupported';

/** Static side of `DeviceOrientationEvent` (iOS adds `requestPermission`). */
export interface OrientationEventStatic {
  requestPermission?: () => Promise<string>;
}

let permission: CompassPermission | null = null;

/**
 * Ask for motion & orientation access. MUST be called synchronously inside a user gesture
 * (before any `await`): on iOS the prompt is only shown for a gesture. Never rejects.
 *   iOS                       → the user's answer (`granted` / `denied`)
 *   no permission model       → `granted`
 *   no DeviceOrientationEvent → `unsupported`
 */
export function requestCompassPermission(
  ctor: OrientationEventStatic | null | undefined = defaultOrientationCtor(),
): Promise<CompassPermission> {
  const done = (p: CompassPermission) => {
    permission = p;
    return p;
  };
  if (!ctor) return Promise.resolve(done('unsupported'));
  if (typeof ctor.requestPermission !== 'function') return Promise.resolve(done('granted'));
  try {
    return ctor.requestPermission().then(
      (answer) => done(answer === 'granted' ? 'granted' : 'denied'),
      () => done('denied'),
    );
  } catch {
    return Promise.resolve(done('denied'));
  }
}

/** Result of the last permission request, or `null` if none was made. */
export function compassPermission(): CompassPermission | null {
  return permission;
}

function defaultOrientationCtor(): OrientationEventStatic | null {
  return typeof DeviceOrientationEvent === 'undefined' ? null : (DeviceOrientationEvent as OrientationEventStatic);
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/** Event source for orientation events (normally `window`). */
export interface OrientationTarget extends ScreenSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface CompassDeps {
  /** Defaults to `window`. */
  target?: OrientationTarget | null;
  /** Monotonic clock, ms. Defaults to `performance.now`. */
  now?: () => number;
}

interface Running {
  target: OrientationTarget;
  types: string[];
  listener: (event: Event) => void;
  now: () => number;
  /** `now()` of the last accepted (good-accuracy) reading. */
  lastGoodAt: number;
}

const filter = createCompassFilter();
let running: Running | null = null;

/**
 * Live smoothed, screen-corrected compass heading (degrees [0, 360), magnetic), or `null`
 * when not running or no good reading arrived for `COMPASS_RESET_GAP_MS`. Cheap; call per frame.
 */
export function getCompassDeg(): number | null {
  const r = running;
  if (!r || r.now() - r.lastGoodAt > COMPASS_RESET_GAP_MS) return null;
  return filter.value();
}

/**
 * Start listening to orientation events. Call after `requestCompassPermission` resolved
 * `granted`. Writes `telemetry.compassDeg` at most once a second. Idempotent.
 */
export function startCompass(deps: CompassDeps = {}): void {
  if (running) return;
  const target = deps.target === undefined ? defaultTarget() : deps.target;
  if (!target) return;
  const now = deps.now ?? (() => performance.now());
  // `deviceorientationabsolute` (Chromium) gives earth-referenced alpha; iOS only fires
  // `deviceorientation` (with `webkitCompassHeading`).
  const hasAbsolute = 'ondeviceorientationabsolute' in target;
  const types = hasAbsolute ? ['deviceorientationabsolute', 'deviceorientation'] : ['deviceorientation'];

  const listener = (event: Event) => {
    const reading = event as unknown as OrientationReading;
    const device = readDeviceHeading(reading, reading.absolute === true || event.type === 'deviceorientationabsolute');
    if (device === null || running !== r) return;
    const at = now();
    r.lastGoodAt = at;
    const { write } = filter.push(correctForScreen(device, readScreenAngle(target)), at);
    if (write !== null) telemetry.set((t) => (t.compassDeg === write ? t : { ...t, compassDeg: write }));
  };

  filter.reset();
  const r: Running = { target, types, listener, now, lastGoodAt: Number.NEGATIVE_INFINITY };
  running = r;
  for (const type of types) target.addEventListener(type, listener);
}

/** Stop listening and clear `telemetry.compassDeg`. Idempotent. */
export function stopCompass(): void {
  const r = running;
  if (!r) return;
  running = null;
  for (const type of r.types) r.target.removeEventListener(type, r.listener);
  filter.reset();
  telemetry.set((t) => (t.compassDeg === null ? t : { ...t, compassDeg: null }));
}

function defaultTarget(): OrientationTarget | null {
  return typeof window === 'undefined' ? null : (window as unknown as OrientationTarget);
}
