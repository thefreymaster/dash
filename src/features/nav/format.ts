/**
 * Small pure helpers for the navigation UI: the parked-only typing rule, ETA text.
 */
import { formatClock, mphToMps } from '../../lib';

/**
 * SAFETY RULE — typing in the search field is only possible while parked.
 * Typing locks at `TYPING_LOCK_MPS` (3 mph) and unlocks again only below
 * `TYPING_UNLOCK_MPS` (2 mph), so creeping in traffic around 3 mph cannot flicker the
 * keyboard on and off. Typing is therefore never available at or above 3 mph.
 */
export const TYPING_LOCK_MPS = mphToMps(3);
export const TYPING_UNLOCK_MPS = mphToMps(2);

/** Next "parked" state from the previous one and the current speed (m/s; unknown = 0). */
export function nextParked(wasParked: boolean, speedMps: number): boolean {
  const v = Number.isFinite(speedMps) && speedMps > 0 ? speedMps : 0;
  return wasParked ? v < TYPING_LOCK_MPS : v < TYPING_UNLOCK_MPS;
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
