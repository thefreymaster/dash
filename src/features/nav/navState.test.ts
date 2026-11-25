import { afterEach, describe, expect, it } from 'vitest';
import { suggestQueryKey } from '../../api/search';
import { destinationPoint } from '../../lib';
import { initialTelemetry, telemetry } from '../../state';
import type { Fix, LngLat } from '../../types';
import { closeSearchSheet, openSearchSheet, searchOrigin, searchSession, typingLock } from './navState';

const PARKED_AT: LngLat = [-122.3937, 37.7955];
const fixAt = (p: LngLat, timestamp: number, speedMps = 0): Fix => ({ lng: p[0], lat: p[1], speedMps, headingDeg: null, accuracyM: 12, timestamp });

afterEach(() => {
  closeSearchSheet();
  telemetry.set(initialTelemetry);
});

describe('search origin', () => {
  it('is frozen when the sheet opens: GPS wander while parked does not change the suggestion key (regression)', () => {
    telemetry.set({ ...initialTelemetry, status: 'tracking', fix: fixAt(PARKED_AT, 1), speedKnown: true });
    openSearchSheet();
    const key = () => suggestQueryKey({ q: 'coit tower', sessionToken: searchSession.get(), proximity: searchOrigin.get() });
    const first = key();
    // Parked, GPS wandering by up to ~115 m over a minute.
    const liveKeys = new Set<string>();
    for (let s = 1; s <= 60; s++) {
      const p = destinationPoint(PARKED_AT, (s * 47) % 360, 40 + (s % 4) * 25);
      telemetry.set((t) => ({ ...t, fix: fixAt(p, 1 + s * 1000) }));
      expect(key()).toEqual(first);
      // What the sheet used before: the live position → a new key (= a new request) as it wanders.
      liveKeys.add(JSON.stringify(suggestQueryKey({ q: 'coit tower', sessionToken: searchSession.get(), proximity: p })));
    }
    expect(liveKeys.size).toBeGreaterThan(1);
    // The next opening searches around wherever the car is then.
    closeSearchSheet();
    telemetry.set((t) => ({ ...t, fix: fixAt(destinationPoint(PARKED_AT, 0, 2000), 99_000) }));
    openSearchSheet();
    expect(key()).not.toEqual(first);
  });

  it('opened before the first fix: adopts the first position once, then keeps it', () => {
    telemetry.set(initialTelemetry);
    openSearchSheet();
    expect(searchOrigin.get()).toBeNull();
    telemetry.set({ ...initialTelemetry, status: 'tracking', fix: fixAt(PARKED_AT, 1) });
    const adopted = searchOrigin.get();
    expect(adopted).toEqual([-122.394, 37.796]);
    telemetry.set((t) => ({ ...t, fix: fixAt(destinationPoint(PARKED_AT, 90, 300), 2000) }));
    expect(searchOrigin.get()).toBe(adopted);
  });
});

describe('typingLock entry', () => {
  it('follows telemetry for the whole session, sheet open or not', () => {
    telemetry.set({ ...initialTelemetry, status: 'tracking', fix: fixAt(PARKED_AT, 1, 15), speedMps: 15, speedKnown: true });
    expect(typingLock.get()).toMatchObject({ allowed: false, reason: 'moving', seenMoving: true });
    telemetry.set((t) => ({ ...t, fix: fixAt(PARKED_AT, 2), speedMps: 0, speedKnown: false }));
    expect(typingLock.get()).toMatchObject({ allowed: false, reason: 'no-speed' });
    telemetry.set((t) => ({ ...t, fix: fixAt(PARKED_AT, 3), speedMps: 0, speedKnown: true }));
    expect(typingLock.get()).toMatchObject({ allowed: true, reason: 'parked' });
  });
});
