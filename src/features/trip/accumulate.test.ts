import { describe, expect, it } from 'vitest';
import { destinationPoint, haversineM } from '../../lib';
import { initialTrip } from '../../state';
import type { Fix, LngLat, Trip } from '../../types';
import {
  IDLE_RESET_MS,
  MAX_ACCURACY_M,
  MAX_GAP_MS,
  accumulateTrip,
  averageSpeedMps,
  classifySegment,
  stepTrip,
  type SegmentKind,
} from './accumulate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T0 = Date.UTC(2026, 10, 25, 17, 0, 0);
const ORIGIN: LngLat = [-122.3937, 37.7955];

/** Deterministic [0, 1) noise (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Point `alongM` north of ORIGIN, shifted `eastM` east and `northM` further north. */
function point(alongM: number, eastM = 0, northM = 0): LngLat {
  const p = destinationPoint(ORIGIN, 0, alongM + northM);
  return eastM === 0 ? p : destinationPoint(p, eastM > 0 ? 90 : 270, Math.abs(eastM));
}

function fixAt(p: LngLat, timestamp: number, extra: Partial<Fix> = {}): Fix {
  return { lat: p[1], lng: p[0], speedMps: null, headingDeg: null, accuracyM: 5, timestamp, ...extra };
}

interface StepOptions {
  /** Reported accuracy, m. */
  acc?: number;
  /** Uniform position noise on each axis, ± m. */
  noiseM?: number;
  /** Report the device speed (default true). */
  device?: boolean;
}

/** Builds a 1 Hz fix stream along a road running north from ORIGIN. */
class Drive {
  fixes: Fix[] = [];
  t = T0;
  along = 0;
  /** True distance travelled, m. */
  truth = 0;
  private rand: () => number;

  constructor(seed = 1, first: StepOptions & { speed?: number } = {}) {
    this.rand = rng(seed);
    this.push(first.speed ?? 0, first);
  }

  private push(speed: number, o: StepOptions = {}, at = this.along) {
    const n = o.noiseM ?? 0;
    const p = point(at, (this.rand() * 2 - 1) * n, (this.rand() * 2 - 1) * n);
    this.fixes.push(fixAt(p, this.t, { accuracyM: o.acc ?? 5, speedMps: o.device === false ? null : speed }));
  }

  /** Drive at a constant speed for `seconds` (one fix per second). */
  cruise(speedMps: number, seconds: number, o: StepOptions = {}) {
    for (let i = 0; i < seconds; i++) {
      this.t += 1000;
      this.along += speedMps;
      this.truth += speedMps;
      this.push(speedMps, o);
    }
    return this;
  }

  /** Sit still for `seconds`; positions wander inside `wanderM`, the device reports ≤ `speedNoise`. */
  park(seconds: number, o: StepOptions & { wanderM?: number; speedNoise?: number } = {}) {
    for (let i = 0; i < seconds; i++) {
      this.t += 1000;
      const speed = this.rand() * (o.speedNoise ?? 0.3);
      this.push(speed, { ...o, noiseM: o.wanderM ?? 0 });
    }
    return this;
  }

  /** No fixes for `seconds` while the car keeps going at `speedMps` (backgrounded, tunnel). */
  gap(seconds: number, speedMps: number) {
    this.t += seconds * 1000;
    this.along += speedMps * seconds;
    this.truth += speedMps * seconds;
    return this;
  }

  /** Append an arbitrary fix one second later without moving the car (a glitch). */
  glitch(eastM: number, extra: Partial<Fix> = {}) {
    this.t += 1000;
    this.fixes.push(fixAt(point(this.along, eastM), this.t, extra));
    return this;
  }
}

