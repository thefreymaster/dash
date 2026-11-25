import { describe, expect, it } from 'vitest';
import type { Place } from '../types';
import {
  MAX_RECENTS,
  addRecent,
  initialSettings,
  initialUi,
  nav,
  pose,
  queryClient,
  recents,
  settings,
  telemetry,
  trip,
  ui,
} from './index';

const place = (id: string, lat = 0, lng = 0): Place => ({ id, name: `Place ${id}`, lat, lng });

describe('entries', () => {
  it('have the documented defaults and live in the shared queryClient', () => {
    expect(settings.get()).toEqual({ units: 'mph', themeMode: 'auto', demo: false });
    expect(settings.get()).toEqual(initialSettings);
    expect(ui.get()).toEqual({ phase: 'gate', following: true, resolvedTheme: 'day' });
    expect(ui.get()).toEqual(initialUi);
    expect(telemetry.get().status).toBe('idle');
    expect(nav.get()).toEqual({ destination: null, rerouteNonce: 0 });
    expect(trip.get().distanceM).toBe(0);
    expect(queryClient.getQueryData(['client', 'settings'])).toBe(settings.get());
  });

  it('persist exactly settings, trip and recents', () => {
    expect(settings.storageKey).toBe('dash:v1:settings');
    expect(trip.storageKey).toBe('dash:v1:trip');
    expect(recents.storageKey).toBe('dash:v1:recents');
    expect(telemetry.storageKey).toBeNull();
    expect(nav.storageKey).toBeNull();
    expect(ui.storageKey).toBeNull();
  });
});

describe('addRecent', () => {
  it('puts the newest first, de-duplicates by id and by position, caps the list', () => {
    recents.reset();
    for (let i = 0; i < 10; i++) addRecent(place(String(i), i, i));
    expect(recents.get()).toHaveLength(MAX_RECENTS);
    expect(recents.get()[0].id).toBe('9');

    addRecent(place('5', 5, 5));
    expect(recents.get()[0].id).toBe('5');
    expect(recents.get().filter((p) => p.id === '5')).toHaveLength(1);
    expect(recents.get()).toHaveLength(MAX_RECENTS);

    // Same coordinates under a new geocoder id replaces the old entry.
    addRecent(place('5-new', 5, 5));
    expect(recents.get().map((p) => p.id)).not.toContain('5');
    expect(recents.get()[0].id).toBe('5-new');
  });
});

describe('pose', () => {
  it('exposes Motion values that update without React', () => {
    const seen: number[] = [];
    const off = pose.speedMps.on('change', (v) => seen.push(v));
    pose.speedMps.set(12.5);
    expect(pose.speedMps.get()).toBe(12.5);
    expect(seen).toEqual([12.5]);
    off();
    pose.speedMps.set(0);
    expect(pose.hasPose.get()).toBe(false);
  });
});
