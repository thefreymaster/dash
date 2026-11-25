/**
 * Display helpers for the trip pill and sheet (pure). Numbers are formatted with the shared
 * formatters in `src/lib/units.ts`; these only add what the trip UI needs on top.
 */
import { formatClock, formatDistanceParts, formatDuration, type DistanceParts } from '../../lib';
import type { Units } from '../../types';

const UNIT_METRES: Record<DistanceParts['unit'], number> = { ft: 0.3048, mi: 1609.344, m: 1, km: 1000 };

/** A displayed distance back in metres — orders values across unit changes (ft → mi). */
export function distanceOrder(parts: DistanceParts): number {
  const n = Number.parseFloat(parts.value);
  return Number.isFinite(n) ? n * UNIT_METRES[parts.unit] : 0;
}

/** A displayed `h:mm` duration as minutes. */
export function durationOrder(text: string): number {
  const [h, m] = text.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** A displayed integer (speed) as a number. */
export function integerOrder(text: string): number {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Character counts of what the pill shows. The pill re-renders (and animates its width)
 * only when this changes, not on every number update.
 */
export function pillShape(distanceM: number, movingMs: number, units: Units): string {
  const d = formatDistanceParts(distanceM, units);
  return `${d.value.length}${d.unit}${formatDuration(movingMs).length}`;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * "Since 10:19" for a trip started today; "Since Tue 18:40" for an earlier day.
 * `hour12` follows the device locale unless given (tests).
 */
export function sinceLabel(startedAt: number, now: number, hour12?: boolean): string {
  const start = new Date(startedAt);
  const clock = formatClock(start, hour12);
  if (sameDay(start, new Date(now))) return `Since ${clock}`;
  let day = '';
  try {
    day = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(start);
  } catch {
    day = '';
  }
  return day ? `Since ${day} ${clock}` : `Since ${clock}`;
}

/** Sheet subtitle under the "Trip" title. */
export function tripSubtitle(startedAt: number | null | undefined, demo: boolean, now: number, hour12?: boolean): string {
  if (demo) return 'Demo drive · not saved';
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return 'Starts when you drive';
  return `${sinceLabel(startedAt, now, hour12)} · auto-pauses when parked`;
}
