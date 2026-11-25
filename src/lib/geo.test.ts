import { describe, expect, it } from 'vitest';
import type { LngLat } from '../types';
import {
  EARTH_RADIUS_M,
  angleDiffDeg,
  bearingDeg,
  cumulativeLengthsM,
  destinationPoint,
  haversineM,
  lerpAngleDeg,
  lineLengthM,
  nearestPointOnLine,
  normalizeDeg,
  toLngLat,
} from './geo';

/** Metres per degree of arc on the model sphere (≈ 111 195 m). */
const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

const LONDON: LngLat = [-0.1278, 51.5074];
const PARIS: LngLat = [2.3522, 48.8566];
const JFK: LngLat = [-73.7781, 40.6413];
const LAX: LngLat = [-118.4085, 33.9416];

describe('toLngLat / normalizeDeg', () => {
  it('converts objects to GeoJSON order', () => {
    expect(toLngLat({ lat: 51.5, lng: -0.12 })).toEqual([-0.12, 51.5]);
  });
  it('normalises into [0, 360)', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(725)).toBe(5);
    expect(Object.is(normalizeDeg(-0), 0)).toBe(true);
  });
});

describe('haversineM', () => {
  it('one degree of latitude / of longitude on the equator', () => {
    expect(haversineM([0, 0], [0, 1])).toBeCloseTo(M_PER_DEG, 3);
    expect(haversineM([0, 0], [1, 0])).toBeCloseTo(111_195, -1);
  });
  it('London → Paris ≈ 343.6 km', () => {
    expect(haversineM(LONDON, PARIS) / 1000).toBeCloseTo(343.6, 0);
  });
  it('JFK → LAX ≈ 3 983 km and is symmetric', () => {
    const d = haversineM(JFK, LAX);
    expect(d / 1000).toBeGreaterThan(3970);
    expect(d / 1000).toBeLessThan(3995);
    expect(haversineM(LAX, JFK)).toBeCloseTo(d, 6);
  });
  it('is 0 for identical points and handles the antimeridian', () => {
    expect(haversineM(LONDON, LONDON)).toBe(0);
    expect(haversineM([179.5, 0], [-179.5, 0])).toBeCloseTo(M_PER_DEG, 3);
  });
});

describe('bearingDeg', () => {
  it('cardinal directions', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 9);
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 9);
    expect(bearingDeg([0, 1], [0, 0])).toBeCloseTo(180, 9);
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(270, 9);
  });
  it('London → Paris initial bearing ≈ 148.1°', () => {
    expect(bearingDeg(LONDON, PARIS)).toBeCloseTo(148.1, 1);
  });
});

describe('destinationPoint', () => {
  it('one degree east along the equator', () => {
    const [lng, lat] = destinationPoint([0, 0], 90, M_PER_DEG);
    expect(lng).toBeCloseTo(1, 9);
    expect(lat).toBeCloseTo(0, 9);
  });
  it('round-trips with bearing + distance', () => {
    const p = destinationPoint(LONDON, bearingDeg(LONDON, PARIS), haversineM(LONDON, PARIS));
    expect(p[0]).toBeCloseTo(PARIS[0], 6);
    expect(p[1]).toBeCloseTo(PARIS[1], 6);
  });
  it('wraps across the antimeridian', () => {
    const [lng] = destinationPoint([179.9, 0], 90, 0.2 * M_PER_DEG);
    expect(lng).toBeCloseTo(-179.9, 6);
  });
});

describe('angleDiffDeg / lerpAngleDeg', () => {
  it('takes the short way across the 0/360 seam', () => {
    expect(angleDiffDeg(350, 10)).toBeCloseTo(20, 9);
    expect(angleDiffDeg(10, 350)).toBeCloseTo(-20, 9);
    expect(angleDiffDeg(90, 45)).toBeCloseTo(-45, 9);
    expect(angleDiffDeg(0, 0)).toBe(0);
  });
  it('opposite angles give +180', () => {
    expect(angleDiffDeg(0, 180)).toBe(180);
    expect(angleDiffDeg(90, 270)).toBe(180);
  });
  it('interpolates across the seam', () => {
    expect(lerpAngleDeg(350, 10, 0.5)).toBeCloseTo(0, 9);
    expect(lerpAngleDeg(10, 350, 0.25)).toBeCloseTo(5, 9);
    expect(lerpAngleDeg(0, 90, 0.5)).toBeCloseTo(45, 9);
    expect(lerpAngleDeg(340, 20, 1)).toBeCloseTo(20, 9);
    expect(lerpAngleDeg(340, 20, 0)).toBeCloseTo(340, 9);
  });
});

