import { afterEach, describe, expect, it } from 'vitest';
import { pose } from '../../state';
import { resolveLightPreset, themePosition } from './mapTheme';

// London, midsummer 2026: sunrise 03:43 UTC, sunset 20:21 UTC (see lib/sun.test.ts).
const LONDON = { lat: 51.5074, lng: -0.1278 };
const at = (iso: string) => new Date(iso);

describe('resolveLightPreset', () => {
  it('manual day/night ignore the sun', () => {
    expect(resolveLightPreset('day', LONDON, at('2026-06-21T23:30:00Z'))).toBe('day');
    expect(resolveLightPreset('night', LONDON, at('2026-06-21T12:00:00Z'))).toBe('night');
  });

  it('auto follows the sun through all four presets', () => {
    expect(resolveLightPreset('auto', LONDON, at('2026-06-21T12:00:00Z'))).toBe('day');
    expect(resolveLightPreset('auto', LONDON, at('2026-06-21T23:30:00Z'))).toBe('night');
    expect(resolveLightPreset('auto', LONDON, at('2026-06-21T03:45:00Z'))).toBe('dawn');
    expect(resolveLightPreset('auto', LONDON, at('2026-06-21T20:20:00Z'))).toBe('dusk');
  });

  it('auto depends on where you are', () => {
    // 12:00 UTC is midday in London but the middle of the night in Sydney.
    const sydney = { lat: -33.8688, lng: 151.2093 };
    expect(resolveLightPreset('auto', sydney, at('2026-06-21T12:00:00Z'))).toBe('night');
  });
});

describe('themePosition', () => {
  afterEach(() => {
    pose.hasPose.set(false);
    pose.lat.set(0);
    pose.lng.set(0);
  });

  it('uses the fallback until there is a pose, then the pose', () => {
    expect(themePosition(LONDON)).toEqual(LONDON);
    pose.lat.set(40.7);
    pose.lng.set(-74);
    pose.hasPose.set(true);
    expect(themePosition(LONDON)).toEqual({ lat: 40.7, lng: -74 });
  });
});
