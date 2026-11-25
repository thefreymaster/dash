/**
 * GPS signal indicator logic. Pure, tested in `gpsBucket.test.ts`.
 *
 * `gpsBucket` is used as a `telemetry.use(gpsBucket)` selector: it collapses status +
 * accuracy into one small string, so the indicator re-renders only when the bucket
 * changes, not on every 1 Hz fix.
 */
import type { GpsStatus, Telemetry } from '../../types';

export type GpsBucket =
  /** Not started, waiting for the first fix, or fixes stopped arriving (`idle` / `requesting` / `stale`). */
  | 'searching'
  /** The user refused location permission. */
  | 'denied'
  /** No geolocation, or a hard position error. */
  | 'unavailable'
  /** Tracking, accuracy worse than 50 m — 1 bar. */
  | 'weak'
  /** Tracking, accuracy ≤ 50 m — 2 bars. */
  | 'fair'
  /** Tracking, accuracy ≤ 25 m — 3 bars. */
  | 'good'
  /** Tracking, accuracy ≤ 10 m — 4 bars. */
  | 'strong';

/** Upper accuracy bound (metres, inclusive) of each bar level. */
export const GPS_ACCURACY_M = { strong: 10, good: 25, fair: 50 } as const;

const SEARCHING: readonly GpsStatus[] = ['idle', 'requesting', 'stale'];

/** Collapse telemetry into a signal bucket. */
export function gpsBucket(t: Pick<Telemetry, 'status' | 'fix'>): GpsBucket {
  if (t.status === 'denied') return 'denied';
  if (t.status === 'unavailable') return 'unavailable';
  if (SEARCHING.includes(t.status) || !t.fix) return 'searching';
  const acc = t.fix.accuracyM;
  if (!Number.isFinite(acc) || acc < 0) return 'weak';
  if (acc <= GPS_ACCURACY_M.strong) return 'strong';
  if (acc <= GPS_ACCURACY_M.good) return 'good';
  if (acc <= GPS_ACCURACY_M.fair) return 'fair';
  return 'weak';
}

/** Number of lit bars (of 4) for a bucket. Searching/denied/unavailable light none. */
export function gpsBars(bucket: GpsBucket): 0 | 1 | 2 | 3 | 4 {
  switch (bucket) {
    case 'strong':
      return 4;
    case 'good':
      return 3;
    case 'fair':
      return 2;
    case 'weak':
      return 1;
    default:
      return 0;
  }
}

/** `true` when location cannot work until the user changes something. */
export function gpsBlocked(bucket: GpsBucket): boolean {
  return bucket === 'denied' || bucket === 'unavailable';
}

/** Spoken description for the indicator (`aria-label`). */
export function gpsDescription(bucket: GpsBucket, source: Telemetry['source']): string {
  const prefix = source === 'sim' ? 'Demo drive' : 'GPS';
  switch (bucket) {
    case 'searching':
      return `${prefix}: searching for signal`;
    case 'denied':
      return 'Location permission denied';
    case 'unavailable':
      return 'Location unavailable';
    default:
      return `${prefix} signal ${bucket}`;
  }
}
