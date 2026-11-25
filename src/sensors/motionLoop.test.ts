import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { angleDiffDeg, destinationPoint, haversineM } from '../lib';
import { pose, telemetry } from '../state';
import type { Fix } from '../types';
import {
  COURSE_MIN_SPEED_MPS,
  COURSE_RELEASE_SPEED_MPS,
  INITIAL_MOTION_STATE,
  MAX_EXTRAPOLATION_S,
  SNAP_DISTANCE_M,
  estimateAccelMps2,
  extrapolationDistanceM,
  followCritical,
  followCriticalAngle,
  selectHeadingSource,
  startMotionLoop,
  step,
  stopMotionLoop,
  type MotionState,
  type MotionTarget,
} from './motionLoop';
import { fakeDoc, makeFix } from './testUtils';

const ORIGIN = makeFix();
const target = (over: Partial<MotionTarget> = {}): MotionTarget => ({
  fix: ORIGIN,
  speedMps: 0,
  courseDeg: null,
  accelMps2: 0,
  compassDeg: null,
  ageS: 0,
  snap: false,
  ...over,
});
const dist = (s: { lat: number; lng: number }, p: { lat: number; lng: number }) =>
  haversineM([s.lng, s.lat], [p.lng, p.lat]);
const at = (from: Fix, bearing: number, metres: number, extra: Partial<Fix> = {}): Fix => {
  const [lng, lat] = destinationPoint([from.lng, from.lat], bearing, metres);
  return { ...from, lat, lng, ...extra };
};

/** Run `step` at `fps` for `seconds`, with `make(t)` giving the target at time t. */
function run(state: MotionState, make: (t: number) => MotionTarget, seconds: number, fps = 60) {
  const dt = 1 / fps;
  const frames: MotionState[] = [];
  let s = state;
  for (let i = 1; i <= Math.round(seconds * fps); i++) {
    s = step(s, make(i * dt), dt);
    frames.push(s);
  }
  return { state: s, frames };
}

/** A settled pose (at rest, both follower stages equal) sitting on ORIGIN. */
const settled = (over: Partial<MotionState> = {}): MotionState => ({
  ...step(INITIAL_MOTION_STATE, target(), 0),
  ...(over.headingDeg === undefined ? {} : { midHeadingDeg: over.headingDeg }),
  ...over,
});