/** Run fixes through the reducer exactly as the recorder does. */
function replay(fixes: readonly Fix[], start: Trip = initialTrip) {
  let trip = start;
  let anchor: Fix | null = null;
  const kinds: SegmentKind[] = [];
  let changes = 0;
  for (const f of fixes) {
    const step = stepTrip(trip, anchor, f);
    if (step.trip !== trip) changes++;
    trip = step.trip;
    anchor = step.anchor;
    kinds.push(step.kind);
  }
  return { trip, kinds, changes };
}

const count = (kinds: SegmentKind[], kind: SegmentKind) => kinds.filter((k) => k === kind).length;

// ---------------------------------------------------------------------------

describe('steady driving', () => {
  it('measures a known 10 km straight road exactly', () => {
    const d = new Drive().cruise(25, 400);
    const { trip, kinds } = replay(d.fixes);
    const known = haversineM(point(0), point(10_000));
    expect(known).toBeCloseTo(10_000, 3);
    expect(trip.distanceM).toBeCloseTo(known, 1);
    expect(trip.movingMs).toBe(400_000);
    expect(averageSpeedMps(trip)).toBeCloseTo(25, 3);
    expect(trip.maxSpeedMps).toBe(25);
    expect(trip.startedAt).toBe(T0);
    expect(trip.lastMovedAt).toBe(T0 + 400_000);
    expect(count(kinds, 'moving')).toBe(400);
  });

  it('stays within 0.5 % of the truth with realistic position noise', () => {
    const d = new Drive(7).cruise(25, 400, { noiseM: 2, acc: 5 });
    const { trip } = replay(d.fixes);
    expect(Math.abs(trip.distanceM - d.truth) / d.truth).toBeLessThan(0.005);
    expect(trip.movingMs).toBe(400_000);
  });

  it('counts slow creeping once it clears the noise, without losing time', () => {
    // 1.5 m/s with 10 m accuracy: each 1.5 m step is inside the 5 m noise floor.
    const d = new Drive(3, { acc: 10 }).cruise(1.5, 120, { acc: 10 });
    const { trip, kinds } = replay(d.fixes);
    expect(count(kinds, 'creep')).toBeGreaterThan(0);
    expect(trip.distanceM).toBeGreaterThan(d.truth - 6);
    expect(trip.distanceM).toBeLessThanOrEqual(d.truth + 0.01);
    expect(trip.movingMs).toBeGreaterThan(115_000);
    expect(trip.movingMs).toBeLessThanOrEqual(120_000);
  });

  it('works from positions alone when the device reports no speed', () => {
    const d = new Drive(5).cruise(15, 120, { device: false, noiseM: 1 });
    const { trip } = replay(d.fixes);
    expect(Math.abs(trip.distanceM - d.truth) / d.truth).toBeLessThan(0.01);
    expect(trip.movingMs).toBeGreaterThanOrEqual(118_000);
    expect(trip.maxSpeedMps).toBe(0); // max comes from device speeds only
  });
});

describe('stop-and-go', () => {
  it('auto-pauses at stops: no distance or time while waiting', () => {
    const d = new Drive(11)
      .cruise(10, 60)
      .park(45, { wanderM: 2, speedNoise: 0.4 })
      .cruise(12, 60)
      .park(20, { wanderM: 3 })
      .cruise(8, 30);
    const { trip } = replay(d.fixes);
    expect(d.truth).toBe(600 + 720 + 240);
    expect(Math.abs(trip.distanceM - d.truth)).toBeLessThan(10);
    expect(trip.movingMs).toBeGreaterThanOrEqual(148_000);
    expect(trip.movingMs).toBeLessThanOrEqual(150_000);
    expect(averageSpeedMps(trip)).toBeCloseTo(d.truth / 150, 0);
    expect(trip.maxSpeedMps).toBe(12);
  });
});

