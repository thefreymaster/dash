import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destinationPoint } from '../../lib';
import { initialTelemetry, initialTrip, telemetry, trip } from '../../state';
import type { Fix, Telemetry } from '../../types';
import { isTripRecorderRunning, startTripRecorder, stopTripRecorder } from './recorder';
import { resetShownTrip, simTrip } from './state';

const T0 = Date.UTC(2026, 10, 25, 17, 0, 0);
const ORIGIN: [number, number] = [-122.3937, 37.7955];

/** Minimal Storage that counts writes per key. */
function fakeStorage() {
  const data = new Map<string, string>();
  const writes = new Map<string, number>();
  return {
    writes: (key: string) => writes.get(key) ?? 0,
    clearCounts: () => writes.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
      writes.set(k, (writes.get(k) ?? 0) + 1);
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
}

function fixAlong(metres: number, seconds: number, speedMps: number, eastM = 0): Fix {
  let p = destinationPoint(ORIGIN, 0, metres);
  if (eastM) p = destinationPoint(p, 90, eastM);
  return { lat: p[1], lng: p[0], speedMps, headingDeg: null, accuracyM: 5, timestamp: T0 + seconds * 1000 };
}

function feed(source: Telemetry['source'], fix: Fix | null) {
  telemetry.set((t) => ({ ...t, source, status: 'tracking', fix, speedMps: fix?.speedMps ?? 0 }));
}

/** Drive `seconds` at `speed` from `startM`, one fix per second starting at `startS`. */
function drive(source: Telemetry['source'], startS: number, seconds: number, speed: number, startM = 0) {
  for (let i = 0; i <= seconds; i++) feed(source, fixAlong(startM + i * speed, startS + i, speed));
}

const TRIP_KEY = 'dash:v1:trip';
let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  stopTripRecorder();
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
  telemetry.set(initialTelemetry);
  trip.reset();
  simTrip.reset();
  storage.clearCounts();
});

afterEach(() => {
  stopTripRecorder();
  vi.unstubAllGlobals();
});

describe('trip recorder', () => {
  it('records GPS fixes into the persisted trip, one write per moving fix at most', () => {
    startTripRecorder();
    drive('gps', 0, 30, 10);
    expect(trip.get().distanceM).toBeCloseTo(300, 0);
    expect(trip.get().movingMs).toBe(30_000);
    expect(storage.writes(TRIP_KEY)).toBe(30);
    expect(JSON.parse(storage.getItem(TRIP_KEY)!).distanceM).toBeCloseTo(300, 0);
  });

  it('does not write while parked or for telemetry changes that are not new fixes', () => {
    startTripRecorder();
    for (let i = 0; i < 60; i++) feed('gps', fixAlong(0, i, 0.1, (i % 3) - 1));
    telemetry.set((t) => ({ ...t, compassDeg: 123 }));
    telemetry.set((t) => ({ ...t, status: 'stale' }));
    expect(storage.writes(TRIP_KEY)).toBe(0);
    expect(trip.get()).toEqual(initialTrip);
  });

  it('records the demo drive into the in-memory trip and leaves the persisted one untouched', () => {
    trip.set({ ...initialTrip, distanceM: 4321, movingMs: 600_000, startedAt: T0 - 1e6, lastMovedAt: T0 - 1000 });
    const stored = storage.getItem(TRIP_KEY);
    storage.clearCounts();
    startTripRecorder();
    drive('sim', 0, 40, 12);
    expect(simTrip.get().distanceM).toBeCloseTo(480, 0);
    expect(trip.get().distanceM).toBe(4321);
    expect(storage.writes(TRIP_KEY)).toBe(0);
    expect(storage.getItem(TRIP_KEY)).toBe(stored);
    expect(simTrip.storageKey).toBeNull();
  });

  it('never measures a segment across a source switch or a source restart', () => {
    startTripRecorder();
    drive('gps', 0, 10, 10);
    const real = trip.get().distanceM;
    // Demo starts: the first sim fix is 2 km away, one second later.
    feed('sim', null);
    drive('sim', 11, 5, 10, 2000);
    expect(trip.get().distanceM).toBe(real);
    expect(simTrip.get().distanceM).toBeCloseTo(50, 0);
    // Back to GPS near where the real drive stopped: no segment from the sim position.
    feed('gps', null);
    drive('gps', 20, 5, 10, 100);
    expect(trip.get().distanceM).toBeCloseTo(real + 50, 0);
  });

  it('subscribes once, however often it is started', () => {
    startTripRecorder();
    startTripRecorder();
    expect(isTripRecorderRunning()).toBe(true);
    drive('gps', 0, 10, 10);
    expect(trip.get().distanceM).toBeCloseTo(100, 0);
    stopTripRecorder();
    stopTripRecorder();
    expect(isTripRecorderRunning()).toBe(false);
    drive('gps', 11, 10, 10, 110);
    expect(trip.get().distanceM).toBeCloseTo(100, 0);
  });

  it('stops a recorder left behind by a previous copy of the module (hot reload)', () => {
    const stale = vi.fn();
    (globalThis as Record<symbol, unknown>)[Symbol.for('dash.tripRecorder.stop')] = stale;
    startTripRecorder();
    expect(stale).toHaveBeenCalledTimes(1);
    stopTripRecorder();
    expect((globalThis as Record<symbol, unknown>)[Symbol.for('dash.tripRecorder.stop')]).toBeUndefined();
  });
});

describe('resetShownTrip', () => {
  it('resets the demo trip while demo driving, the real one otherwise', () => {
    trip.set({ ...initialTrip, distanceM: 10 });
    simTrip.set({ ...initialTrip, distanceM: 20 });
    feed('sim', null);
    resetShownTrip();
    expect(simTrip.get().distanceM).toBe(0);
    expect(trip.get().distanceM).toBe(10);
    feed('gps', null);
    resetShownTrip();
    expect(trip.get()).toEqual(initialTrip);
  });
});
