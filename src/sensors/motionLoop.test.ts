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
  speedKnown: true,
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
    // Released below the lower threshold — and the course is held, not handed to the compass.
    expect(selectHeadingSource('course', COURSE_RELEASE_SPEED_MPS - 0.01, 90, 45)).toBe('hold');
  });

  it('after the first GPS course of the session, a stop holds it instead of using the compass', () => {
    expect(selectHeadingSource('hold', 0, null, 45, true)).toBe('hold');
    expect(selectHeadingSource('hold', 0, null, 45, false)).toBe('compass');
    expect(selectHeadingSource('hold', 10, 90, 45, true)).toBe('course');
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

describe('step: unknown speed', () => {
  const cruise = (over: Partial<MotionTarget> = {}) =>
    target({ fix: { ...ORIGIN, speedMps: 29, headingDeg: 90 }, speedMps: 29, courseDeg: 90, ...over });

  // Regression (review): after signal loss the motion loop kept taking its speed target from
  // the last telemetry speed (the digits read 65 through a tunnel).
  it('signal loss: the speed expires with the fix age, eases to 0, and the puck stops advancing', () => {
    let s = step(INITIAL_MOTION_STATE, cruise({ snap: true }), 0);
    s = run(s, (t) => cruise({ ageS: t }), 0.5).state; // a moving car between fixes
    expect(s.speedKnown).toBe(true);
    expect(s.speedMps).toBe(29);

    // No more fixes: telemetry has not caught up yet (still says known), the age decides.
    const lost = run(s, (t) => cruise({ ageS: 0.5 + t }), 9.5);
    const frameAt = (seconds: number) => lost.frames[Math.round((seconds - 0.5) * 60) - 1];
    expect(frameAt(2.9).speedKnown).toBe(true);
    expect(frameAt(3.1).speedKnown).toBe(false);
    expect(frameAt(4.5).speedMps).toBeLessThan(29 * 0.1); // eased towards empty, not held at 29
    expect(lost.state.speedMps).toBe(0);
    // Not one metre further after the speed went unknown (dead reckoning had stopped at 1.5 s
    // and stays frozen), and never backwards.
    expect(dist(frameAt(3.1), lost.state)).toBeLessThan(0.5);
    expect(dist(lost.state, ORIGIN)).toBeCloseTo(29 * MAX_EXTRAPOLATION_S, 0);

    // Telemetry catches up (speed 0, unknown): still frozen — no slide back to the old fix.
    const after = run(lost.state, (t) => cruise({ speedMps: 0, speedKnown: false, ageS: 10 + t }), 3).state;
    expect(dist(after, lost.state)).toBeLessThan(0.01);
    expect(after.speedKnown).toBe(false);
  });

  it('recovery is animated: the readout glides back up from 0, it does not jump', () => {
    let s = step(INITIAL_MOTION_STATE, cruise({ snap: true }), 0);
    s = run(s, (t) => cruise({ speedKnown: false, speedMps: 0, ageS: 5 + t }), 6).state;
    expect(s).toMatchObject({ speedKnown: false, speedMps: 0 });
    const next = at(ORIGIN, 90, 200, { speedMps: 20, headingDeg: 90, timestamp: 60_000 });
    const { frames, state } = run(s, (t) => target({ fix: next, speedMps: 20, courseDeg: 90, ageS: t % 1 }), 5);
    expect(frames[0].speedKnown).toBe(true);
    expect(frames[0].speedMps).toBeLessThan(2);
    for (let i = 1; i < frames.length; i++) expect(frames[i].speedMps).toBeGreaterThanOrEqual(frames[i - 1].speedMps);
    expect(state.speedMps).toBe(20);
  });

  it('a recovery fix far away snaps the position but still glides the readout', () => {
    let s = step(INITIAL_MOTION_STATE, cruise({ snap: true }), 0);
    s = run(s, (t) => cruise({ speedKnown: false, speedMps: 0, ageS: 5 + t }), 6).state;
    const far = at(ORIGIN, 90, 2_000, { speedMps: 25, headingDeg: 90, timestamp: 90_000 });
    const snapped = step(s, target({ fix: far, speedMps: 25, courseDeg: 90 }), 1 / 60);
    expect(dist(snapped, far)).toBeLessThan(1e-6);
    expect(snapped.speedMps).toBeLessThan(2);
  });

  it('unknown speed on fresh fixes (garage): no dead reckoning, wander within the accuracy is ignored', () => {
    const start = step(INITIAL_MOTION_STATE, target({ fix: { ...ORIGIN, accuracyM: 20 }, speedKnown: false }), 0);
    const jitter = [0, 12, 6, 15, 9, 12];
    const { frames } = run(
      start,
      (t) => {
        const k = Math.floor(t);
        const fix = at(ORIGIN, k * 77, jitter[k % jitter.length], { accuracyM: 20, timestamp: k * 1000 });
        // Even a stale telemetry speed/course must not be used while the speed is unknown.
        return target({ fix, speedMps: 12, courseDeg: 0, speedKnown: false, ageS: t - k });
      },
      6,
    );
    for (const f of frames) {
      expect(f.speedKnown).toBe(false);
      expect(f.speedMps).toBe(0);
      expect(dist(f, ORIGIN)).toBeLessThan(1e-6);
    }
  });
});

describe('step: heading at stops', () => {
  const moving = makeFix({ speedMps: 12, headingDeg: 0, timestamp: 1 });
  const stopped = { ...moving, speedMps: 0, headingDeg: null, timestamp: 2 };

  // Regression (review): below ~1.5 m/s the heading switched from the GPS course (true north)
  // to the raw magnetic compass, so the map rotated by the declination (≈13° in SF) at every
  // red light, plus any mount/car-body interference.
  it('a stop holds the last GPS course instead of switching to the compass', () => {
    let s = step(INITIAL_MOTION_STATE, target({ fix: moving, speedMps: 12, courseDeg: 0, compassDeg: 35, snap: true }), 0);
    expect(s.headingSource).toBe('course');
    const { frames, state } = run(s, (t) => target({ fix: stopped, speedMps: 0, courseDeg: null, compassDeg: 35, ageS: t }), 30);
    expect(state.headingSource).toBe('hold');
    for (const f of frames) expect(f.headingDeg).toBe(0);
    // Pulling away again follows the course.
    s = run(state, (t) => target({ fix: { ...moving, timestamp: 40 }, speedMps: 5, courseDeg: 10, compassDeg: 35, ageS: t % 1 }), 4).state;
    expect(s.headingSource).toBe('course');
    expect(s.headingDeg).toBeCloseTo(10, 1);
  });

  it('uses the compass only before the first GPS course (parked at the start)', () => {
    const { state } = run(step(INITIAL_MOTION_STATE, target({ compassDeg: 200 }), 0), () => target({ compassDeg: 200 }), 6);
    expect(state.headingSource).toBe('compass');
    expect(state.headingDeg).toBeCloseTo(200, 1);
    expect(state.hadCourse).toBe(false);
  });

  it('losing the speed (signal loss) holds the course too', () => {
    const s = step(INITIAL_MOTION_STATE, target({ fix: moving, speedMps: 12, courseDeg: 0, compassDeg: 35, snap: true }), 0);
    const { state } = run(s, (t) => target({ fix: moving, speedMps: 12, courseDeg: 0, compassDeg: 35, ageS: 4 + t }), 5);
    expect(state.headingSource).toBe('hold');
    expect(state.headingDeg).toBe(0);
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

  it('pose.speedKnown follows telemetry, expires with the fix age, and is false when not tracking', () => {
    startMotionLoop({ raf, cancelRaf, now: () => now, doc: null, readCompass: () => null });
    const moving = { ...ORIGIN, speedMps: 20, headingDeg: 0 };
    telemetry.set({ ...telemetry.get(), status: 'tracking', fix: moving, speedMps: 20, speedKnown: true, headingDeg: 0 });
    tick();
    expect(pose.speedKnown.get()).toBe(true);
    for (let i = 0; i < 60 * 2.5; i++) tick();
    expect(pose.speedKnown.get()).toBe(true);
    for (let i = 0; i < 60; i++) tick(); // the fix is now > 3 s old
    expect(pose.speedKnown.get()).toBe(false);

    telemetry.set({ ...telemetry.get(), fix: { ...moving, timestamp: 5_000 } }); // fresh fix, known speed
    tick();
    expect(pose.speedKnown.get()).toBe(true);
    telemetry.set({ ...telemetry.get(), status: 'stale' }); // status alone is enough
    tick();
    expect(pose.speedKnown.get()).toBe(false);
    stopMotionLoop();
    expect(pose.speedKnown.get()).toBe(false);
  });

  it('forgets the held course after a long time in the background (the compass orients again)', () => {
    const doc = fakeDoc();
    startMotionLoop({ raf, cancelRaf, now: () => now, doc, readCompass: () => 200 });
    const moving = { ...ORIGIN, speedMps: 12, headingDeg: 0 };
    telemetry.set({ ...telemetry.get(), status: 'tracking', fix: moving, speedMps: 12, speedKnown: true, headingDeg: 0 });
    tick();
    const parked = { ...ORIGIN, timestamp: 1_000 };
    telemetry.set({ ...telemetry.get(), fix: parked, speedMps: 0, headingDeg: null });
    for (let i = 0; i < 120; i++) tick();
    expect(pose.headingDeg.get()).toBe(0); // held at the stop

    doc.setVisible(false);
    now += 120_000;
    doc.setVisible(true);
    telemetry.set({ ...telemetry.get(), fix: { ...parked, timestamp: 200_000 } });
    for (let i = 0; i < 300; i++) tick();
    expect(pose.headingDeg.get()).toBeCloseTo(200, 0);
  });
});
