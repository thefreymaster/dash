import { describe, expect, it } from 'vitest';
import {
  MPS_TO_MPH,
  formatClock,
  formatDistance,
  formatDistanceParts,
  formatDuration,
  formatSpeed,
  kmhToMps,
  mphToMps,
  mpsToKmh,
  mpsToMph,
  speedFromMps,
  speedToMps,
  speedUnitLabel,
} from './units';

describe('speed conversion', () => {
  it('known factors', () => {
    expect(MPS_TO_MPH).toBeCloseTo(2.236936, 6);
    expect(mpsToMph(26.8224)).toBeCloseTo(60, 6); // 60 mph
    expect(mphToMps(60)).toBeCloseTo(26.8224, 6);
    expect(mpsToKmh(27.7777778)).toBeCloseTo(100, 5);
    expect(kmhToMps(36)).toBeCloseTo(10, 9);
  });
  it('round-trips through user units', () => {
    expect(speedToMps(speedFromMps(13.4, 'mph'), 'mph')).toBeCloseTo(13.4, 9);
    expect(speedToMps(speedFromMps(13.4, 'kmh'), 'kmh')).toBeCloseTo(13.4, 9);
    expect(speedUnitLabel('kmh')).toBe('km/h');
    expect(speedUnitLabel('mph')).toBe('mph');
  });
});

describe('formatSpeed', () => {
  it('rounds to an integer in the chosen unit', () => {
    expect(formatSpeed(26.8224, 'mph')).toBe('60');
    expect(formatSpeed(27.7778, 'kmh')).toBe('100');
    expect(formatSpeed(31.2, 'mph')).toBe('70'); // 69.79
  });
  it('rounding boundary at 0.5 mph', () => {
    expect(formatSpeed(mphToMps(0.49), 'mph')).toBe('0');
    expect(formatSpeed(mphToMps(0.51), 'mph')).toBe('1');
    expect(formatSpeed(kmhToMps(99.5), 'kmh')).toBe('100');
    expect(formatSpeed(kmhToMps(99.49), 'kmh')).toBe('99');
  });
  it('never shows garbage', () => {
    expect(formatSpeed(-3, 'mph')).toBe('0');
    expect(formatSpeed(Number.NaN, 'kmh')).toBe('0');
    expect(formatSpeed(Infinity, 'kmh')).toBe('0');
  });
});

describe('formatDistance (imperial)', () => {
  it('feet below 0.1 mi', () => {
    expect(formatDistance(0, 'mph')).toBe('0 ft');
    expect(formatDistance(10, 'mph')).toBe('30 ft'); // 32.8 ft → nearest 10
    expect(formatDistance(30, 'mph')).toBe('100 ft'); // 98.4 ft
    expect(formatDistance(150, 'mph')).toBe('500 ft'); // 492 ft → nearest 50
  });
  it('rolls feet over to 0.1 mi instead of showing ≥ 528 ft', () => {
    expect(formatDistance(158, 'mph')).toBe('500 ft'); // 518 ft → nearest 50
    expect(formatDistance(160.6, 'mph')).toBe('0.1 mi'); // 527 ft would round to 550 ft
  });
  it('tenths of a mile below 10 mi, whole miles above', () => {
    expect(formatDistance(160.9344, 'mph')).toBe('0.1 mi');
    expect(formatDistance(1609.344, 'mph')).toBe('1.0 mi');
    expect(formatDistance(482.8, 'mph')).toBe('0.3 mi');
    expect(formatDistance(15_990, 'mph')).toBe('9.9 mi'); // 9.936
    expect(formatDistance(16_050, 'mph')).toBe('10 mi'); // 9.973 would be "10.0"
    expect(formatDistance(40_233.6, 'mph')).toBe('25 mi');
  });
  it('splits value and unit', () => {
    expect(formatDistanceParts(1609.344 * 2.25, 'mph')).toEqual({ value: '2.3', unit: 'mi' });
  });
});

describe('formatDistance (metric)', () => {
  it('metres below 1 km, nearest 10 m', () => {
    expect(formatDistance(4, 'kmh')).toBe('0 m');
    expect(formatDistance(447, 'kmh')).toBe('450 m');
    expect(formatDistance(994, 'kmh')).toBe('990 m');
  });
  it('rolls over to km instead of "1000 m"', () => {
    expect(formatDistance(995, 'kmh')).toBe('1.0 km');
  });
  it('tenths below 10 km, whole km above', () => {
    expect(formatDistance(1234, 'kmh')).toBe('1.2 km');
    expect(formatDistance(9_960, 'kmh')).toBe('10 km');
    expect(formatDistance(12_345, 'kmh')).toBe('12 km');
  });
  it('bad input shows zero', () => {
    expect(formatDistance(Number.NaN, 'kmh')).toBe('0 m');
    expect(formatDistance(-50, 'mph')).toBe('0 ft');
  });
});

describe('formatDuration', () => {
  it('hours:minutes with padded minutes', () => {
    expect(formatDuration(23 * 60_000)).toBe('0:23');
    expect(formatDuration(65 * 60_000)).toBe('1:05');
    expect(formatDuration((26 * 60 + 10) * 60_000)).toBe('26:10');
  });
  it('truncates seconds and rejects bad input', () => {
    expect(formatDuration(59_999)).toBe('0:00');
    expect(formatDuration(60_000)).toBe('0:01');
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });
});

describe('formatClock', () => {
  it('12-hour without AM/PM', () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5), true)).toBe('9:05');
    expect(formatClock(new Date(2026, 0, 1, 0, 30), true)).toBe('12:30');
    expect(formatClock(new Date(2026, 0, 1, 12, 0), true)).toBe('12:00');
    expect(formatClock(new Date(2026, 0, 1, 13, 7), true)).toBe('1:07');
  });
  it('24-hour, zero-padded', () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5), false)).toBe('09:05');
    expect(formatClock(new Date(2026, 0, 1, 0, 0), false)).toBe('00:00');
    expect(formatClock(new Date(2026, 0, 1, 23, 59), false)).toBe('23:59');
  });
  it('defaults to the locale hour cycle', () => {
    expect(formatClock(new Date(2026, 0, 1, 15, 4))).toMatch(/^(3|15):04$/);
  });
});
