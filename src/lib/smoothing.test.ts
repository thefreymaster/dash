import { describe, expect, it } from 'vitest';
import { damp, dampAngleDeg, lambdaFromHalfLife } from './smoothing';

describe('damp', () => {
  it('halves the gap after one half-life', () => {
    const lambda = lambdaFromHalfLife(0.5);
    expect(damp(0, 100, lambda, 0.5)).toBeCloseTo(50, 9);
    expect(damp(0, 100, lambda, 1)).toBeCloseTo(75, 9);
  });

  it('is frame-rate independent', () => {
    const lambda = 6;
    let at60 = 0;
    for (let i = 0; i < 60; i++) at60 = damp(at60, 80, lambda, 1 / 60);
    let at144 = 0;
    for (let i = 0; i < 144; i++) at144 = damp(at144, 80, lambda, 1 / 144);
    const once = damp(0, 80, lambda, 1);
    expect(at60).toBeCloseTo(once, 9);
    expect(at144).toBeCloseTo(once, 9);
  });

  it('handles zero/negative dt, huge dt and non-finite current', () => {
    expect(damp(10, 20, 5, 0)).toBe(10);
    expect(damp(10, 20, 5, -1)).toBe(10);
    expect(damp(10, 20, 5, 1e6)).toBeCloseTo(20, 9);
    expect(damp(Number.NaN, 20, 5, 0.016)).toBe(20);
  });
});

describe('dampAngleDeg', () => {
  it('goes the short way across north', () => {
    const lambda = lambdaFromHalfLife(1);
    expect(dampAngleDeg(350, 10, lambda, 1)).toBeCloseTo(0, 9);
    expect(dampAngleDeg(10, 350, lambda, 1)).toBeCloseTo(0, 9);
    const quarter = dampAngleDeg(340, 20, lambda, 2); // 75 % of +40°
    expect(quarter).toBeCloseTo(10, 9);
  });

  it('stays normalised and is frame-rate independent', () => {
    let a = 355;
    for (let i = 0; i < 120; i++) {
      a = dampAngleDeg(a, 25, 3, 1 / 120);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(360);
    }
    expect(a).toBeCloseTo(dampAngleDeg(355, 25, 3, 1), 9);
  });

  it('dt ≤ 0 returns the (normalised) current angle', () => {
    expect(dampAngleDeg(-10, 90, 5, 0)).toBe(350);
  });
});
