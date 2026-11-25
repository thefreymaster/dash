/**
 * T10 — The motion loop: turns ~1 Hz fixes into 60 fps motion in the `pose` Motion values.
 *
 *   fix (1 Hz) ──► dead-reckon forward along the course, up to 1.5 s ──► target
 *   displayed pose ──► damping towards target (frame-rate independent) ──► pose.*
 *
 * Design notes
 *   - Dead reckoning makes the target move continuously between fixes, so the displayed
 *     position never steps once per second. Extrapolation stops after `MAX_EXTRAPOLATION_S`,
 *     so a lost signal leaves the car where it probably is instead of sending it into a field.
 *   - Position and heading use a critically damped follower (two cascaded `damp` stages,
 *     solved exactly per frame): the correction a new fix brings — biggest just after a
 *     corner, because dead reckoning runs straight — becomes a smooth S-curve with
 *     continuous velocity instead of a kink. Speed and accuracy use plain `damp`.
 *   - Braking is extrapolated with the measured deceleration (never past the stopping
 *     point), so stopping at a light does not overshoot and slide back ("rubber-banding").
 *   - While stationary the target is pinned to an anchor and ignores GPS wander within
 *     `STATIONARY_ANCHOR_RADIUS_M` (or the fix's accuracy, up to `MAX_ANCHOR_RADIUS_M`), so
 *     a parked car does not drift around.
 *   - Unknown speed (`telemetry.speedKnown` false, or the fix older than
 *     `SPEED_STALE_AFTER_MS`): the displayed speed eases to 0 and `pose.speedKnown` is false
 *     (the speedometer shows "–"); nothing is dead-reckoned — the position target freezes
 *     where it was for the same fix (no sliding back after signal loss), and a new fix with
 *     an unknown speed is treated like a stationary one (anchored, wander-filtered).
 *   - Heading: GPS course when moving faster than 2 m/s (released below 1.5 m/s — hysteresis
 *     stops flip-flopping at walking pace). Below that the last GPS course is HELD; the
 *     compass is used only before the first GPS course of the session (orienting the map
 *     while still parked at the start), because the compass is magnetic (no declination),
 *     noisy and disturbed by the mount and car body. Angles interpolate across the 0/360 seam.
 *   - Snaps (no animation) on the first fix, on resume from background, on the first fix
 *     of a new source, and whenever the target is implausibly far away (`SNAP_DISTANCE_M`).
 *
 * `step` is pure and unit-tested; `startMotionLoop` is a thin requestAnimationFrame driver.
 * The loop is the ONLY writer of `pose`.
 */
import {
  angleDiffDeg,
  damp,
  destinationPoint,
  haversineM,
  lambdaFromHalfLife,
  normalizeDeg,
} from '../lib';
import { pose, telemetry } from '../state';
import type { Fix, Telemetry } from '../types';
import { getCompassDeg } from './compass';
import { browserDocument, isVisible, onVisibilityChange, type DocLike } from './env';
import { SPEED_STALE_AFTER_MS } from './geolocation';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Dead reckoning never extrapolates further than this past the last fix, s. */
export const MAX_EXTRAPOLATION_S = 1.5;
/**
 * Half-life of EACH of the two stages of the critically damped position follower, s.
 * Display lags the dead-reckoned target by 2·halfLife/ln2 ≈ 0.43 s of travel.
 */
