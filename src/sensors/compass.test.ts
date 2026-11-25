import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { telemetry } from '../state';
import {
  COMPASS_MAX_ACCURACY_DEG,
  COMPASS_RESET_GAP_MS,
  COMPASS_WRITE_INTERVAL_MS,
  compassPermission,
  correctForScreen,
  createCompassFilter,
  getCompassDeg,
  readDeviceHeading,
  readScreenAngle,
  requestCompassPermission,
  startCompass,
  stopCompass,
  type OrientationTarget,
} from './compass';

describe('correctForScreen', () => {
  // Driver faces north in every case; the phone is mounted in landscape.
  it('landscape, phone turned counter-clockwise (angle 90): device top points west', () => {
    expect(correctForScreen(270, 90)).toBe(0);
  });

  it('landscape, phone turned clockwise (angle 270 / legacy -90): device top points east', () => {
    expect(correctForScreen(90, 270)).toBe(0);
    expect(correctForScreen(90, -90)).toBe(0);
  });

  it('portrait and upside-down portrait', () => {
    expect(correctForScreen(0, 0)).toBe(0);
    expect(correctForScreen(180, 180)).toBe(0);
  });

  it('works for any heading and normalises across the seam', () => {
    // Driver faces east (90): CCW-landscape device top points north (0).
    expect(correctForScreen(0, 90)).toBe(90);
    // Driver faces 350: CW-landscape device top points 80.
    expect(correctForScreen(80, 270)).toBe(350);
    expect(correctForScreen(10, Number.NaN)).toBe(10);
  });
});

describe('readDeviceHeading', () => {
  it('prefers webkitCompassHeading', () => {
    expect(readDeviceHeading({ webkitCompassHeading: 123.4, webkitCompassAccuracy: 10, alpha: 10, absolute: true })).toBe(
      123.4,
    );
  });

  // Regression (review): `webkitCompassAccuracy` was never read, and WebKit reports heading 0
  // with accuracy -1 when it has no heading — a placeholder that read as "north".
  it('ignores iOS readings without a real, good accuracy', () => {
    expect(readDeviceHeading({ webkitCompassHeading: 0, webkitCompassAccuracy: -1 })).toBeNull();
    expect(readDeviceHeading({ webkitCompassHeading: 90, webkitCompassAccuracy: COMPASS_MAX_ACCURACY_DEG + 5 })).toBeNull();
    expect(readDeviceHeading({ webkitCompassHeading: 90 })).toBeNull();
    expect(readDeviceHeading({ webkitCompassHeading: 90, webkitCompassAccuracy: Number.NaN })).toBeNull();
    expect(readDeviceHeading({ webkitCompassHeading: 90, webkitCompassAccuracy: 0 })).toBe(90);
    expect(readDeviceHeading({ webkitCompassHeading: 90, webkitCompassAccuracy: COMPASS_MAX_ACCURACY_DEG })).toBe(90);
  });

  it('ignores invalid webkit values and falls back to absolute alpha (counter-clockwise)', () => {
    expect(readDeviceHeading({ webkitCompassHeading: -1, alpha: 90, absolute: true })).toBe(270);
    expect(readDeviceHeading({ webkitCompassHeading: Number.NaN, alpha: 0, absolute: true })).toBe(0);
  });

  it('never treats a relative alpha as a compass', () => {
    expect(readDeviceHeading({ alpha: 90, absolute: false })).toBeNull();
    expect(readDeviceHeading({})).toBeNull();
  });
});

describe('readScreenAngle', () => {
  it('uses screen.orientation.angle, then window.orientation, else 0', () => {
    expect(readScreenAngle({ screen: { orientation: { angle: 270 } }, orientation: 0 })).toBe(270);
    expect(readScreenAngle({ orientation: -90 })).toBe(270);
    expect(readScreenAngle({ screen: { orientation: null } })).toBe(0);
    expect(readScreenAngle(null)).toBe(0);
  });
});

describe('createCompassFilter', () => {
  it('smooths across the 0/360 seam the short way', () => {
    const f = createCompassFilter(0.25, 0, 0);
    f.push(350, 0);
    let last = 350;
    for (let t = 16; t <= 3_000; t += 16) {
      last = f.push(10, t).smoothedDeg;
      // Never wanders through the south.
      expect(last > 340 || last < 20).toBe(true);
    }
    expect(last).toBeCloseTo(10, 1);
  });

  it('throttles writes to the interval and skips tiny changes', () => {
    const f = createCompassFilter(0.25, COMPASS_WRITE_INTERVAL_MS, 1);
    const writes: number[] = [];
    for (let t = 0; t <= 1_000; t += 16) {
      const { write } = f.push(t < 500 ? 0 : 90, t);
      if (write !== null) writes.push(t);
    }
    expect(writes[0]).toBe(0);
    for (let i = 1; i < writes.length; i++) expect(writes[i] - writes[i - 1]).toBeGreaterThanOrEqual(COMPASS_WRITE_INTERVAL_MS);
    // Steady at 0 for the first 500 ms: nothing to write after the first value.
    expect(writes.filter((t) => t > 0 && t < 500)).toEqual([]);
  });

  it('restarts from the raw reading after a long gap', () => {
    const f = createCompassFilter();
    f.push(0, 0);
    expect(f.push(180, 10_000).smoothedDeg).toBe(180);
  });
});