describe('polyline length', () => {
  const line: LngLat[] = [
    [0, 0],
    [0, 1],
    [1, 1],
  ];
  it('cumulative lengths per vertex', () => {
    const cum = cumulativeLengthsM(line);
    expect(cum).toHaveLength(3);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeCloseTo(M_PER_DEG, 3);
    // One degree of longitude at 1°N is shorter by ≈cos(1°).
    expect(cum[2] - cum[1]).toBeCloseTo(M_PER_DEG * Math.cos(Math.PI / 180), -1);
    expect(lineLengthM(line)).toBeCloseTo(cum[2], 6);
  });
  it('degenerate lines', () => {
    expect(cumulativeLengthsM([])).toEqual([]);
    expect(lineLengthM([[5, 5]])).toBe(0);
  });
});

describe('nearestPointOnLine', () => {
  // 0.01° east along the equator ≈ 1 112 m, then 0.01° north.
  const line: LngLat[] = [
    [0, 0],
    [0.01, 0],
    [0.01, 0.01],
  ];

  it('projects onto the interior of a segment', () => {
    const r = nearestPointOnLine(line, [0.005, 0.001])!;
    expect(r.segmentIndex).toBe(0);
    expect(r.point[0]).toBeCloseTo(0.005, 9);
    expect(r.point[1]).toBeCloseTo(0, 9);
    expect(r.distanceM).toBeCloseTo(0.001 * M_PER_DEG, 1); // ≈ 111.2 m lateral offset
    expect(r.alongM).toBeCloseTo(0.005 * M_PER_DEG, 1); // ≈ 556 m along
  });

  it('picks the correct later segment and accumulates alongM', () => {
    const r = nearestPointOnLine(line, [0.012, 0.004])!;
    expect(r.segmentIndex).toBe(1);
    expect(r.point[0]).toBeCloseTo(0.01, 9);
    expect(r.point[1]).toBeCloseTo(0.004, 9);
    expect(r.distanceM).toBeCloseTo(0.002 * M_PER_DEG, 0);
    expect(r.alongM).toBeCloseTo(0.014 * M_PER_DEG, 0);
  });

  it('clamps to the endpoints', () => {
    const before = nearestPointOnLine(line, [-0.003, 0])!;
    expect(before.point).toEqual([0, 0]);
    expect(before.alongM).toBe(0);
    expect(before.distanceM).toBeCloseTo(0.003 * M_PER_DEG, 1);

    const after = nearestPointOnLine(line, [0.01, 0.02])!;
    expect(after.segmentIndex).toBe(1);
    expect(after.point[1]).toBeCloseTo(0.01, 9);
    expect(after.alongM).toBeCloseTo(lineLengthM(line), 3);
  });

  it('accepts precomputed cumulative lengths', () => {
    const cum = cumulativeLengthsM(line);
    expect(nearestPointOnLine(line, [0.012, 0.004], cum)).toEqual(nearestPointOnLine(line, [0.012, 0.004]));
  });

  it('handles empty, single-point and zero-length-segment lines', () => {
    expect(nearestPointOnLine([], [0, 0])).toBeNull();
    const single = nearestPointOnLine([[0, 0]], [0, 0.001])!;
    expect(single.segmentIndex).toBe(0);
    expect(single.distanceM).toBeCloseTo(0.001 * M_PER_DEG, 1);
    const dup = nearestPointOnLine(
      [
        [0, 0],
        [0, 0],
        [0.01, 0],
      ],
      [0.005, 0.001],
    )!;
    expect(dup.segmentIndex).toBe(1);
    expect(dup.alongM).toBeCloseTo(0.005 * M_PER_DEG, 1);
  });

  it('works across the antimeridian', () => {
    const r = nearestPointOnLine(
      [
        [179.99, 0],
        [-179.99, 0],
      ],
      [180, 0.001],
    )!;
    expect(Math.abs(r.point[0])).toBeCloseTo(180, 6);
    expect(r.distanceM).toBeCloseTo(0.001 * M_PER_DEG, 1);
    expect(r.alongM).toBeCloseTo(0.01 * M_PER_DEG, 1);
  });
});
