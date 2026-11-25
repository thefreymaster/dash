/**
 * T24 Trip accumulation — pure logic (no state, no clock, no I/O).
 *
 * The recorder feeds every new fix through `stepTrip(trip, anchor, fix)`. `anchor` is the
 * last fix the trip is measured FROM (the last accurate fix, held back while the vehicle
 * creeps less than the GPS noise). `accumulateTrip(trip, prev, next)` is the same reducer
 * without the anchor bookkeeping.
 *
 * Each step classifies the segment anchor → fix and only a `moving` segment adds to the
 * trip:
 *
 *   inaccurate  fix accuracy worse than MAX_ACCURACY_M (or unusable numbers): ignored, the
 *               anchor is kept, so the next good fix bridges it (unless that is a gap)
 *   first       no usable anchor yet: the fix becomes the anchor
 *   gap         more than MAX_GAP_MS since the anchor (backgrounded, tunnel, clock moved
 *               back): no straight line across it, the fix becomes the anchor
 *   jump        implied speed above MAX_PLAUSIBLE_SPEED_MPS, or further than the reported
 *               speed allows: a position glitch, not travel; re-anchor
 *   stopped     speed below MOVING_SPEED_MPS: parked / waiting (auto-pause); re-anchor
 *   creep       moving, but the displacement is still inside the GPS noise floor: keep the
 *               anchor and measure again from it next time (so wander never adds up, but
 *               slow real movement is counted once it clears the noise)
 *   moving      add the distance and the elapsed time; update max speed; re-anchor
 *
 * Speed: the newer fix's own device (Doppler) speed when it has one — it is not fooled by
 * position wander; otherwise distance ÷ time since the anchor, with a stricter noise floor. Max speed is taken only from the device speed of accurate fixes on a
 * `moving` segment, and only if the positions roughly agree with it (rejects speed spikes).
 *
 * Lifecycle: the trip starts (`startedAt`) at the first moving segment. A moving segment
 * that begins IDLE_RESET_MS or more after `lastMovedAt` starts a fresh trip — the check
 * uses the persisted timestamp, so it works whether or not the app was open in between.
 *
 * Returned trips are new objects only when something changed: callers can skip writes by
 * comparing references.
 */
import { haversineM, toLngLat } from '../../lib';
import { initialTrip } from '../../state';
import type { Fix, Trip } from '../../types';

// ---------------------------------------------------------------------------
// Tunables (see the report in the task / tune after a real drive)
// ---------------------------------------------------------------------------

/** Fixes with a horizontal accuracy worse than this are not used at all, m. */
export const MAX_ACCURACY_M = 25;
/** Below this speed the vehicle counts as stopped (auto-pause), m/s (≈ 2.2 mph, 3.6 km/h). */
export const MOVING_SPEED_MPS = 1;
/** Longest interval bridged between two accurate fixes, ms. Longer: no distance, no time. */
export const MAX_GAP_MS = 15_000;
/** Implied speeds above this are position jumps, m/s (≈ 157 mph, 252 km/h). */
export const MAX_PLAUSIBLE_SPEED_MPS = 70;
/**
 * With a device speed, a segment longer than `JUMP_SPEED_RATIO × max(reported speeds) × dt`
 * plus both accuracy radii is a jump.
 */
export const JUMP_SPEED_RATIO = 2;
/** Noise floor with a device speed: this × the worse accuracy radius of the two fixes. */
export const NOISE_FLOOR_RATIO_DEVICE = 0.5;
/** Noise floor without a device speed (speed derived from the positions): × the worse accuracy. */
export const NOISE_FLOOR_RATIO_DERIVED = 1;
/** A device speed counts for max only if ≤ this × the speed implied by the positions + slack. */
export const MAX_SPEED_CHECK_RATIO = 1.5;
/** …plus this, m/s. */
export const MAX_SPEED_CHECK_SLACK_MPS = 5;
/** Parked at least this long since the last recorded movement → the next movement starts a new trip, ms. */
export const IDLE_RESET_MS = 4 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type SegmentKind = 'inaccurate' | 'first' | 'gap' | 'jump' | 'stopped' | 'creep' | 'moving';

