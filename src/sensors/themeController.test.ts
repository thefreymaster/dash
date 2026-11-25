import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settings, telemetry, ui } from '../state';
import { THEME_RECHECK_MS, computeTheme, startThemeController, stopThemeController } from './themeController';
import { fakeTimers, makeFix } from './testUtils';

// San Francisco: 2026-06-21 20:00 UTC is 13:00 PDT (day); 2026-06-21 08:00 UTC is 01:00 PDT (night).
const SF = { lat: 37.7955, lng: -122.3937 };
const NOON_UTC_MS = Date.UTC(2026, 5, 21, 20, 0);
const NIGHT_UTC_MS = Date.UTC(2026, 5, 21, 8, 0);

describe('computeTheme', () => {
  it('manual modes win regardless of position and time', () => {
    expect(computeTheme('day', SF, new Date(NIGHT_UTC_MS), 'night')).toBe('day');
    expect(computeTheme('night', null, new Date(NOON_UTC_MS), 'day')).toBe('night');
  });

  it('auto follows the sun at the position', () => {
    expect(computeTheme('auto', SF, new Date(NOON_UTC_MS), 'night')).toBe('day');
    expect(computeTheme('auto', SF, new Date(NIGHT_UTC_MS), 'day')).toBe('night');
  });

  it('auto keeps the current theme before any fix', () => {
    expect(computeTheme('auto', null, new Date(NIGHT_UTC_MS), 'day')).toBe('day');
    expect(computeTheme('auto', { lat: Number.NaN, lng: 0 }, new Date(NIGHT_UTC_MS), 'night')).toBe('night');
  });
});

describe('theme controller', () => {
  beforeEach(() => {
    settings.reset();
    telemetry.reset();
    ui.reset();
  });
  afterEach(() => {
    stopThemeController();
    settings.reset();
    telemetry.reset();
    ui.reset();
  });

  it('applies a manual mode immediately, before any sensor runs', () => {
    settings.set((s) => ({ ...s, themeMode: 'night' }));
    startThemeController({ now: () => NOON_UTC_MS, timers: fakeTimers() });
    expect(ui.get().resolvedTheme).toBe('night');
    settings.set((s) => ({ ...s, themeMode: 'day' }));
    expect(ui.get().resolvedTheme).toBe('day');
  });

  it('auto: waits for the first fix, then re-checks every minute', () => {
    let now = NIGHT_UTC_MS - 60_000;
    const timers = fakeTimers();
    startThemeController({ now: () => now, timers });
    expect(ui.get().resolvedTheme).toBe('day'); // no fix yet: unchanged
    telemetry.set((t) => ({ ...t, fix: makeFix({ ...SF }) }));
    expect(ui.get().resolvedTheme).toBe('night');
    now = NOON_UTC_MS;
    timers.advance(THEME_RECHECK_MS);
    expect(ui.get().resolvedTheme).toBe('day');
  });
});