export const POSITION_HALF_LIFE_S = 0.15;
/** Speed readout half-life (single stage), s — digits glide instead of stepping each second. */
export const SPEED_HALF_LIFE_S = 0.4;
/** Per-stage heading half-life while following the GPS course, s (lag in a turn ≈ 0.58 s). */
export const COURSE_HALF_LIFE_S = 0.2;
/** Per-stage heading half-life while following the compass (noisier, so calmer), s. */
export const COMPASS_HEADING_HALF_LIFE_S = 0.35;
/** Accuracy halo half-life, s. */
export const ACCURACY_HALF_LIFE_S = 1;
/** Switch to GPS course at or above this speed, m/s (≈4.5 mph). */
export const COURSE_MIN_SPEED_MPS = 2;
/** Keep GPS course until the speed drops below this, m/s (hysteresis). */
export const COURSE_RELEASE_SPEED_MPS = 1.5;
/** Jump instead of animating when the target is further than this from the display, m. */
export const SNAP_DISTANCE_M = 250;
/** While stationary, fixes within this radius of the anchor are treated as GPS wander, m. */
export const STATIONARY_ANCHOR_RADIUS_M = 8;
/** …widened to the fix's accuracy radius when that is worse, up to this, m. */
export const MAX_ANCHOR_RADIUS_M = 30;
/** The speed counts as unknown once the fix is this old, s (matches the telemetry rule). */
export const SPEED_MAX_AGE_S = SPEED_STALE_AFTER_MS / 1000;
/** Hidden for longer than this → forget the held GPS course (the car may have moved), ms. */
export const FORGET_COURSE_AFTER_HIDDEN_MS = 60_000;
/** Deceleration estimates are clamped to this (hard braking ≈ 8 m/s²), m/s². */
export const MAX_BRAKING_MPS2 = 8;
/** Acceleration is estimated only from fixes this far apart in time, s. */
export const ACCEL_WINDOW_S: readonly [min: number, max: number] = [0.5, 3];

/** Below these gaps the display is set exactly to the target (no endless micro-updates at rest). */
const SETTLE_DEG = 1e-7; // ≈ 1 cm of latitude
const SETTLE_SPEED_MPS = 0.01;
const SETTLE_HEADING_DEG = 0.01;
const SETTLE_ACCURACY_M = 0.01;

const POSITION_LAMBDA = lambdaFromHalfLife(POSITION_HALF_LIFE_S);
const SPEED_LAMBDA = lambdaFromHalfLife(SPEED_HALF_LIFE_S);
const COURSE_LAMBDA = lambdaFromHalfLife(COURSE_HALF_LIFE_S);
const COMPASS_LAMBDA = lambdaFromHalfLife(COMPASS_HEADING_HALF_LIFE_S);
const ACCURACY_LAMBDA = lambdaFromHalfLife(ACCURACY_HALF_LIFE_S);

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

export type HeadingSource = 'course' | 'compass' | 'hold';

/** What the loop displays (mirrors `pose`) plus the little memory `step` needs. */
export interface MotionState {
  hasPose: boolean;
  lat: number;
  lng: number;
  /** Displayed speed, m/s; eases to 0 while `speedKnown` is false. */
  speedMps: number;
  /** The speed is trustworthy this frame (mirrors `pose.speedKnown`). */
  speedKnown: boolean;
  headingDeg: number;
  accuracyM: number;
  /** Intermediate stage of the critically damped position/heading followers. */
  midLat: number;
  midLng: number;
  midHeadingDeg: number;
  /** Where the current heading comes from (kept for hysteresis). */
  headingSource: HeadingSource;
  /** A GPS course has been followed since the pose started: from then on stops HOLD it. */
  hadCourse: boolean;
  /** Pinned position while stationary, `null` while moving. */
  anchor: { lat: number; lng: number } | null;
  /** Position target of the last frame and the fix it was computed from (frozen while the speed is unknown). */
  target: { lat: number; lng: number; fixTimestamp: number; fixLat: number; fixLng: number } | null;
}

/** Inputs for one frame. */
export interface MotionTarget {
  /** Latest fix, `null` before the first one (or after the source changed). */
  fix: Fix | null;
  /** Best speed at the fix (`telemetry.speedMps`), m/s. Ignored when `speedKnown` is false. */
  speedMps: number;
  /** `telemetry.speedKnown` (and status `tracking`). The loop also expires it by `ageS`. */
  speedKnown: boolean;
  /** Course over ground at the fix (`telemetry.headingDeg`), `null` when unknown/stationary. */
  courseDeg: number | null;
  /** Along-track acceleration estimate, m/s² (only braking, i.e. < 0, is used). */
  accelMps2: number;
  /** Live compass heading, `null` when unavailable (or ignored, e.g. in demo mode). */
  compassDeg: number | null;
  /** Time since the fix was received, s. */
  ageS: number;
  /** Jump straight to the target this frame. */
  snap: boolean;
}