describe('requestCompassPermission', () => {
  it('iOS: returns the user answer', async () => {
    await expect(requestCompassPermission({ requestPermission: () => Promise.resolve('granted') })).resolves.toBe(
      'granted',
    );
    expect(compassPermission()).toBe('granted');
    await expect(requestCompassPermission({ requestPermission: () => Promise.resolve('denied') })).resolves.toBe('denied');
  });

  it('iOS: a rejection or a throw (no gesture) counts as denied', async () => {
    await expect(requestCompassPermission({ requestPermission: () => Promise.reject(new Error('x')) })).resolves.toBe(
      'denied',
    );
    await expect(
      requestCompassPermission({
        requestPermission: () => {
          throw new Error('NotAllowedError');
        },
      }),
    ).resolves.toBe('denied');
  });

  it('calls requestPermission synchronously (inside the gesture)', () => {
    let called = false;
    void requestCompassPermission({
      requestPermission: () => {
        called = true;
        return Promise.resolve('granted');
      },
    });
    expect(called).toBe(true);
  });

  it('no permission model → granted; no API → unsupported', async () => {
    await expect(requestCompassPermission({})).resolves.toBe('granted');
    await expect(requestCompassPermission(null)).resolves.toBe('unsupported');
  });
});

describe('compass driver', () => {
  function fakeWindow(angle: number) {
    const listeners = new Map<string, Set<(e: Event) => void>>();
    const win = {
      screen: { orientation: { angle } },
      addEventListener(type: string, l: (e: Event) => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(l);
      },
      removeEventListener(type: string, l: (e: Event) => void) {
        listeners.get(type)?.delete(l);
      },
      emit(type: string, data: object) {
        for (const l of listeners.get(type) ?? []) l({ type, ...data } as unknown as Event);
      },
      count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    };
    return win satisfies OrientationTarget;
  }

  beforeEach(() => telemetry.reset());
  afterEach(() => {
    stopCompass();
    telemetry.reset();
  });

  const good = (heading: number) => ({ webkitCompassHeading: heading, webkitCompassAccuracy: 10 });

  it('writes the landscape-corrected heading, throttled, and clears it on stop', () => {
    const win = fakeWindow(90);
    let now = 0;
    startCompass({ target: win, now: () => now });
    win.emit('deviceorientation', good(270));
    expect(telemetry.get().compassDeg).toBe(0);
    expect(getCompassDeg()).toBe(0);

    let writes = 0;
    const off = telemetry.subscribe(() => writes++);
    for (now = 16; now < 3_000; now += 16) win.emit('deviceorientation', good(300));
    off();
    expect(writes).toBeGreaterThan(0);
    expect(writes).toBeLessThanOrEqual(3);
    expect(telemetry.get().compassDeg).toBeGreaterThan(20);

    stopCompass();
    expect(telemetry.get().compassDeg).toBeNull();
    expect(getCompassDeg()).toBeNull();
    expect(win.count()).toBe(0);
  });

  // Regression (review): `telemetry.compassDeg` was written up to 4×/s although nothing reads
  // it; every write re-ran every `telemetry.use` selector and a DOM write in the puck.
  it('writes telemetry at most once a second while the phone turns, the live value stays per-event', () => {
    const win = fakeWindow(0);
    let now = 0;
    startCompass({ target: win, now: () => now });
    let writes = 0;
    const off = telemetry.subscribe(() => writes++);
    let live = 0;
    for (now = 0; now <= 10_000; now += 16) {
      win.emit('deviceorientation', good((now / 10_000) * 180)); // a slow U-turn: 18°/s
      live = getCompassDeg() ?? Number.NaN;
    }
    off();
    expect(writes).toBeGreaterThan(3);
    expect(writes).toBeLessThanOrEqual(11);
    expect(live).toBeGreaterThan(170); // the motion loop still sees every event
  });

  it('placeholder readings (heading 0, accuracy -1) never become a heading, and the live value lapses', () => {
    const win = fakeWindow(90);
    let now = 0;
    startCompass({ target: win, now: () => now });
    for (; now < 1_000; now += 16) win.emit('deviceorientation', { webkitCompassHeading: 0, webkitCompassAccuracy: -1 });
    expect(getCompassDeg()).toBeNull();
    expect(telemetry.get().compassDeg).toBeNull();

    win.emit('deviceorientation', good(270));
    expect(getCompassDeg()).toBe(0);
    // Only bad readings from now on: the last good one expires instead of being trusted forever.
    const until = now + COMPASS_RESET_GAP_MS + 100;
    for (now += 16; now < until; now += 16) win.emit('deviceorientation', { webkitCompassHeading: 0, webkitCompassAccuracy: -1 });
    expect(getCompassDeg()).toBeNull();
  });
});
