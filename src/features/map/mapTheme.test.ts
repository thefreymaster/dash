import type { Map as MapboxMap } from 'mapbox-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialTelemetry, pose, settings, telemetry } from '../../state';
import type { Fix, LightPreset } from '../../types';
import { attachMapTheme, resolveLightPreset, themePosition } from './mapTheme';

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

const resetPose = () => {
  pose.hasPose.set(false);
  pose.lat.set(0);
  pose.lng.set(0);
  telemetry.set(initialTelemetry);
};

describe('themePosition', () => {
  afterEach(resetPose);

  it('uses the fallback until there is a pose, then the pose', () => {
    expect(themePosition(LONDON)).toEqual(LONDON);
    pose.lat.set(40.7);
    pose.lng.set(-74);
    pose.hasPose.set(true);
    expect(themePosition(LONDON)).toEqual({ lat: 40.7, lng: -74 });
  });

  it('prefers the latest fix (it is written before the pose)', () => {
    telemetry.set({ ...initialTelemetry, status: 'tracking', fix: { lat: 37.8, lng: -122.4, speedMps: 0, headingDeg: null, accuracyM: 5, timestamp: 1 } });
    expect(themePosition(LONDON)).toEqual({ lat: 37.8, lng: -122.4 });
  });
});

/** A loaded Standard map that records `lightPreset` writes. */
function fakeMap(initial: LightPreset) {
  let preset: LightPreset = initial;
  const writes: LightPreset[] = [];
  const map = {
    on: () => {},
    off: () => {},
    isStyleLoaded: () => true,
    getStyle: () => ({ imports: [{ id: 'basemap' }] }),
    getConfigProperty: () => preset,
    setConfigProperty: (_importId: string, _name: string, value: LightPreset) => {
      preset = value;
      writes.push(value);
    },
  };
  return { map: map as unknown as MapboxMap, writes, preset: () => preset };
}

describe('attachMapTheme', () => {
  const SF = { lat: 37.7968, lng: -122.3954 };
  const sfFix: Fix = { ...SF, speedMps: 0, headingDeg: null, accuracyM: 5, timestamp: 1 };
  // Node has no DOM: attachMapTheme only listens for visibility changes on it.
  const stubDocument = () => vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} });
  afterEach(() => {
    resetPose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('the first pose never applies the preset for (0°, 0°) (regression: night map at midday in SF)', () => {
    stubDocument();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T19:35:00Z')); // 11:35 solar in SF; after dark at 0°E
    settings.set((s) => ({ ...s, themeMode: 'auto' }));
    expect(resolveLightPreset('auto', { lat: 0, lng: 0 }, new Date())).toBe('night');
    const { map, writes, preset } = fakeMap('day'); // the constructor's preset from the resting guess
    const detach = attachMapTheme(map, { lat: 30, lng: -75 });
    // The real pipeline order: the fix lands in telemetry, then the motion loop raises
    // `hasPose` BEFORE it writes lat/lng (a listener on `hasPose` saw 0, 0).
    telemetry.set({ ...initialTelemetry, status: 'tracking', fix: sfFix });
    pose.hasPose.set(true);
    pose.lat.set(SF.lat);
    pose.lng.set(SF.lng);
    expect(writes).not.toContain('night');
    expect(preset()).toBe('day');
    detach();
  });

  it('the first fix replaces a resting guess that was wrong (somewhere else on the globe)', () => {
    stubDocument();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T19:35:00Z'));
    settings.set((s) => ({ ...s, themeMode: 'auto' }));
    const tokyo = { lat: 35.68, lng: 139.69 }; // 04:35 there: night
    const { map, preset } = fakeMap('night');
    const detach = attachMapTheme(map, tokyo);
    expect(preset()).toBe('night');
    telemetry.set({ ...initialTelemetry, status: 'tracking', fix: sfFix });
    expect(preset()).toBe('day');
    detach();
  });
});
