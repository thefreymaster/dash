import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destinationPoint } from '../lib';
import { telemetry } from '../state';
import {
  MAX_DERIVE_ACCURACY_M,
  PERMISSION_DENIED,
  POSITION_UNAVAILABLE,
  SPEED_STALE_AFTER_MS,
  STALE_AFTER_MS,
  TIMEOUT,
  UNKNOWN_ACCURACY_M,
  applyFix,
  checkStale,
  deriveSpeedMps,
  estimateMotion,
  expireTelemetry,
  ingestFix,
  ingestPositionError,
  isNewerFix,
  normalizeFix,
  resetForSource,
  startGeolocation,
  startStaleWatch,
  staleStatus,
  statusForError,
  stopGeolocation,
  stopStaleWatch,
} from './geolocation';
import { fakeDoc, fakeTimers, makeFix } from './testUtils';

/** A fix `metres` north of `from`, `seconds` later. */
function moved(from: ReturnType<typeof makeFix>, metres: number, seconds: number, extra = {}) {
  const [lng, lat] = destinationPoint([from.lng, from.lat], 0, metres);
  return makeFix({ lat, lng, timestamp: from.timestamp + seconds * 1000, ...extra });
}

const raw = (coords: Partial<GeolocationCoordinates>, timestamp = 5_000) => ({
  coords: { latitude: 37.79, longitude: -122.39, accuracy: 5, speed: null, heading: null, ...coords },
  timestamp,
});

describe('normalizeFix', () => {
  it('maps coordinates and keeps valid speed/heading', () => {
    expect(normalizeFix(raw({ speed: 12.5, heading: 370 }), 0)).toEqual({
      lat: 37.79,
      lng: -122.39,
      speedMps: 12.5,
      headingDeg: 10,
      accuracyM: 5,
      timestamp: 5_000,
    });
  });

  it('turns iOS "invalid" values (null, NaN, -1) into null', () => {
    for (const bad of [null, Number.NaN, -1]) {
      const fix = normalizeFix(raw({ speed: bad, heading: bad }), 0)!;
      expect(fix.speedMps).toBeNull();
      expect(fix.headingDeg).toBeNull();
    }
  });

  it('rejects unusable coordinates and patches accuracy/timestamp', () => {
    expect(normalizeFix(raw({ latitude: Number.NaN }), 0)).toBeNull();
    expect(normalizeFix(raw({ longitude: 200 }), 0)).toBeNull();
    const fix = normalizeFix({ ...raw({ accuracy: Number.NaN }), timestamp: Number.NaN }, 42)!;
    expect(fix.accuracyM).toBe(UNKNOWN_ACCURACY_M);
    expect(fix.timestamp).toBe(42);
  });
});

describe('deriveSpeedMps', () => {
  const a = makeFix({ timestamp: 10_000 });

  it('is distance over time', () => {
    expect(deriveSpeedMps(a, moved(a, 20, 2))).toBeCloseTo(10, 3);
  });

  it('ignores pairs too close or too far apart in time', () => {
    expect(deriveSpeedMps(a, moved(a, 5, 0.3))).toBeNull();
    expect(deriveSpeedMps(a, moved(a, 100, 8))).toBeNull();
    expect(deriveSpeedMps(null, a)).toBeNull();
  });

  it('ignores inaccurate fixes and implausible jumps', () => {
    expect(deriveSpeedMps(a, moved(a, 20, 2, { accuracyM: MAX_DERIVE_ACCURACY_M + 1 }))).toBeNull();
    expect(deriveSpeedMps(a, moved(a, 500, 1))).toBeNull();
  });
});

