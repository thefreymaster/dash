import { describe, expect, it } from 'vitest';
import { metersPerPixel } from './camera';
import { PUCK_MAX_HALO_PX, PUCK_MIN_HALO_PX, haloRadiusPx } from './puck';

describe('haloRadiusPx', () => {
  it('converts the accuracy radius to screen pixels at the current zoom', () => {
    const mpp = metersPerPixel(0, 16); // ≈ 1.19 m/px
    expect(haloRadiusPx(50, 0, 16)).toBeCloseTo(50 / mpp, 6);
    // One zoom level in doubles the radius.
    expect(haloRadiusPx(50, 0, 17)).toBeCloseTo(2 * haloRadiusPx(50, 0, 16), 6);
  });

  it('clamps to a visible minimum and a sane maximum', () => {
    expect(haloRadiusPx(3, 40, 15)).toBe(PUCK_MIN_HALO_PX);
    expect(haloRadiusPx(0, 40, 15)).toBe(PUCK_MIN_HALO_PX);
    expect(haloRadiusPx(Number.NaN, 40, 15)).toBe(PUCK_MIN_HALO_PX);
    expect(haloRadiusPx(2000, 40, 17)).toBe(PUCK_MAX_HALO_PX);
  });
});
