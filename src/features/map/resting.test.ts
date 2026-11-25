import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAST_POSITION_KEY,
  RESTING_GLOBE,
  RESTING_NEAR,
  loadLastPosition,
  parseLastPosition,
  rememberPosition,
  restingView,
  saveLastPosition,
} from './resting';

describe('restingView', () => {
  it('rests over the remembered position, heading as parked', () => {
    const v = restingView({ lng: -122.42, lat: 37.77, headingDeg: 210, savedAt: 1 }, 480);
    expect(v).toEqual({ lng: -122.42, lat: 37.77, zoom: RESTING_NEAR.zoom, pitch: RESTING_NEAR.pitch, bearing: 210 });
  });

  it('otherwise shows the globe at the time-zone meridian', () => {
    expect(restingView(null, 300)).toMatchObject({ lng: -75, lat: RESTING_GLOBE.lat, zoom: RESTING_GLOBE.zoom, pitch: 0, bearing: 0 });
    expect(restingView(null, -60).lng).toBe(15); // UTC+1
    expect(restingView(null, -840).lng).toBe(180); // UTC+14, clamped
    expect(restingView(null, Number.NaN).lng).toBe(0);
  });
});

describe('parseLastPosition', () => {
  it('accepts valid values and defaults optional fields', () => {
    expect(parseLastPosition({ lng: 1, lat: 2 })).toEqual({ lng: 1, lat: 2, headingDeg: 0, savedAt: 0 });
  });

  it('rejects anything malformed', () => {
    for (const bad of [null, 'x', 3, [], {}, { lng: 1 }, { lng: 'a', lat: 2 }, { lng: 1, lat: 91 }, { lng: 200, lat: 0 }, { lng: Number.NaN, lat: 0 }]) {
      expect(parseLastPosition(bad)).toBeNull();
    }
  });
});

describe('save / load', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips through localStorage under the dash namespace', () => {
    expect(loadLastPosition()).toBeNull();
    saveLastPosition({ lng: 2.35, lat: 48.86, headingDeg: 45, savedAt: 123 });
    expect(LAST_POSITION_KEY.startsWith('dash:v')).toBe(true);
    expect(store.has(LAST_POSITION_KEY)).toBe(true);
    expect(loadLastPosition()).toEqual({ lng: 2.35, lat: 48.86, headingDeg: 45, savedAt: 123 });
  });

  it('ignores corrupt storage', () => {
    store.set(LAST_POSITION_KEY, '{not json');
    expect(loadLastPosition()).toBeNull();
  });

  it('never remembers the demo drive as the real last position (regression: next launch rested over SF)', () => {
    const fix = { lat: 37.79, lng: -122.39, speedMps: 10, headingDeg: 0, accuracyM: 5, timestamp: 1 };
    const sf = { lng: -122.39, lat: 37.79, headingDeg: 90, savedAt: 5 };
    expect(rememberPosition(sf, { source: 'sim', fix })).toBe(false);
    expect(store.has(LAST_POSITION_KEY)).toBe(false);
    // Just switched to GPS: the pose still shows the simulated car until the first real fix.
    expect(rememberPosition(sf, { source: 'gps', fix: null })).toBe(false);
    expect(store.has(LAST_POSITION_KEY)).toBe(false);
    const home = { lng: 2.35, lat: 48.86, headingDeg: 45, savedAt: 9 };
    expect(rememberPosition(home, { source: 'gps', fix: { ...fix, lat: 48.86, lng: 2.35 } })).toBe(true);
    expect(loadLastPosition()).toEqual(home);
  });
});