export interface Segment {
  kind: SegmentKind;
  /** Straight-line distance anchor → fix, m (0 when not measured). */
  distanceM: number;
  /** Time anchor → fix, ms (0 when not measured). */
  durationMs: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Usable coordinates and time, and accuracy within `MAX_ACCURACY_M`. */
export function isAccurateFix(fix: Fix | null | undefined): fix is Fix {
  return (
    !!fix &&
    finite(fix.lat) &&
    finite(fix.lng) &&
    finite(fix.timestamp) &&
    finite(fix.accuracyM) &&
    fix.accuracyM >= 0 &&
    fix.accuracyM <= MAX_ACCURACY_M
  );
}

/** The device-reported speed, or `null` when the fix has none. */
function deviceSpeed(fix: Fix): number | null {
  return finite(fix.speedMps) && fix.speedMps >= 0 ? fix.speedMps : null;
}

const segment = (kind: SegmentKind, distanceM = 0, durationMs = 0): Segment => ({ kind, distanceM, durationMs });

/** Classify the segment `prev` (the anchor) → `next`. See the module comment. */
export function classifySegment(prev: Fix | null, next: Fix): Segment {
  if (!isAccurateFix(next)) return segment('inaccurate');
  if (!isAccurateFix(prev)) return segment('first');

  const durationMs = next.timestamp - prev.timestamp;
  if (!(durationMs > 0) || durationMs > MAX_GAP_MS) return segment('gap');

  const distanceM = haversineM(toLngLat(prev), toLngLat(next));
  const dt = durationMs / 1000;
  const implied = distanceM / dt;
  if (!(implied <= MAX_PLAUSIBLE_SPEED_MPS)) return segment('jump', distanceM, durationMs);

  const a = deviceSpeed(prev);
  const b = deviceSpeed(next);
  const noiseM = Math.max(prev.accuracyM, next.accuracyM);
  let speed: number;
  let floorM: number;
  if (b !== null) {
    const reported = Math.max(a ?? 0, b);
    if (distanceM > reported * dt * JUMP_SPEED_RATIO + prev.accuracyM + next.accuracyM) {
      return segment('jump', distanceM, durationMs);
    }
    // The NEWER fix decides: the anchor may be several seconds old (creep), so averaging
    // with it would let a held-back moving anchor make parked fixes look like motion.
    speed = b;
    floorM = noiseM * NOISE_FLOOR_RATIO_DEVICE;
  } else {
    speed = implied;
    floorM = noiseM * NOISE_FLOOR_RATIO_DERIVED;
  }

  if (!(speed >= MOVING_SPEED_MPS)) return segment('stopped', distanceM, durationMs);
  if (distanceM < floorM) return segment('creep', distanceM, durationMs);
  return segment('moving', distanceM, durationMs);
}

/** The fix to measure the next segment from, after `kind`. */
export function nextAnchor(prev: Fix | null, next: Fix, kind: SegmentKind): Fix | null {
  return kind === 'inaccurate' || kind === 'creep' ? prev : next;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** `lastMovedAt` if it is a usable timestamp (stored data is not trusted), else `null`. */
export function lastMovedAt(trip: Trip): number | null {
  return finite(trip.lastMovedAt) ? trip.lastMovedAt : null;
}

/** The trip has been idle long enough that movement at `at` starts a new one. */
export function isTripExpired(trip: Trip, at: number): boolean {
  const last = lastMovedAt(trip);
  return last !== null && at - last >= IDLE_RESET_MS;
}

/** Device speed of `next` if it may count towards max speed on this moving segment, else 0. */
function maxSpeedCandidate(next: Fix, seg: Segment): number {
  const speed = deviceSpeed(next);
  if (speed === null || speed > MAX_PLAUSIBLE_SPEED_MPS) return 0;
  const implied = seg.distanceM / (seg.durationMs / 1000);
  return speed <= implied * MAX_SPEED_CHECK_RATIO + MAX_SPEED_CHECK_SLACK_MPS ? speed : 0;
}

/** Apply a classified segment. Returns `trip` itself unless the segment is `moving`. */
function applySegment(trip: Trip, prev: Fix | null, next: Fix, seg: Segment): Trip {
  if (seg.kind !== 'moving' || !prev) return trip;
  const start = prev.timestamp;
  const base = isTripExpired(trip, start) ? initialTrip : trip;
  return {
    ...base,
    startedAt: finite(base.startedAt) ? base.startedAt : start,
    distanceM: base.distanceM + seg.distanceM,
    movingMs: base.movingMs + seg.durationMs,
    maxSpeedMps: Math.max(base.maxSpeedMps, maxSpeedCandidate(next, seg)),
    lastMovedAt: next.timestamp,
  };
}

export interface TripStep {
  /** The trip after this fix (the same reference when nothing changed). */
  trip: Trip;
  /** Anchor for the next fix. */
  anchor: Fix | null;
  /** How the segment was classified. */
  kind: SegmentKind;
}

/** One recorder step: classify anchor → fix, update the trip, pick the next anchor. */
export function stepTrip(trip: Trip, anchor: Fix | null, fix: Fix): TripStep {
  const seg = classifySegment(anchor, fix);
  return { trip: applySegment(trip, anchor, fix, seg), anchor: nextAnchor(anchor, fix, seg.kind), kind: seg.kind };
}

/**
 * The trip reducer: `trip` after travelling from `prevFix` to `nextFix`. Returns `trip`
 * itself when the segment adds nothing (stopped, glitch, gap, inaccurate…).
 */
export function accumulateTrip(trip: Trip, prevFix: Fix | null, nextFix: Fix): Trip {
  return applySegment(trip, prevFix, nextFix, classifySegment(prevFix, nextFix));
}

/** Average speed while moving, m/s (0 before any movement). Derived, never stored. */
export function averageSpeedMps(trip: Trip): number {
  return trip.movingMs > 0 ? trip.distanceM / (trip.movingMs / 1000) : 0;
}
