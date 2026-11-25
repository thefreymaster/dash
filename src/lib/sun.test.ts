import { describe, expect, it } from 'vitest';
import { lightPreset, resolveTheme, sunAltitudeDeg } from './sun';

// London. Midsummer 2026: sunrise 03:43 UTC, sunset 20:21 UTC.
const LAT = 51.5074;
const LNG = -0.1278;
const at = (iso: string) => new Date(iso);

describe('resolveTheme', () => {
  it('noon is day, midnight is night', () => {
    expect(resolveTheme(LAT, LNG, at('2026-06-21T12:00:00Z'))).toBe('day');
    expect(resolveTheme(LAT, LNG, at('2026-12-21T00:00:00Z'))).toBe('night');
  });

  it('switches at sunrise and sunset', () => {
    expect(resolveTheme(LAT, LNG, at('2026-06-21T03:38:00Z'))).toBe('night');
    expect(resolveTheme(LAT, LNG, at('2026-06-21T03:48:00Z'))).toBe('day');
    expect(resolveTheme(LAT, LNG, at('2026-06-21T20:16:00Z'))).toBe('day');
    expect(resolveTheme(LAT, LNG, at('2026-06-21T20:26:00Z'))).toBe('night');
  });

  it('midnight sun in Tromsø is day', () => {
    expect(resolveTheme(69.6492, 18.9553, at('2026-06-21T22:00:00Z'))).toBe('day');
  });
});

describe('lightPreset', () => {
  it('day and night away from twilight', () => {
    expect(lightPreset(LAT, LNG, at('2026-06-21T12:00:00Z'))).toBe('day');
    expect(lightPreset(LAT, LNG, at('2026-06-21T23:00:00Z'))).toBe('night'); // sun ≈ -13°
  });

  it('dawn while rising, dusk while setting (sun ≈ -2°)', () => {
    expect(sunAltitudeDeg(LAT, LNG, at('2026-12-21T07:50:00Z'))).toBeCloseTo(-2.1, 1);
    expect(lightPreset(LAT, LNG, at('2026-12-21T07:50:00Z'))).toBe('dawn');
    expect(lightPreset(LAT, LNG, at('2026-12-21T16:10:00Z'))).toBe('dusk');
  });
});