describe('followCritical', () => {
  const lambda = 5;
  it('is frame-rate independent and never overshoots a step from rest', () => {
    const runAt = (fps: number) => {
      let xm: [number, number] = [0, 0];
      let peak = 0;
      for (let i = 0; i < fps * 2; i++) {
        xm = followCritical(xm[0], xm[1], 100, lambda, 1 / fps);
        peak = Math.max(peak, xm[0]);
      }
      return { x: xm[0], peak };
    };
    expect(runAt(30).x).toBeCloseTo(runAt(144).x, 9);
    expect(runAt(60).peak).toBeLessThanOrEqual(100);
    expect(runAt(60).x).toBeCloseTo(100 * (1 - (1 + lambda * 2) * Math.exp(-lambda * 2)), 9);
  });

  it('starts moving gently after a jump in the target (continuous velocity)', () => {
    const dt = 1 / 60;
    const [x1] = followCritical(0, 0, 10, lambda, dt);
    const firstOrder = 10 * (1 - Math.exp(-lambda * dt));
    expect(x1).toBeLessThan(firstOrder * 0.1);
  });

  it('angles take the short way across the seam', () => {
    let xm: [number, number] = [350, 350];
    for (let i = 0; i < 240; i++) {
      xm = followCriticalAngle(xm[0], xm[1], 10, lambda, 1 / 60);
      expect(Math.abs(angleDiffDeg(0, xm[0]))).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(xm[0]).toBeCloseTo(10, 3);
  });
});

describe('extrapolationDistanceM', () => {
  it('is speed × age, capped at MAX_EXTRAPOLATION_S', () => {
    expect(extrapolationDistanceM(10, 0, 0.5)).toBeCloseTo(5, 9);
    expect(extrapolationDistanceM(10, 0, 10)).toBeCloseTo(10 * MAX_EXTRAPOLATION_S, 9);
    expect(extrapolationDistanceM(0, 0, 1)).toBe(0);
    expect(extrapolationDistanceM(10, 0, -1)).toBe(0);
  });

  it('decelerates when braking and never passes the stopping point', () => {
    expect(extrapolationDistanceM(4, -4, 0.5)).toBeCloseTo(4 * 0.5 - 0.5 * 4 * 0.25, 9);
    expect(extrapolationDistanceM(4, -4, 1.5)).toBeCloseTo(2, 9); // v²/2a
  });

  it('ignores positive acceleration (no overshoot when the driver lifts off)', () => {
    expect(extrapolationDistanceM(10, 3, 1)).toBeCloseTo(10, 9);
  });
});

describe('selectHeadingSource', () => {
  it('uses course when moving, compass when slow, otherwise holds', () => {
    expect(selectHeadingSource('hold', 10, 90, 0)).toBe('course');
    expect(selectHeadingSource('hold', 1, 90, 45)).toBe('compass');
    expect(selectHeadingSource('hold', 1, 90, null)).toBe('hold');
    expect(selectHeadingSource('hold', 10, null, null)).toBe('hold');
  });

  it('has hysteresis between the two thresholds', () => {
    const mid = (COURSE_MIN_SPEED_MPS + COURSE_RELEASE_SPEED_MPS) / 2;
    expect(selectHeadingSource('compass', mid, 90, 45)).toBe('compass');
    expect(selectHeadingSource('course', mid, 90, 45)).toBe('course');
    expect(selectHeadingSource('course', COURSE_RELEASE_SPEED_MPS - 0.01, 90, 45)).toBe('compass');
  });
});

describe('estimateAccelMps2', () => {
  it('differences speeds over a sane interval only', () => {
    expect(estimateAccelMps2({ timestamp: 0, speedMps: 10 }, { timestamp: 1000, speedMps: 7 })).toBeCloseTo(-3, 9);
    expect(estimateAccelMps2({ timestamp: 0, speedMps: 10 }, { timestamp: 100, speedMps: 0 })).toBe(0);
    expect(estimateAccelMps2({ timestamp: 0, speedMps: 10 }, { timestamp: 10_000, speedMps: 0 })).toBe(0);
    expect(estimateAccelMps2(null, { timestamp: 0, speedMps: 3 })).toBe(0);
  });
});

describe('step', () => {
  it('snaps on the first fix instead of flying in from 0,0', () => {
    const s = step(INITIAL_MOTION_STATE, target({ fix: { ...ORIGIN, accuracyM: 7 }, speedMps: 0 }), 1 / 60);
    expect(s).toMatchObject({ hasPose: true, lat: ORIGIN.lat, lng: ORIGIN.lng, accuracyM: 7, speedMps: 0 });
  });

  it('does nothing without a fix, and drops the pose when the fix goes away', () => {
    expect(step(INITIAL_MOTION_STATE, target({ fix: null }), 1 / 60)).toBe(INITIAL_MOTION_STATE);
    expect(step(settled(), target({ fix: null }), 1 / 60).hasPose).toBe(false);
  });

  it('converges on the target, frame-rate independently', () => {
    const start = settled();
    const goal = at(ORIGIN, 90, 20, { speedMps: null });
    const make = () => target({ fix: goal, speedMps: 0 });
    // speed 0 → stationary anchor at the goal (the anchor radius only filters wander around an anchor).
    const s60 = run(start, make, 3, 60).state;
    const s144 = run(start, make, 3, 144).state;
    expect(dist(s60, goal)).toBeLessThan(0.05);
    expect(dist(s60, s144)).toBeLessThan(1e-6);
  });

  it('crosses the 0/360 seam the short way', () => {
    const start = settled({ headingDeg: 350, headingSource: 'course' });
    const { frames, state } = run(start, () => target({ speedMps: 10, courseDeg: 10 }), 4);
    for (const f of frames) expect(Math.abs(angleDiffDeg(0, f.headingDeg))).toBeLessThanOrEqual(10 + 1e-9);
    expect(state.headingDeg).toBeCloseTo(10, 1);
  });

  it('caps dead reckoning at MAX_EXTRAPOLATION_S when fixes stop coming', () => {
    const speed = 20;
    const { state } = run(settled(), (t) => target({ speedMps: speed, courseDeg: 90, ageS: t }), 6);
    expect(dist(state, ORIGIN)).toBeCloseTo(speed * MAX_EXTRAPOLATION_S, 0);
  });

  it('moves smoothly between 1 Hz fixes (no once-per-second stepping)', () => {
    const v = 15;
    const fixAt = (k: number) => at(ORIGIN, 0, v * k, { speedMps: v, headingDeg: 0, timestamp: k * 1000 });
    let s = step(INITIAL_MOTION_STATE, target({ fix: fixAt(0), speedMps: v, courseDeg: 0 }), 0);
    const dt = 1 / 60;
    const perFrame: number[] = [];
    for (let i = 1; i <= 60 * 10; i++) {
      const t = i * dt;
      const k = Math.floor(t + 1e-9);
      const prev = s;
      s = step(s, target({ fix: fixAt(k), speedMps: v, courseDeg: 0, ageS: t - k }), dt);
      if (t > 3) perFrame.push(dist(prev, s) / dt);
    }
    // Steady state: displayed speed over ground stays within a few % of the true speed.
    expect(Math.min(...perFrame)).toBeGreaterThan(v * 0.97);
    expect(Math.max(...perFrame)).toBeLessThan(v * 1.03);
  });

  it('brakes to a stop without overshooting and sliding back', () => {
    // 15 m/s, braking at 3 m/s² from t=0, stopped at t=5; fixes every second.
    const a = -3;
    const truth = (t: number) => {
      const tt = Math.min(t, 5);
      return { pos: 15 * tt + 0.5 * a * tt * tt, v: Math.max(0, 15 + a * tt) };
    };
    const fixAt = (k: number) => at(ORIGIN, 0, truth(k).pos, { timestamp: k * 1000 });
    let s = step(INITIAL_MOTION_STATE, target({ fix: fixAt(0), speedMps: 15, courseDeg: 0 }), 0);
    const dt = 1 / 60;
    let maxBack = 0;
    for (let i = 1; i <= 60 * 8; i++) {
      const t = i * dt;
      const k = Math.floor(t + 1e-9);
      const v = truth(k).v;
      const accel = k > 0 ? estimateAccelMps2({ timestamp: (k - 1) * 1000, speedMps: truth(k - 1).v }, { timestamp: k * 1000, speedMps: v }) : 0;
      const prev = s;
      s = step(s, target({ fix: fixAt(k), speedMps: v, courseDeg: v > 0 ? 0 : null, accelMps2: accel, ageS: t - k }), dt);
      maxBack = Math.max(maxBack, prev.lat - s.lat);
    }
    expect(maxBack).toBeLessThan(1e-7); // never moves south (backwards) by more than ~1 cm
    expect(dist(s, fixAt(5))).toBeLessThan(0.05);
  });

  it('holds heading and position at a stop (no spinning, no GPS wander)', () => {
    const start = settled({ headingDeg: 123, headingSource: 'course' });
    const wander = [0, 3, 5, 2, 4, 1];
    const { frames } = run(
      start,
      (t) => target({ fix: at(ORIGIN, (t * 97) % 360, wander[Math.floor(t) % wander.length]), speedMps: 0 }),
      6,
    );
    for (const f of frames) {
      expect(f.headingDeg).toBe(123);
      expect(dist(f, ORIGIN)).toBeLessThan(1e-6);
    }
  });

  it('follows the compass when stationary if one is available', () => {
    const { state } = run(settled({ headingDeg: 0 }), () => target({ compassDeg: 270 }), 8);
    expect(state.headingSource).toBe('compass');
    expect(state.headingDeg).toBeCloseTo(270, 1);
  });

  it('re-anchors when a stationary fix moves beyond the wander radius', () => {
    const far = at(ORIGIN, 90, 30);
    const { state } = run(settled(), () => target({ fix: far }), 4);
    expect(dist(state, far)).toBeLessThan(0.05);
  });

  it('snaps on request and when the target is implausibly far away', () => {
    const near = at(ORIGIN, 45, 50);
    expect(dist(step(settled(), target({ fix: near, snap: true }), 1 / 60), near)).toBeLessThan(1e-6);
    const far = at(ORIGIN, 45, SNAP_DISTANCE_M + 50);
    expect(dist(step(settled(), target({ fix: far }), 1 / 60), far)).toBeLessThan(1e-6);
    // …but a nearby target is animated, not jumped to.
    expect(dist(step(settled(), target({ fix: near }), 1 / 60), near)).toBeGreaterThan(40);
  });

  it('eases speed so digits glide, and settles exactly', () => {
    const { frames, state } = run(settled(), () => target({ speedMps: 20, courseDeg: 0 }), 5);
    expect(frames[0].speedMps).toBeGreaterThan(0);
    expect(frames[0].speedMps).toBeLessThan(2);
    for (let i = 1; i < frames.length; i++) expect(frames[i].speedMps).toBeGreaterThanOrEqual(frames[i - 1].speedMps);
    expect(state.speedMps).toBe(20);
  });
});

describe('motion loop driver', () => {
  let callbacks: Map<number, () => void>;
  let nextId: number;
  let now: number;
  const raf = (cb: () => void) => {
    callbacks.set(nextId, cb);
    return nextId++;
  };
  const cancelRaf = (id: number) => void callbacks.delete(id);
  const tick = (ms = 1000 / 60) => {
    now += ms;
    const due = [...callbacks.values()];
    callbacks.clear();
    for (const cb of due) cb();
  };

  beforeEach(() => {
    callbacks = new Map();
    nextId = 1;
    now = 0;
    telemetry.reset();
  });
  afterEach(() => {
    stopMotionLoop();
    telemetry.reset();
  });

  it('writes pose every frame once a fix exists, and snaps the first fix', () => {
    startMotionLoop({ raf, cancelRaf, now: () => now, doc: null, readCompass: () => null });
    tick();
    expect(pose.hasPose.get()).toBe(false);
    telemetry.set({ ...telemetry.get(), status: 'tracking', fix: ORIGIN, speedMps: 0 });
    tick();
    expect(pose.hasPose.get()).toBe(true);
    expect(pose.lat.get()).toBe(ORIGIN.lat);
    expect(pose.lng.get()).toBe(ORIGIN.lng);
    stopMotionLoop();
    expect(pose.hasPose.get()).toBe(false);
  });

  it('pauses while hidden and snaps to the latest fix on resume', () => {
    const doc = fakeDoc();
    startMotionLoop({ raf, cancelRaf, now: () => now, doc, readCompass: () => null });
    telemetry.set({ ...telemetry.get(), status: 'tracking', fix: ORIGIN });
    tick();
    doc.setVisible(false);
    tick(); // the pending frame was cancelled by the visibility handler
    expect(callbacks.size).toBe(0);
    const later = at(ORIGIN, 0, 120, { timestamp: 60_000 });
    telemetry.set({ ...telemetry.get(), fix: later });
    doc.setVisible(true);
    tick();
    expect(pose.lat.get()).toBeCloseTo(later.lat, 9);
  });

  it('ignores the real compass during a simulated drive', () => {
    startMotionLoop({ raf, cancelRaf, now: () => now, doc: null, readCompass: () => 200 });
    telemetry.set({ ...telemetry.get(), source: 'sim', status: 'tracking', fix: ORIGIN });
    for (let i = 0; i < 120; i++) tick();
    expect(pose.headingDeg.get()).toBe(0);
    telemetry.set({ ...telemetry.get(), source: 'gps', fix: { ...ORIGIN, timestamp: 1 } });
    for (let i = 0; i < 300; i++) tick();
    expect(pose.headingDeg.get()).toBeCloseTo(200, 0);
  });
});