describe('parked', () => {
  it('adds nothing for an hour of GPS wander (device speed ~0)', () => {
    const d = new Drive(21).park(3600, { wanderM: 8, acc: 8, speedNoise: 0.45 });
    const { trip, changes } = replay(d.fixes);
    expect(trip).toBe(initialTrip);
    expect(changes).toBe(0);
  });

  it('adds nothing for wander inside the accuracy radius when no speed is reported', () => {
    const d = new Drive(22, { acc: 10, device: false }).park(3600, { wanderM: 3.5, acc: 10, device: false });
    const { trip } = replay(d.fixes);
    expect(trip).toBe(initialTrip);
  });

  it('ignores big jumps from poor fixes in a garage', () => {
    const d = new Drive(23).park(600, { wanderM: 60, acc: 65, speedNoise: 0 });
    const { trip, kinds } = replay(d.fixes);
    expect(trip).toBe(initialTrip);
    expect(count(kinds, 'inaccurate')).toBe(600);
  });

  it('keeps the trip object (no write) when nothing changes', () => {
    const a = fixAt(point(0), T0, { speedMps: 0 });
    const b = fixAt(point(0, 2), T0 + 1000, { speedMps: 0.2 });
    const t: Trip = { ...initialTrip, distanceM: 1234, movingMs: 99_000, startedAt: T0 - 1e6, lastMovedAt: T0 - 5000 };
    expect(accumulateTrip(t, a, b)).toBe(t);
    expect(accumulateTrip(t, null, b)).toBe(t);
  });
});

describe('gaps', () => {
  it('does not draw a straight line across a 5-minute gap', () => {
    const d = new Drive(31).cruise(20, 60).gap(300, 20).cruise(20, 60);
    const { trip, kinds } = replay(d.fixes);
    expect(kinds).toContain('gap');
    expect(trip.distanceM).toBeCloseTo(2400 - 20, 0); // the first fix after the gap only re-anchors
    expect(trip.movingMs).toBe(119_000);
  });

  it(`bridges a short tunnel (≤ ${MAX_GAP_MS / 1000} s) between accurate fixes`, () => {
    const d = new Drive(32).cruise(20, 30).gap(10, 20).cruise(20, 30);
    const { trip } = replay(d.fixes);
    expect(trip.distanceM).toBeCloseTo(d.truth, 3);
    expect(trip.movingMs).toBe(70_000);
  });

  it('treats duplicates and a clock going backwards as a gap', () => {
    const a = fixAt(point(0), T0, { speedMps: 10 });
    expect(classifySegment(a, fixAt(point(10), T0, { speedMps: 10 })).kind).toBe('gap');
    expect(classifySegment(a, fixAt(point(10), T0 - 120_000, { speedMps: 10 })).kind).toBe('gap');
    expect(accumulateTrip(initialTrip, a, fixAt(point(10), T0, { speedMps: 10 }))).toBe(initialTrip);
  });
});

describe('position jumps', () => {
  it('rejects a teleport and resumes from the new position', () => {
    const d = new Drive(41).cruise(20, 30);
    d.glitch(5000, { speedMps: 20 });
    d.cruise(20, 30);
    const { trip, kinds } = replay(d.fixes);
    expect(count(kinds, 'jump')).toBe(2); // out and back
    expect(trip.distanceM).toBeLessThan(d.truth);
    expect(trip.distanceM).toBeGreaterThan(d.truth - 2 * 20 - 1);
  });

  it('rejects a plausible-speed glitch that contradicts the reported speed', () => {
    const d = new Drive(42).cruise(20, 30);
    d.glitch(60, { speedMps: 20 }); // 63 m in 1 s: possible for a car, not at 20 m/s
    d.cruise(20, 30);
    const { trip, kinds } = replay(d.fixes);
    expect(kinds).toContain('jump');
    expect(trip.distanceM).toBeLessThan(d.truth + 1);
    expect(trip.distanceM).toBeGreaterThan(d.truth - 2 * 20 - 1);
  });
});

