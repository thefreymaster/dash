import { describe, expect, it } from 'vitest';
import {
  ARC_LENGTH,
  FULL_SCALE,
  THREE_DIGIT_SCALE,
  UNIT_FACTOR,
  arcDasharray,
  arcOpacity,
  arcPath,
  digitScaleFor,
  gaugeFraction,
  speedDigits,
} from './gauge';

describe('arc geometry', () => {
  it('matches the mockup path', () => {
    expect(arcPath()).toBe('M39.25 146 A84 84 0 1 1 184.75 146');
  });

  it('has the 240° arc length of radius 84', () => {
    expect(ARC_LENGTH).toBeCloseTo(351.858, 2);
  });
});

describe('gaugeFraction', () => {
  it('maps the reading onto the unit scale', () => {
    expect(gaugeFraction(0, FULL_SCALE.mph)).toBe(0);
    expect(gaugeFraction(47, FULL_SCALE.mph)).toBeCloseTo(0.47);
    expect(gaugeFraction(80, FULL_SCALE.kmh)).toBeCloseTo(0.5);
  });

  it('clamps above full scale and below zero', () => {
    expect(gaugeFraction(130, 100)).toBe(1);
    expect(gaugeFraction(-5, 100)).toBe(0);
  });

  it('treats garbage as empty', () => {
    expect(gaugeFraction(Number.NaN, 100)).toBe(0);
    expect(gaugeFraction(50, 0)).toBe(0);
    expect(gaugeFraction(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });

  it('puts both unit scales at about the same real speed', () => {
    // 100 mph ≈ 44.7 m/s and 160 km/h ≈ 44.4 m/s: switching units barely moves the arc.
    const mps = 30;
    const mph = gaugeFraction(mps * UNIT_FACTOR.mph, FULL_SCALE.mph);
    const kmh = gaugeFraction(mps * UNIT_FACTOR.kmh, FULL_SCALE.kmh);
    expect(Math.abs(mph - kmh)).toBeLessThan(0.01);
  });
});

describe('arcDasharray', () => {
  it('draws the fraction of the arc length with a gap longer than the arc', () => {
    expect(arcDasharray(0)).toBe(`0.00 ${Math.ceil(ARC_LENGTH) + 10}`);
    expect(arcDasharray(0.5)).toBe(`${(ARC_LENGTH / 2).toFixed(2)} ${Math.ceil(ARC_LENGTH) + 10}`);
    const [dash, gap] = arcDasharray(1).split(' ').map(Number);
    expect(dash).toBeCloseTo(ARC_LENGTH, 1);
    expect(gap).toBeGreaterThan(ARC_LENGTH);
  });

  it('clamps', () => {
    expect(arcDasharray(2)).toBe(arcDasharray(1));
    expect(arcDasharray(-1)).toBe(arcDasharray(0));
    expect(arcDasharray(Number.NaN)).toBe(arcDasharray(0));
  });
});

describe('arcOpacity', () => {
  it('hides the round-cap dot at rest and fades in quickly', () => {
    expect(arcOpacity(0)).toBe(0);
    expect(arcOpacity(0.002)).toBe(0);
    expect(arcOpacity(0.005)).toBeCloseTo(0.5);
    expect(arcOpacity(0.008)).toBe(1);
    expect(arcOpacity(0.5)).toBe(1);
    expect(arcOpacity(Number.NaN)).toBe(0);
  });
});

describe('speedDigits', () => {
  it('rounds to an integer string', () => {
    expect(speedDigits(0, true)).toBe('0');
    expect(speedDigits(9.4, true)).toBe('9');
    expect(speedDigits(9.6, true)).toBe('10');
    expect(speedDigits(99.5, true)).toBe('100');
  });

  it('shows a dash before the first fix and 0 for nonsense', () => {
    expect(speedDigits(42, false)).toBe('–');
    expect(speedDigits(-3, true)).toBe('0');
    expect(speedDigits(Number.NaN, true)).toBe('0');
  });
});

describe('digitScaleFor', () => {
  it('shrinks only once the shown value has three digits', () => {
    expect(digitScaleFor(0)).toBe(1);
    expect(digitScaleFor(99.4)).toBe(1);
    expect(digitScaleFor(99.5)).toBe(THREE_DIGIT_SCALE);
    expect(digitScaleFor(160)).toBe(THREE_DIGIT_SCALE);
    expect(digitScaleFor(Number.NaN)).toBe(1);
  });
});
