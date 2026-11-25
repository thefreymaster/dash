import { describe, expect, it } from 'vitest';
import { distanceOrder, durationOrder, integerOrder, pillShape, sinceLabel, tripSubtitle } from './format';

describe('trip display helpers', () => {
  it('orders displayed distances across unit changes', () => {
    expect(distanceOrder({ value: '520', unit: 'ft' })).toBeLessThan(distanceOrder({ value: '0.1', unit: 'mi' }));
    expect(distanceOrder({ value: '990', unit: 'm' })).toBeLessThan(distanceOrder({ value: '1.0', unit: 'km' }));
    expect(durationOrder('1:05')).toBe(65);
    expect(integerOrder('61')).toBe(61);
  });

  it('pill shape changes only with the character count or unit', () => {
    expect(pillShape(20_000, 60_000, 'mph')).toBe(pillShape(20_100, 120_000, 'mph')); // 12 mi, 0:01 → 0:02
    expect(pillShape(15_000, 60_000, 'mph')).not.toBe(pillShape(17_000, 60_000, 'mph')); // 9.3 → 11
    expect(pillShape(100, 0, 'mph')).not.toBe(pillShape(100, 0, 'kmh'));
  });

  it('labels the start time, with the weekday on another day', () => {
    const start = new Date(2026, 10, 25, 10, 19).getTime();
    expect(sinceLabel(start, start + 3600_000, false)).toBe('Since 10:19');
    expect(sinceLabel(start, start + 86_400_000, false)).toMatch(/^Since \S+ 10:19$/);
    expect(tripSubtitle(start, false, start, false)).toBe('Since 10:19 · auto-pauses when parked');
    expect(tripSubtitle(null, false, start)).toBe('Starts when you drive');
    expect(tripSubtitle(start, true, start)).toBe('Demo drive · not saved');
  });
});