describe('estimateMotion', () => {
  const a = makeFix({ timestamp: 10_000 });
  const UNKNOWN = { speedMps: 0, headingDeg: null, speedKnown: false };

  it('prefers the device speed and heading', () => {
    expect(estimateMotion(a, moved(a, 20, 1, { speedMps: 15, headingDeg: 90 }))).toEqual({
      speedMps: 15,
      headingDeg: 90,
      speedKnown: true,
    });
  });

  it('derives speed and course when the device gives none', () => {
    const est = estimateMotion(a, moved(a, 10, 1));
    expect(est.speedMps).toBeCloseTo(10, 3);
    expect(est.headingDeg).toBeCloseTo(0, 3);
    expect(est.speedKnown).toBe(true);
  });

  it('clamps a crawling device speed to a known 0 and drops the heading at a stop', () => {
    expect(estimateMotion(a, moved(a, 0.2, 1, { speedMps: 0.4, headingDeg: 123 }))).toEqual({
      speedMps: 0,
      headingDeg: null,
      speedKnown: true,
    });
  });

  it('is unknown — not 0 — when the device gives no speed and none can be derived', () => {
    expect(estimateMotion(null, a)).toEqual(UNKNOWN);
    // A tiny move between accurate fixes: could be parked, could be 5 m/s — we cannot tell.
    expect(estimateMotion(a, moved(a, 0.3, 1))).toEqual(UNKNOWN);
  });

  it('keeps device speed but has no course when the heading is missing and not derivable', () => {
    expect(estimateMotion(null, makeFix({ speedMps: 8 }))).toEqual({ speedMps: 8, headingDeg: null, speedKnown: true });
  });

  // Regression (review): two null-speed fixes 12 m apart with 20 m accuracy derived 12 m/s
  // (27 mph) while parked in a garage — moving the puck and flipping the map.
  it('no phantom speed from position jitter: displacement within the accuracy is unknown, not motion', () => {
    const p = makeFix({ accuracyM: 20, timestamp: 10_000 });
    const jitter = moved(p, 12, 1, { accuracyM: 20 });
    expect(deriveSpeedMps(p, jitter)).toBeNull();
    expect(estimateMotion(p, jitter)).toEqual(UNKNOWN);
    // The course is not derived from noise either, even when the device gives a speed.
    expect(estimateMotion(p, moved(p, 12, 1, { accuracyM: 20, speedMps: 6 }))).toEqual({
      speedMps: 6,
      headingDeg: null,
      speedKnown: true,
    });
    // Clearly beyond the noise: real motion.
    const est = estimateMotion(p, moved(p, 30, 1, { accuracyM: 20 }));
    expect(est.speedKnown).toBe(true);
    expect(est.speedMps).toBeCloseTo(30, 3);
    expect(est.headingDeg).toBeCloseTo(0, 3);
  });
});

describe('speed validity over time (expireTelemetry / checkStale)', () => {
  const T0 = 1_700_000_000_000;
  const cruising = makeFix({ speedMps: 29, headingDeg: 90, accuracyM: 5, timestamp: T0 });

  beforeEach(() => resetForSource('gps', 'requesting'));
  afterEach(() => telemetry.reset());

  // Regression (review): after signal loss `telemetry.speedMps` kept the last value forever
  // (tunnel → the big digits still read 65); `checkStale` only changed the status.
  it('the speed expires ~3 s after the last fix, before the status goes stale', () => {
    ingestFix(cruising, T0);
    expect(telemetry.get()).toMatchObject({ status: 'tracking', speedMps: 29, speedKnown: true });

    checkStale(T0 + SPEED_STALE_AFTER_MS - 1);
    expect(telemetry.get()).toMatchObject({ speedMps: 29, speedKnown: true });

    checkStale(T0 + SPEED_STALE_AFTER_MS);
    expect(telemetry.get()).toMatchObject({ status: 'tracking', speedMps: 0, speedKnown: false });

    checkStale(T0 + 120_000);
    expect(telemetry.get()).toMatchObject({ status: 'stale', speedMps: 0, speedKnown: false });

    // Recovery: the next fix with a speed makes it known again.
    ingestFix({ ...cruising, timestamp: T0 + 121_000 }, T0 + 121_000);
    expect(telemetry.get()).toMatchObject({ status: 'tracking', speedMps: 29, speedKnown: true });
  });

  it('a position error that leaves `tracking` drops the speed at once', () => {
    ingestFix(cruising, T0);
    ingestPositionError(POSITION_UNAVAILABLE);
    expect(telemetry.get()).toMatchObject({ status: 'stale', speedMps: 0, speedKnown: false });
  });

  it('expireTelemetry is pure and returns the same object when nothing changes', () => {
    const t = { ...telemetry.initial, status: 'tracking' as const, fix: cruising, speedMps: 29, speedKnown: true };
    expect(expireTelemetry(t, T0, T0 + 1_000)).toBe(t);
    expect(expireTelemetry(t, null, T0 + 60_000)).toBe(t);
    expect(expireTelemetry(t, T0, T0 + SPEED_STALE_AFTER_MS)).toMatchObject({ speedKnown: false, speedMps: 0 });
    const lost = { ...t, status: 'stale' as const, speedKnown: false, speedMps: 0 };
    expect(expireTelemetry(lost, T0, T0 + 60_000)).toBe(lost);
  });

  it('starts unknown, and a source reset makes it unknown again', () => {
    expect(telemetry.initial.speedKnown).toBe(false);
    ingestFix(cruising, T0);
    resetForSource('sim');
    expect(telemetry.get()).toMatchObject({ speedKnown: false, speedMps: 0, fix: null });
  });
});

