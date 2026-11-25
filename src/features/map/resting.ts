/**
 * Where the map rests before the first pose, and the remembered last position that makes the
 * resting view useful (a car usually starts where it was parked).
 *
 * The last position is written straight to localStorage with the shared `writeStored` /
 * `loadStored` helpers (same `dash:v1:` namespace as the client state), at most every
 * `SAVE_INTERVAL_MS` and when the page is hidden. It is map-private and not part of the
 * shared state contract.
 */
import { STORAGE_PREFIX, loadStored, writeStored } from '../../state';
import type { Telemetry } from '../../types';
import type { RestingView } from './camera';

/** localStorage key of the remembered position. */
export const LAST_POSITION_KEY = `${STORAGE_PREFIX}map:lastPosition`;
/** Minimum time between two saves while driving, ms. */
export const SAVE_INTERVAL_MS = 30_000;

/** Resting view over a remembered position. */
export const RESTING_NEAR = { zoom: 14.5, pitch: 40 } as const;
/** Resting globe when nothing is known. */
export const RESTING_GLOBE = { zoom: 1, pitch: 0, lat: 30 } as const;

export interface LastPosition {
  lng: number;
  lat: number;
  headingDeg: number;
  /** Epoch ms. */
  savedAt: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate a stored value; anything malformed or out of range yields `null`. */
export function parseLastPosition(value: unknown): LastPosition | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isNum(v.lng) || !isNum(v.lat) || Math.abs(v.lat) > 85 || Math.abs(v.lng) > 180) return null;
  return {
    lng: v.lng,
    lat: v.lat,
    headingDeg: isNum(v.headingDeg) ? v.headingDeg : 0,
    savedAt: isNum(v.savedAt) ? v.savedAt : 0,
  };
}

export function loadLastPosition(): LastPosition | null {
  return parseLastPosition(loadStored<unknown>(LAST_POSITION_KEY, null));
}

export function saveLastPosition(position: LastPosition): void {
  writeStored(LAST_POSITION_KEY, position);
}

/**
 * Save `position` as where the car really is — unless it is not real: never while the demo
 * simulator drives (the next real launch would rest over San Francisco and fly in from there),
 * and not before the current source has produced a fix (after switching from demo to GPS the
 * pose still shows the simulated car until the first real fix). Returns whether it saved.
 */
export function rememberPosition(position: LastPosition, telemetry: Pick<Telemetry, 'source' | 'fix'>): boolean {
  if (telemetry.source !== 'gps' || telemetry.fix === null) return false;
  saveLastPosition(position);
  return true;
}

/**
 * Resting camera: over the remembered position (slightly pitched, heading-up as it was parked),
 * otherwise a calm globe centred on the device's time-zone meridian.
 * @param timezoneOffsetMin `new Date().getTimezoneOffset()` (minutes, positive WEST of UTC).
 */
export function restingView(last: LastPosition | null, timezoneOffsetMin: number): RestingView {
  if (last) {
    return { lng: last.lng, lat: last.lat, zoom: RESTING_NEAR.zoom, pitch: RESTING_NEAR.pitch, bearing: last.headingDeg };
  }
  const offset = Number.isFinite(timezoneOffsetMin) ? timezoneOffsetMin : 0;
  // 15° of longitude per hour; UTC-5 (offset +300) → 75° W.
  const lng = Math.max(-180, Math.min(180, -offset / 4)) + 0; // `+ 0` turns -0 into 0
  return { lng, lat: RESTING_GLOBE.lat, zoom: RESTING_GLOBE.zoom, pitch: RESTING_GLOBE.pitch, bearing: 0 };
}
