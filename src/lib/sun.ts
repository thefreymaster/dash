/**
 * Sun-driven theming. Uses the sun's apparent altitude (suncalc v2: degrees, refraction
 * corrected) rather than sunrise/sunset times, so it also behaves at high latitudes where
 * some events never happen.
 */
import { getPosition } from 'suncalc';
import type { LightPreset, ResolvedTheme } from '../types';

/** Sun altitude at official sunrise/sunset (upper limb on the horizon), degrees. */
export const SUNSET_ALTITUDE_DEG = -0.833;
/** Civil twilight boundary, degrees. Below this the map uses the `night` preset. */
export const CIVIL_TWILIGHT_DEG = -6;
/** End of the "golden hour", degrees. Above this the map uses the `day` preset. */
export const GOLDEN_HOUR_DEG = 6;

/** Sun altitude above the horizon at a place and instant, degrees (negative = below). */
export function sunAltitudeDeg(lat: number, lng: number, date: Date): number {
  return getPosition(date, lat, lng).altitude;
}

/** UI theme: `day` from sunrise to sunset, `night` otherwise. */
export function resolveTheme(lat: number, lng: number, date: Date): ResolvedTheme {
  return sunAltitudeDeg(lat, lng, date) >= SUNSET_ALTITUDE_DEG ? 'day' : 'night';
}

/**
 * Mapbox Standard `lightPreset` for the sun position:
 *   altitude ≥ 6°            → `day`
 *   altitude < -6°           → `night`
 *   in between, sun rising   → `dawn`
 *   in between, sun setting  → `dusk`
 */
export function lightPreset(lat: number, lng: number, date: Date): LightPreset {
  const altitude = sunAltitudeDeg(lat, lng, date);
  if (altitude >= GOLDEN_HOUR_DEG) return 'day';
  if (altitude < CIVIL_TWILIGHT_DEG) return 'night';
  const later = sunAltitudeDeg(lat, lng, new Date(date.getTime() + 10 * 60_000));
  return later >= altitude ? 'dawn' : 'dusk';
}
