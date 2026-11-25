/**
 * Small pure helpers for the navigation UI: the parked-only typing rule, ETA text.
 */
import { formatClock, mphToMps } from '../../lib';
import type { Telemetry } from '../../types';

/**
 * SAFETY RULE — typing in the search field is only possible while parked.
 * Typing locks at `TYPING_LOCK_MPS` (3 mph) and unlocks again only below
 * `TYPING_UNLOCK_MPS` (2 mph), so creeping in traffic around 3 mph cannot flicker the
 * keyboard on and off. Typing is therefore never available at or above 3 mph.
 *
 * An UNKNOWN speed is never "parked": typing needs the GPS to be tracking with a trusted speed
 * (`telemetry.speedKnown`) below the threshold. The one exception is a phone that has had no
 * position at all yet and has not been seen moving this session — someone parked indoors can
 * still search.
 */
export const TYPING_LOCK_MPS = mphToMps(3);
export const TYPING_UNLOCK_MPS = mphToMps(2);

/**
 * Why typing is allowed or not:
 *   parked    GPS tracking with a trusted speed below the threshold
 *   no-gps    no position yet and never seen moving (allowed)
 *   moving    GPS speed at or above the threshold (or still above the unlock speed)
 *   no-speed  the GPS cannot confirm a stop: weak/stale signal, no trusted speed, or no position
 *             after the vehicle was seen moving
 */
export type TypingReason = 'parked' | 'no-gps' | 'moving' | 'no-speed';

export interface TypingLock {
  /** Typing in the search field is allowed. */
  allowed: boolean;
  reason: TypingReason;
  /** A trusted speed at or above `TYPING_LOCK_MPS` was seen this session. */
  seenMoving: boolean;
}

export const INITIAL_TYPING_LOCK: TypingLock = { allowed: true, reason: 'no-gps', seenMoving: false };

/** Next typing lock from the previous one and the latest telemetry (~1 Hz). Returns `prev` when nothing changed. */
export function nextTypingLock(prev: TypingLock, t: Pick<Telemetry, 'status' | 'fix' | 'speedMps' | 'speedKnown'>): TypingLock {
  const v = Number.isFinite(t.speedMps) && t.speedMps > 0 ? t.speedMps : 0;
  const trusted = t.fix !== null && t.status === 'tracking' && t.speedKnown === true;
  const seenMoving = prev.seenMoving || (trusted && v >= TYPING_LOCK_MPS);
  let allowed: boolean;
  let reason: TypingReason;
  if (t.fix === null) {
    allowed = !seenMoving;
    reason = seenMoving ? 'no-speed' : 'no-gps';
  } else if (!trusted) {
    allowed = false;
    reason = 'no-speed';
  } else {
    allowed = prev.allowed ? v < TYPING_LOCK_MPS : v < TYPING_UNLOCK_MPS;
    reason = allowed ? 'parked' : 'moving';
  }
  return allowed === prev.allowed && reason === prev.reason && seenMoving === prev.seenMoving ? prev : { allowed, reason, seenMoving };
}

/** Remaining time as "<1 min", "14 min", "1 h 5 min", "2 h". */
export function formatMinutes(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.round(s / 60);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Arrival wall-clock time, like the cluster clock ("11:06"), `remainingS` from `nowMs`. */
export function arrivalClock(nowMs: number, remainingS: number, hour12?: boolean): string {
  const s = Number.isFinite(remainingS) && remainingS > 0 ? remainingS : 0;
  return formatClock(new Date(nowMs + s * 1000), hour12);
}