export const INITIAL_MOTION_STATE: MotionState = {
  hasPose: false,
  lat: 0,
  lng: 0,
  speedMps: 0,
  speedKnown: false,
  headingDeg: 0,
  accuracyM: 0,
  midLat: 0,
  midLng: 0,
  midHeadingDeg: 0,
  headingSource: 'hold',
  hadCourse: false,
  anchor: null,
  target: null,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finiteOr = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
/** Longitude difference wrapped to [-180, 180). */
const wrapLngDelta = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Distance to dead-reckon from the fix: `speed · t` (t capped at `MAX_EXTRAPOLATION_S`);
 * with a negative `accelMps2` the car is decelerated and never extrapolated past the point
 * where it would stop. Positive acceleration is ignored (overshooting when the driver
 * stops accelerating looks worse than lagging slightly).
 */
export function extrapolationDistanceM(speedMps: number, accelMps2: number, ageS: number): number {
  const t = clamp(finiteOr(ageS, 0), 0, MAX_EXTRAPOLATION_S);
  if (!(speedMps > 0) || t === 0) return 0;
  const a = clamp(Math.min(0, finiteOr(accelMps2, 0)), -MAX_BRAKING_MPS2, 0);
  if (a === 0) return speedMps * t;
  const stopAfter = speedMps / -a;
  if (t >= stopAfter) return (speedMps * stopAfter) / 2;
  return speedMps * t + 0.5 * a * t * t;
}

/**
 * One frame of a critically damped follower: two cascaded exponential stages with the same
 * rate (`m` follows the target, `x` follows `m`), solved exactly for a target held constant
 * over the frame — frame-rate independent like `damp`, but the output's velocity is
 * continuous, so a target that jumps produces a smooth S-curve instead of a kink.
 * At a steady target velocity v the output lags by 2·v/λ.
 * Returns `[x, m]`.
 */
export function followCritical(x: number, m: number, target: number, lambda: number, dtS: number): [number, number] {
  if (!(dtS > 0) || !(lambda > 0)) return [x, m];
  if (!Number.isFinite(x) || !Number.isFinite(m)) return [target, target];
  const k = Math.exp(-lambda * dtS);
  const e = m - target;
  const f = x - target;
  return [target + (f + lambda * dtS * e) * k, target + e * k];
}

/** `followCritical` for angles in degrees (shortest way round; results in [0, 360)). */
export function followCriticalAngle(
  xDeg: number,
  mDeg: number,
  targetDeg: number,
  lambda: number,
  dtS: number,
): [number, number] {
  const [f, e] = followCritical(angleDiffDeg(targetDeg, xDeg), angleDiffDeg(targetDeg, mDeg), 0, lambda, dtS);
  return [normalizeDeg(targetDeg + f), normalizeDeg(targetDeg + e)];
}

/**
 * Heading source, with hysteresis around the course switch-over speed:
 *   - `course` when there is a GPS course and the (known) speed is high enough;
 *   - otherwise `hold` once a GPS course has been followed (`hadCourse`, or `prev` is
 *     `course`): at a red light the map keeps the true-north course it had, instead of
 *     jumping by the magnetic declination and the compass's mount/car-body error;
 *   - before the first course: `compass` when available (parked at the start), else `hold`.
 */
export function selectHeadingSource(
  prev: HeadingSource,
  speedMps: number,
  courseDeg: number | null,
  compassDeg: number | null,
  hadCourse = false,
): HeadingSource {
  const threshold = prev === 'course' ? COURSE_RELEASE_SPEED_MPS : COURSE_MIN_SPEED_MPS;
  if (courseDeg !== null && speedMps >= threshold) return 'course';
  if (hadCourse || prev === 'course') return 'hold';
  if (compassDeg !== null) return 'compass';
  return 'hold';
}

/** Along-track acceleration between two (timestamp, speed) samples, m/s²; 0 when unknown. */
export function estimateAccelMps2(
  prev: { timestamp: number; speedMps: number } | null,
  next: { timestamp: number; speedMps: number },
): number {
  if (!prev) return 0;
  const dt = (next.timestamp - prev.timestamp) / 1000;
  if (!(dt >= ACCEL_WINDOW_S[0] && dt <= ACCEL_WINDOW_S[1])) return 0;
  const a = (next.speedMps - prev.speedMps) / dt;
  return Number.isFinite(a) ? clamp(a, -MAX_BRAKING_MPS2, MAX_BRAKING_MPS2) : 0;
}

/**
 * Advance the displayed pose by `dtS` seconds towards `target`. Pure.
 * Without a fix the pose is dropped (`hasPose` false) so the UI never shows stale data
 * from a previous source.
 */
export function step(prev: MotionState, target: MotionTarget, dtS: number): MotionState {
  const fix = target.fix;
  if (!fix) return prev.hasPose ? INITIAL_MOTION_STATE : prev;

  // A speed is only shown/used while it is known AND the fix is fresh.
  const speedKnown = target.speedKnown === true && finiteOr(target.ageS, 0) < SPEED_MAX_AGE_S;
  const speed = speedKnown ? Math.max(0, finiteOr(target.speedMps, 0)) : 0;
  const course =
    !speedKnown || target.courseDeg === null || !Number.isFinite(target.courseDeg) ? null : normalizeDeg(target.courseDeg);
  const compass =
    target.compassDeg === null || !Number.isFinite(target.compassDeg) ? null : normalizeDeg(target.compassDeg);
  const accuracy = Math.max(0, finiteOr(fix.accuracyM, 0));

  const sameFix =
    prev.target !== null &&
    prev.target.fixTimestamp === fix.timestamp &&
    prev.target.fixLat === fix.lat &&
    prev.target.fixLng === fix.lng;

  let anchor: MotionState['anchor'] = null;
  let tLat: number;
  let tLng: number;
  if (!speedKnown && sameFix && prev.target !== null) {
    // Speed lost on the fix we were already following (signal loss): freeze the target where
    // dead reckoning left it — never keep advancing, never slide back to the old fix.
    tLat = prev.target.lat;
    tLng = prev.target.lng;
    anchor = prev.anchor;
  } else {
    // Stationary or unknown speed: pin the position so GPS wander does not move the car.
    if (speed === 0) {
      const radius = Math.min(MAX_ANCHOR_RADIUS_M, Math.max(STATIONARY_ANCHOR_RADIUS_M, accuracy));
      const keep =
        prev.anchor !== null && haversineM([prev.anchor.lng, prev.anchor.lat], [fix.lng, fix.lat]) <= radius;
      anchor = keep ? prev.anchor : { lat: fix.lat, lng: fix.lng };
    }
    const base = anchor ?? fix;

    // Dead reckoning along the GPS course (known speed only).
    tLat = base.lat;
    tLng = base.lng;
    if (speed > 0 && course !== null) {
      const d = extrapolationDistanceM(speed, target.accelMps2, target.ageS);
      if (d > 0) [tLng, tLat] = destinationPoint([base.lng, base.lat], course, d);
    }
  }
  const nextTarget: MotionState['target'] = {
    lat: tLat,
    lng: tLng,
    fixTimestamp: fix.timestamp,
    fixLat: fix.lat,
    fixLng: fix.lng,
  };

  const headingSource = selectHeadingSource(prev.headingSource, speed, course, compass, prev.hadCourse);
  const headingTarget = headingSource === 'course' ? course : headingSource === 'compass' ? compass : null;
  const hadCourse = prev.hadCourse || headingSource === 'course';

  const snap =
    target.snap || !prev.hasPose || haversineM([prev.lng, prev.lat], [tLng, tLat]) > SNAP_DISTANCE_M;
  if (snap) {
    const heading = headingTarget ?? (prev.hasPose ? prev.headingDeg : 0);
    return {
      hasPose: true,
      lat: tLat,
      lng: tLng,
      // A snap jumps the position, not the readout: the speed still glides (from 0 on the first fix).
      speedMps: prev.hasPose ? prev.speedMps : speed,
      speedKnown,
      headingDeg: heading,
      accuracyM: accuracy,
      midLat: tLat,
      midLng: tLng,
      midHeadingDeg: heading,
      headingSource,
      hadCourse,
      anchor,
      target: nextTarget,
    };
  }

  const dt = dtS > 0 && Number.isFinite(dtS) ? dtS : 0;

  // Position: critically damped, so a target that jumps (first fix after a corner) bends
  // the path smoothly instead of kinking it. Longitude works in wrapped deltas.
  let [lat, midLat] = followCritical(prev.lat, prev.midLat, tLat, POSITION_LAMBDA, dt);
  const [dLng, dMidLng] = followCritical(
    wrapLngDelta(prev.lng - tLng),
    wrapLngDelta(prev.midLng - tLng),
    0,
    POSITION_LAMBDA,
    dt,
  );
  let lng = wrapLngDelta(tLng + dLng);
  let midLng = wrapLngDelta(tLng + dMidLng);
  if (
    Math.abs(lat - tLat) < SETTLE_DEG &&
    Math.abs(midLat - tLat) < SETTLE_DEG &&
    Math.abs(dLng) < SETTLE_DEG &&
    Math.abs(dMidLng) < SETTLE_DEG
  ) {
    lat = midLat = tLat;
    lng = midLng = tLng;
  }

  let speedMps = damp(prev.speedMps, speed, SPEED_LAMBDA, dt);
  if (Math.abs(speedMps - speed) < SETTLE_SPEED_MPS) speedMps = speed;

  // Heading: also critically damped. Holding means settling onto the intermediate stage,
  // so a turn in progress comes to rest smoothly instead of stopping dead.
  const lambda = headingSource === 'compass' ? COMPASS_LAMBDA : COURSE_LAMBDA;
  const hTarget = headingTarget ?? prev.midHeadingDeg;
  let [headingDeg, midHeadingDeg] = followCriticalAngle(prev.headingDeg, prev.midHeadingDeg, hTarget, lambda, dt);
  if (
    Math.abs(angleDiffDeg(headingDeg, hTarget)) < SETTLE_HEADING_DEG &&
    Math.abs(angleDiffDeg(midHeadingDeg, hTarget)) < SETTLE_HEADING_DEG
  ) {
    headingDeg = midHeadingDeg = hTarget;
  }

  let accuracyM = damp(prev.accuracyM, accuracy, ACCURACY_LAMBDA, dt);
  if (Math.abs(accuracyM - accuracy) < SETTLE_ACCURACY_M) accuracyM = accuracy;

  return {
    hasPose: true,
    lat,
    lng,
    speedMps,
    speedKnown,
    headingDeg,
    accuracyM,
    midLat,
    midLng,
    midHeadingDeg,
    headingSource,
    hadCourse,
    anchor,
    target: nextTarget,
  };
}

// ---------------------------------------------------------------------------
// requestAnimationFrame driver
// ---------------------------------------------------------------------------

export interface MotionLoopDeps {
  /** Defaults to `requestAnimationFrame`. */
  raf?: (callback: () => void) => number;
  /** Defaults to `cancelAnimationFrame`. */
  cancelRaf?: (id: number) => void;
  /** Monotonic clock, ms. Defaults to `performance.now`. */
  now?: () => number;
  /** Defaults to `document`. */
  doc?: DocLike | null;
  /** Live compass heading. Defaults to the compass module's smoothed value. */
  readCompass?: () => number | null;
}

interface Loop {
  raf: (callback: () => void) => number;
  cancelRaf: (id: number) => void;
  now: () => number;
  doc: DocLike | null;
  readCompass: () => number | null;
  frameId: number | null;
  lastFrameAt: number | null;
  state: MotionState;
  latest: Telemetry;
  fixReceivedAt: number;
  accelMps2: number;
  snapPending: boolean;
  snapOnNextFix: boolean;
  /** When the page was hidden (`now()` clock), `null` while visible. */
  hiddenAt: number | null;
  unsubscribe: () => void;
  unlisten: () => void;
}

let loop: Loop | null = null;

function onTelemetry(l: Loop, t: Telemetry): void {
  const prev = l.latest;
  l.latest = t;
  if (t.source !== prev.source) {
    // New source (GPS ↔ simulator): its first fix must not animate from the old position,
    // and the course held from the old source means nothing for the new one.
    l.snapOnNextFix = true;
    l.accelMps2 = 0;
    l.state = { ...l.state, hadCourse: false };
  }
  if (t.fix !== prev.fix) {
    l.fixReceivedAt = l.now();
    l.accelMps2 =
      t.fix && prev.fix && t.source === prev.source && t.speedKnown && prev.speedKnown
        ? estimateAccelMps2(
            { timestamp: prev.fix.timestamp, speedMps: prev.speedMps },
            { timestamp: t.fix.timestamp, speedMps: t.speedMps },
          )
        : 0;
    if (t.fix && l.snapOnNextFix) {
      l.snapPending = true;
      l.snapOnNextFix = false;
    }
  }
}

function writePose(s: MotionState): void {
  if (pose.hasPose.get() !== s.hasPose) pose.hasPose.set(s.hasPose);
  if (pose.speedKnown.get() !== s.speedKnown) pose.speedKnown.set(s.speedKnown);
  if (!s.hasPose) return;
  if (pose.lat.get() !== s.lat) pose.lat.set(s.lat);
  if (pose.lng.get() !== s.lng) pose.lng.set(s.lng);
  if (pose.speedMps.get() !== s.speedMps) pose.speedMps.set(s.speedMps);
  if (pose.headingDeg.get() !== s.headingDeg) pose.headingDeg.set(s.headingDeg);
  if (pose.accuracyM.get() !== s.accuracyM) pose.accuracyM.set(s.accuracyM);
}

function frame(l: Loop): void {
  l.frameId = null;
  if (loop !== l || !isVisible(l.doc)) return;
  const now = l.now();
  const dtS = l.lastFrameAt === null ? 0 : (now - l.lastFrameAt) / 1000;
  l.lastFrameAt = now;

  const t = l.latest;
  const target: MotionTarget = {
    fix: t.fix,
    speedMps: t.speedMps,
    speedKnown: t.speedKnown && t.status === 'tracking',
    courseDeg: t.headingDeg,
    accelMps2: l.accelMps2,
    // The phone's real compass has nothing to do with a simulated drive.
    compassDeg: t.source === 'gps' ? l.readCompass() : null,
    ageS: (now - l.fixReceivedAt) / 1000,
    snap: l.snapPending,
  };
  l.snapPending = false;
  l.state = step(l.state, target, dtS);
  writePose(l.state);
  schedule(l);
}

function schedule(l: Loop): void {
  if (loop !== l || l.frameId !== null || !isVisible(l.doc)) return;
  l.frameId = l.raf(() => frame(l));
}

function defaultRaf(): ((callback: () => void) => number) | null {
  return typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(() => cb()) : null;
}

/**
 * Start the per-frame loop that writes `pose`. Pauses while the page is hidden; on resume
 * it snaps to the latest fix (and to the first fix after resume) instead of animating
 * across the gap. Idempotent.
 */
export function startMotionLoop(deps: MotionLoopDeps = {}): void {
  if (loop) return;
  const raf = deps.raf ?? defaultRaf();
  if (!raf) return;
  const now = deps.now ?? (() => performance.now());
  const l: Loop = {
    raf,
    cancelRaf: deps.cancelRaf ?? ((id) => cancelAnimationFrame(id)),
    now,
    doc: deps.doc === undefined ? browserDocument() : deps.doc,
    readCompass: deps.readCompass ?? getCompassDeg,
    frameId: null,
    lastFrameAt: null,
    state: INITIAL_MOTION_STATE,
    latest: telemetry.get(),
    fixReceivedAt: now(),
    accelMps2: 0,
    snapPending: true,
    snapOnNextFix: false,
    hiddenAt: null,
    unsubscribe: () => {},
    unlisten: () => {},
  };
  loop = l;
  l.unsubscribe = telemetry.subscribe((t) => onTelemetry(l, t));
  l.unlisten = onVisibilityChange(l.doc, (visible) => {
    if (loop !== l) return;
    if (!visible) {
      if (l.frameId !== null) l.cancelRaf(l.frameId);
      l.frameId = null;
      l.hiddenAt = l.now();
      return;
    }
    // Away for a while: the car may have been driven and parked differently, so the held
    // course is no longer evidence — let the compass orient it again until the next course.
    if (l.hiddenAt !== null && l.now() - l.hiddenAt > FORGET_COURSE_AFTER_HIDDEN_MS) {
      l.state = { ...l.state, hadCourse: false };
    }
    l.hiddenAt = null;
    l.lastFrameAt = null;
    l.snapPending = true;
    l.snapOnNextFix = true;
    schedule(l);
  });
  schedule(l);
}

/** Stop the loop and mark the pose as unavailable (`hasPose` false). Idempotent. */
export function stopMotionLoop(): void {
  const l = loop;
  if (!l) return;
  loop = null;
  l.unsubscribe();
  l.unlisten();
  if (l.frameId !== null) l.cancelRaf(l.frameId);
  l.frameId = null;
  if (pose.hasPose.get()) pose.hasPose.set(false);
  if (pose.speedKnown.get()) pose.speedKnown.set(false);
}

/** `true` while the loop is running (even if paused because the page is hidden). */
export function isMotionLoopRunning(): boolean {
  return loop !== null;
}
