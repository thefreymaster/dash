/**
 * Spherical-earth geometry helpers. Pure functions, no dependencies.
 *
 * COORDINATE ORDER: every point here is a `LngLat` tuple `[lng, lat]` in degrees —
 * GeoJSON / Mapbox order, NOT lat-first. Convert domain objects (`Fix`, `Place`, anything
 * with `{ lat, lng }`) with `toLngLat(p)`.
 * Angles are degrees clockwise from true north. Distances are metres.
 * Accuracy: spherical model (mean Earth radius), error < 0.5 % vs WGS84 — plenty for a
 * dashboard; do not use for surveying.
 */
import type { LngLat } from '../types';

/** Mean Earth radius (IUGG), metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** `{ lat, lng }` object → `[lng, lat]` tuple. */
export function toLngLat(p: { lat: number; lng: number }): LngLat {
  return [p.lng, p.lat];
}

/** Normalise any angle to [0, 360). */
export function normalizeDeg(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r + 0; // `+ 0` turns -0 into 0
}

/** Great-circle (haversine) distance between two points, metres. */
export function haversineM(a: LngLat, b: LngLat): number {
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const dLat = lat2 - lat1;
  const dLng = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from `from` towards `to`, degrees [0, 360). 0 for identical points. */
export function bearingDeg(from: LngLat, to: LngLat): number {
  const lat1 = from[1] * RAD;
  const lat2 = to[1] * RAD;
  const dLng = (to[0] - from[0]) * RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeDeg(Math.atan2(y, x) * DEG);
}

/** Point reached by travelling `distanceM` metres from `from` on initial bearing `bearing` (degrees). */
export function destinationPoint(from: LngLat, bearing: number, distanceM: number): LngLat {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = bearing * RAD;
  const lat1 = from[1] * RAD;
  const lng1 = from[0] * RAD;
  const sinLat2 = Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(lat1), Math.cos(delta) - Math.sin(lat1) * sinLat2);
  return [wrapLng(lng2 * DEG), lat2 * DEG];
}

/**
 * Shortest signed rotation from angle `from` to angle `to`, degrees in (-180, 180].
 * Positive = clockwise. `angleDiffDeg(350, 10) === 20`, `angleDiffDeg(10, 350) === -20`.
 */
export function angleDiffDeg(from: number, to: number): number {
  const d = normalizeDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/**
 * Interpolate between two angles along the shortest arc (crosses the 0/360 seam correctly).
 * `t` = 0 → `a`, 1 → `b`. Result normalised to [0, 360). `lerpAngleDeg(350, 10, 0.5) === 0`.
 */
export function lerpAngleDeg(a: number, b: number, t: number): number {
  return normalizeDeg(a + angleDiffDeg(a, b) * t);
}

/**
 * Cumulative distance along a polyline at each vertex, metres: `result[0] === 0`,
 * `result[i]` = length from `line[0]` to `line[i]`. Same length as `line` (empty → []).
 * Compute once per route and pass to `nearestPointOnLine` to avoid recomputing.
 */
export function cumulativeLengthsM(line: readonly LngLat[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) total += haversineM(line[i - 1], line[i]);
    out.push(total);
  }
  return out;
}

/** Total length of a polyline, metres (0 for fewer than two points). */
export function lineLengthM(line: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineM(line[i - 1], line[i]);
  return total;
}

export interface NearestPoint {
  /** Closest point on the line, `[lng, lat]`. */
  point: LngLat;
  /** Lateral offset: distance from the query point to `point`, metres. */
  distanceM: number;
  /** Distance along the line from `line[0]` to `point`, metres. */
  alongM: number;
  /** Index `i` of the segment `line[i] → line[i + 1]` containing `point` (0 for a one-point line). */
  segmentIndex: number;
}

/**
 * Closest point on a polyline to `point` (route snapping, off-route detection, progress).
 * Each segment is projected onto a local flat (equirectangular) plane centred on `point`,
 * which is accurate for segments within a few tens of km of the query point.
 * `cumulative` may be passed from `cumulativeLengthsM(line)` to save work on long routes.
 * Returns `null` for an empty line. Ties go to the earliest segment.
 */
export function nearestPointOnLine(
  line: readonly LngLat[],
  point: LngLat,
  cumulative: readonly number[] = cumulativeLengthsM(line),
): NearestPoint | null {
  if (line.length === 0) return null;
  if (line.length === 1) {
    return { point: line[0], distanceM: haversineM(point, line[0]), alongM: 0, segmentIndex: 0 };
  }

  // Local metric plane around the query point: x east, y north, metres.
  const lat0 = point[1] * RAD;
  const kx = Math.cos(lat0) * EARTH_RADIUS_M * RAD;
  const ky = EARTH_RADIUS_M * RAD;
  const toXY = (p: LngLat): [number, number] => [wrapLng(p[0] - point[0]) * kx, (p[1] - point[1]) * ky];

  let bestIndex = 0;
  let bestT = 0;
  let bestDist2 = Infinity;
  let [ax, ay] = toXY(line[0]);
  for (let i = 0; i < line.length - 1; i++) {
    const [bx, by] = toXY(line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Query point is the origin, so project (0,0) onto segment a→b.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const dist2 = px * px + py * py;
    if (dist2 < bestDist2) {
      bestDist2 = dist2;
      bestIndex = i;
      bestT = t;
    }
    ax = bx;
    ay = by;
  }

  const a = line[bestIndex];
  const b = line[bestIndex + 1];
  const nearest: LngLat = [a[0] + wrapLng(b[0] - a[0]) * bestT, a[1] + (b[1] - a[1]) * bestT];
  nearest[0] = wrapLng(nearest[0]);
  return {
    point: nearest,
    distanceM: haversineM(point, nearest),
    alongM: (cumulative[bestIndex] ?? 0) + haversineM(a, nearest),
    segmentIndex: bestIndex,
  };
}

/** Wrap a longitude (or longitude difference) into [-180, 180). */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}