describe('accuracy', () => {
  it('skips inaccurate fixes and measures across them from the last good one', () => {
    const d = new Drive(51);
    // Every other fix is poor and 40 m off; the drive ends on a good fix.
    for (let i = 0; i < 61; i++) d.cruise(20, 1, i % 2 ? { acc: 60, noiseM: 40 } : { acc: 6 });
    const { trip, kinds } = replay(d.fixes);
    expect(count(kinds, 'inaccurate')).toBe(30);
    expect(trip.distanceM).toBeCloseTo(d.truth, 0);
    expect(trip.movingMs).toBe(61_000);
  });

  it('records nothing from a drive with only poor fixes', () => {
    const d = new Drive(52, { acc: 80 }).cruise(20, 120, { acc: MAX_ACCURACY_M + 1 });
    expect(replay(d.fixes).trip).toBe(initialTrip);
  });

  it('takes max speed only from accurate fixes that agree with the positions', () => {
    const d = new Drive(53).cruise(20, 20);
    d.cruise(20, 1, { acc: 60 });
    d.fixes[d.fixes.length - 1].speedMps = 65; // inaccurate fix, wild speed
    d.cruise(20, 1);
    d.fixes[d.fixes.length - 1].speedMps = 55; // accurate fix, speed spike
    d.cruise(20, 20);
    const { trip } = replay(d.fixes);
    expect(trip.maxSpeedMps).toBe(20);
  });

  it('follows a real acceleration to a new max', () => {
    const d = new Drive(54);
    for (let v = 1; v <= 30; v++) d.cruise(v, 1);
    expect(replay(d.fixes).trip.maxSpeedMps).toBe(30);
  });
});

describe('trip lifecycle', () => {
  it('starts at the first movement, not at the first fix', () => {
    const d = new Drive(61).park(120, { wanderM: 2 }).cruise(10, 10);
    const { trip } = replay(d.fixes);
    expect(trip.startedAt).toBe(T0 + 120_000);
    expect(trip.distanceM).toBeCloseTo(100, 0);
  });

  const old: Trip = {
    startedAt: T0 - 10 * 3600_000,
    distanceM: 50_000,
    movingMs: 3_600_000,
    maxSpeedMps: 31,
    lastMovedAt: T0 - IDLE_RESET_MS - 60_000,
  };

  it(`starts fresh after ${IDLE_RESET_MS / 3600_000} h parked, at the next movement`, () => {
    // As after a reload: the recorder has no anchor yet, the trip comes from storage.
    const d = new Drive(62).park(30).cruise(10, 60);
    const parkedOnly = replay(d.fixes.slice(0, 31), old);
    expect(parkedOnly.trip).toBe(old); // still shown until the car moves
    const { trip } = replay(d.fixes, old);
    expect(trip.startedAt).toBe(T0 + 30_000);
    expect(trip.distanceM).toBeCloseTo(600, 0);
    expect(trip.movingMs).toBe(60_000);
    expect(trip.maxSpeedMps).toBe(10);
  });

  it('continues the trip after a shorter stop', () => {
    const recent = { ...old, lastMovedAt: T0 - 3 * 3600_000 };
    const { trip } = replay(new Drive(63).cruise(10, 60).fixes, recent);
    expect(trip.startedAt).toBe(recent.startedAt);
    expect(trip.distanceM).toBeCloseTo(50_600, 0);
    expect(trip.maxSpeedMps).toBe(31);
  });

  it('survives junk in stored timestamps', () => {
    const junk = { ...old, lastMovedAt: 'yesterday', startedAt: 'x' } as unknown as Trip;
    const { trip } = replay(new Drive(64).cruise(10, 5).fixes, junk);
    expect(trip.startedAt).toBe(T0);
    expect(trip.distanceM).toBeCloseTo(50_050, 0);
    expect(trip.lastMovedAt).toBe(T0 + 5000);
  });
});

describe('averageSpeedMps', () => {
  it('is distance over moving time, 0 before moving', () => {
    expect(averageSpeedMps(initialTrip)).toBe(0);
    expect(averageSpeedMps({ ...initialTrip, distanceM: 1000, movingMs: 100_000 })).toBe(10);
  });
});