describe('ordering and status', () => {
  it('accepts only newer fixes, unless the clock jumped back a lot', () => {
    const a = makeFix({ timestamp: 100_000 });
    expect(isNewerFix(null, a)).toBe(true);
    expect(isNewerFix(a, makeFix({ timestamp: 101_000 }))).toBe(true);
    expect(isNewerFix(a, makeFix({ timestamp: 100_000 }))).toBe(false);
    expect(isNewerFix(a, makeFix({ timestamp: 99_000 }))).toBe(false);
    expect(isNewerFix(a, makeFix({ timestamp: 10_000 }))).toBe(true);
  });

  it('applyFix moves to tracking and returns the same object for stale fixes', () => {
    const t = { ...telemetry.initial, status: 'requesting' as const };
    const fix = makeFix({ timestamp: 1_000, speedMps: 3, headingDeg: 45 });
    const next = applyFix(t, fix);
    expect(next).toMatchObject({ status: 'tracking', fix, speedMps: 3, headingDeg: 45 });
    expect(applyFix(next, makeFix({ timestamp: 1_000 }))).toBe(next);
  });

  it('goes stale after 5 s without a fix, only from tracking', () => {
    expect(staleStatus('tracking', 0, STALE_AFTER_MS - 1)).toBe('tracking');
    expect(staleStatus('tracking', 0, STALE_AFTER_MS)).toBe('stale');
    expect(staleStatus('denied', 0, 60_000)).toBe('denied');
    expect(staleStatus('tracking', null, 60_000)).toBe('tracking');
  });

  it('maps error codes to statuses', () => {
    expect(statusForError(PERMISSION_DENIED, true, 'tracking')).toBe('denied');
    expect(statusForError(POSITION_UNAVAILABLE, false, 'requesting')).toBe('unavailable');
    expect(statusForError(POSITION_UNAVAILABLE, true, 'tracking')).toBe('stale');
    expect(statusForError(TIMEOUT, false, 'requesting')).toBe('requesting');
    expect(statusForError(99, true, 'tracking')).toBe('tracking');
  });
});

