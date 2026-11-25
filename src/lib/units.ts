/**
 * Unit conversion and display formatting. Everything in the app is SI internally
 * (m/s, metres, ms); convert only at the edge, for display.
 */
import type { Units } from '../types';

/** 1 m/s in mph (exact: 3600 / 1609.344). */
export const MPS_TO_MPH = 3600 / 1609.344;
/** 1 m/s in km/h. */
export const MPS_TO_KMH = 3.6;
/** Metres per statute mile. */
export const METERS_PER_MILE = 1609.344;
/** Metres per foot. */
export const METERS_PER_FOOT = 0.3048;

export const mpsToMph = (mps: number): number => mps * MPS_TO_MPH;
export const mphToMps = (mph: number): number => mph / MPS_TO_MPH;
export const mpsToKmh = (mps: number): number => mps * MPS_TO_KMH;
export const kmhToMps = (kmh: number): number => kmh / MPS_TO_KMH;

/** m/s → the user's speed unit (mph or km/h). */
export function speedFromMps(mps: number, units: Units): number {
  return units === 'mph' ? mpsToMph(mps) : mpsToKmh(mps);
}

/** The user's speed unit → m/s. */
export function speedToMps(value: number, units: Units): number {
  return units === 'mph' ? mphToMps(value) : kmhToMps(value);
}

/** Short label for the speed unit: `mph` or `km/h`. */
export function speedUnitLabel(units: Units): string {
  return units === 'mph' ? 'mph' : 'km/h';
}

/**
 * Speed for the speedometer: rounded integer string in the user's unit, e.g. `"63"`.
 * Negative, NaN and infinite inputs show `"0"`.
 */
export function formatSpeed(mps: number, units: Units): string {
  if (!Number.isFinite(mps) || mps <= 0) return '0';
  return String(Math.round(speedFromMps(mps, units)));
}

export interface DistanceParts {
  /** Number as displayed, e.g. `"0.3"`, `"450"`, `"12"`. */
  value: string;
  /** Unit label: `ft`, `mi`, `m` or `km`. */
  unit: 'ft' | 'mi' | 'm' | 'km';
}

/**
 * Distance split into number and unit, so the UI can style the unit smaller.
 * Imperial: < 0.1 mi → feet (nearest 10 ft below 100 ft, else nearest 50 ft);
 *           < 10 mi → one decimal mile; otherwise whole miles.
 * Metric:   < 1 km → metres (nearest 10 m); < 10 km → one decimal km; otherwise whole km.
 * Rounding never produces "1000 m", "528 ft" or "10.0 mi" — it rolls over to the next unit.
 */
export function formatDistanceParts(meters: number, units: Units): DistanceParts {
  const m = Number.isFinite(meters) && meters > 0 ? meters : 0;
  if (units === 'mph') {
    const miles = m / METERS_PER_MILE;
    if (miles < 0.1) {
      const feet = m / METERS_PER_FOOT;
      const step = feet < 100 ? 10 : 50;
      const rounded = Math.round(feet / step) * step;
      if (rounded < 0.1 * 5280) return { value: String(rounded), unit: 'ft' };
      return { value: '0.1', unit: 'mi' };
    }
    return wholeOrTenths(miles, 'mi');
  }
  if (m < 1000) {
    const rounded = Math.round(m / 10) * 10;
    if (rounded < 1000) return { value: String(rounded), unit: 'm' };
    return { value: '1.0', unit: 'km' };
  }
  return wholeOrTenths(m / 1000, 'km');
}

function wholeOrTenths(value: number, unit: 'mi' | 'km'): DistanceParts {
  const tenths = Math.round(value * 10) / 10;
  if (tenths < 10) return { value: tenths.toFixed(1), unit };
  return { value: String(Math.round(value)), unit };
}

/** Distance as one string, e.g. `"0.3 mi"`, `"450 ft"`, `"12 km"`. See `formatDistanceParts`. */
export function formatDistance(meters: number, units: Units): string {
  const { value, unit } = formatDistanceParts(meters, units);
  return `${value} ${unit}`;
}

/**
 * Duration as hours:minutes, minutes zero-padded: 23 min → `"0:23"`, 65 min → `"1:05"`,
 * 26 h 10 min → `"26:10"`. Seconds are truncated (a trip "0:00" until a full minute has passed).
 * Negative/NaN → `"0:00"`.
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/** `true` if the device locale uses a 12-hour clock. */
export function localeUses12Hour(): boolean {
  try {
    const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h11' || cycle === 'h12';
  } catch {
    return false;
  }
}

/**
 * Wall-clock time without AM/PM, as on the cluster's top strip: `"9:05"` (12-hour) or
 * `"09:05"` (24-hour). The hour cycle follows the device locale unless `hour12` is given.
 */
export function formatClock(date: Date, hour12: boolean = localeUses12Hour()): string {
  const h = date.getHours();
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (hour12) return `${h % 12 === 0 ? 12 : h % 12}:${mm}`;
  return `${String(h).padStart(2, '0')}:${mm}`;
}
