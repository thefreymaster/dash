import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings, telemetry } from '../state';
import { compassPermission } from './compass';
import { isDemo, sensorsRunning, startSensors, stopSensors } from './index';
import { stopThemeController } from './themeController';

// In the node test environment there is no geolocation, rAF, wake lock or window:
// these tests cover the orchestration, not the browser APIs (see the per-module tests).

beforeEach(() => {
  settings.reset();
  telemetry.reset();
});
afterEach(() => {
  stopSensors();
  stopThemeController();
  vi.unstubAllGlobals();
  settings.reset();
  telemetry.reset();
});

describe('startSensors / stopSensors', () => {
  it('asks for the compass permission synchronously, before anything is awaited', () => {
    const requestPermission = vi.fn(() => Promise.resolve('granted'));
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission });
    void startSensors();
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('is idempotent and never throws, reporting failures through telemetry', async () => {
    const first = startSensors();
    const second = startSensors();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(sensorsRunning()).toBe(true);
    expect(telemetry.get()).toMatchObject({ source: 'gps', status: 'unavailable' }); // no geolocation in node
    expect(compassPermission()).toBe('unsupported');
  });

  it('stopSensors resets telemetry to idle and can be called twice', async () => {
    await startSensors();
    stopSensors();
    stopSensors();
    expect(sensorsRunning()).toBe(false);
    expect(telemetry.get()).toEqual(telemetry.initial);
  });

  it('starts the simulator in demo mode and swaps sources live when the setting changes', async () => {
    settings.set((s) => ({ ...s, demo: true }));
    expect(isDemo()).toBe(true);
    await startSensors();
    expect(telemetry.get().source).toBe('sim');
    settings.set((s) => ({ ...s, demo: false }));
    expect(isDemo()).toBe(false);
    expect(telemetry.get()).toMatchObject({ source: 'gps', fix: null });
    settings.set((s) => ({ ...s, demo: true }));
    expect(telemetry.get().source).toBe('sim');
  });
});