describe('GPS watcher (fake geolocation)', () => {
  type Success = (p: ReturnType<typeof raw>) => void;
  type Failure = (e: { code: number }) => void;
  let watches: Map<number, { ok: Success; fail: Failure; options?: PositionOptions }>;
  let nextId: number;
  let clock: number;
  const geo = {
    watchPosition(ok: Success, fail: Failure, options?: PositionOptions) {
      const id = nextId++;
      watches.set(id, { ok, fail, options });
      return id;
    },
    clearWatch(id: number) {
      watches.delete(id);
    },
  } as unknown as Pick<Geolocation, 'watchPosition' | 'clearWatch'>;
  const active = () => [...watches.values()][0];

  beforeEach(() => {
    watches = new Map();
    nextId = 1;
    clock = 1_000_000;
    telemetry.reset();
  });
  afterEach(() => {
    stopGeolocation();
    stopStaleWatch();
    telemetry.reset();
  });

  it('requesting → tracking → stale → tracking, with high-accuracy options', () => {
    const timers = fakeTimers(clock);
    startGeolocation({ geolocation: geo, doc: null, now: timers.now });
    startStaleWatch(timers);
    expect(telemetry.get()).toMatchObject({ status: 'requesting', source: 'gps' });
    expect(active().options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });

    active().ok(raw({ speed: 10, heading: 90 }, timers.now()));
    expect(telemetry.get()).toMatchObject({ status: 'tracking', speedMps: 10, headingDeg: 90 });

    timers.advance(STALE_AFTER_MS + 1_000);
    expect(telemetry.get().status).toBe('stale');

    active().ok(raw({ speed: 10, heading: 90, latitude: 37.7901 }, timers.now()));
    expect(telemetry.get().status).toBe('tracking');
  });

  it('reports denied and unavailable from error codes', () => {
    startGeolocation({ geolocation: geo, doc: null });
    active().fail({ code: POSITION_UNAVAILABLE });
    expect(telemetry.get().status).toBe('unavailable');
    active().fail({ code: PERMISSION_DENIED });
    expect(telemetry.get().status).toBe('denied');
  });

  it('is unavailable without geolocation support', () => {
    startGeolocation({ geolocation: null, doc: null });
    expect(telemetry.get().status).toBe('unavailable');
  });

  it('restarts the watch when the page becomes visible again, and stops cleanly', () => {
    const doc = fakeDoc();
    startGeolocation({ geolocation: geo, doc });
    const first = [...watches.keys()];
    doc.setVisible(false);
    expect([...watches.keys()]).toEqual(first);
    doc.setVisible(true);
    expect(watches.size).toBe(1);
    expect([...watches.keys()]).not.toEqual(first);
    stopGeolocation();
    expect(watches.size).toBe(0);
    expect(doc.listenerCount('visibilitychange')).toBe(0);
  });

  it('derives speed from consecutive fixes when iOS gives none', () => {
    startGeolocation({ geolocation: geo, doc: null });
    const a = makeFix({ timestamp: 10_000 });
    const b = moved(a, 15, 1);
    active().ok(raw({ latitude: a.lat, longitude: a.lng }, a.timestamp));
    active().ok(raw({ latitude: b.lat, longitude: b.lng }, b.timestamp));
    expect(telemetry.get().speedMps).toBeCloseTo(15, 2);
    expect(telemetry.get().headingDeg).toBeCloseTo(0, 2);
    expect(telemetry.get().speedKnown).toBe(true);
  });

  it('parked in a garage on jittery Wi-Fi fixes: speed unknown, not 27 mph', () => {
    startGeolocation({ geolocation: geo, doc: null });
    const a = makeFix({ timestamp: 10_000 });
    const b = moved(a, 12, 1);
    active().ok(raw({ latitude: a.lat, longitude: a.lng, accuracy: 20 }, a.timestamp));
    active().ok(raw({ latitude: b.lat, longitude: b.lng, accuracy: 20 }, b.timestamp));
    expect(telemetry.get()).toMatchObject({ status: 'tracking', speedMps: 0, speedKnown: false, headingDeg: null });
  });

  it('ingestFix ignores duplicates; checkStale uses receipt time', () => {
    telemetry.set({ ...telemetry.get(), status: 'requesting' });
    expect(ingestFix(makeFix({ timestamp: 5 }), 1_000)).toBe(true);
    expect(ingestFix(makeFix({ timestamp: 5 }), 2_000)).toBe(false);
    checkStale(1_000 + STALE_AFTER_MS - 1);
    expect(telemetry.get().status).toBe('tracking');
    checkStale(1_000 + STALE_AFTER_MS);
    expect(telemetry.get().status).toBe('stale');
  });
});
