import type { Map as MapboxMap } from 'mapbox-gl';
import { afterEach, describe, expect, it } from 'vitest';
import { ui } from '../../state';
import {
  CATCH_UP_MS,
  FOLLOW_PITCH_DEG,
  RECENTER_MS,
  SPEED_FAST_MPS,
  SPEED_HOLD_HALF_LIFE_S,
  SPEED_SLOW_MPS,
  ZOOM_FAST,
  ZOOM_MAX_RATE,
  ZOOM_SLOW,
  __mercator,
  createFollowCamera,
  easeInOutCubic,
  followPadding,
  followPoint,
  interpolateCamera,
  isFarJump,
  metersPerPixel,
  restingPadding,
  sameCamera,
  stepSpeedHold,
  stepZoom,
  zoomForSpeed,
  type CameraState,
  type PoseSnapshot,
} from './camera';

const NO_PAD = { top: 0, bottom: 0, left: 0, right: 0 };

describe('zoomForSpeed', () => {
  it('is the town zoom when stopped or slow, the highway zoom when fast', () => {
    expect(zoomForSpeed(0)).toBe(ZOOM_SLOW);
    expect(zoomForSpeed(SPEED_SLOW_MPS)).toBe(ZOOM_SLOW);
    expect(zoomForSpeed(SPEED_FAST_MPS)).toBeCloseTo(ZOOM_FAST, 9);
    expect(zoomForSpeed(60)).toBeCloseTo(ZOOM_FAST, 9);
  });

  it('is halfway at the midpoint speed', () => {
    expect(zoomForSpeed((SPEED_SLOW_MPS + SPEED_FAST_MPS) / 2)).toBeCloseTo((ZOOM_SLOW + ZOOM_FAST) / 2, 9);
  });

  it('never increases with speed and is flat near both ends', () => {
    let prev = Infinity;
    for (let v = 0; v <= 60; v += 0.25) {
      const z = zoomForSpeed(v);
      expect(z).toBeLessThanOrEqual(prev + 1e-12);
      prev = z;
    }
    // smoothstep: zero slope at the edges, so ±0.5 m/s around them barely moves the zoom.
    expect(ZOOM_SLOW - zoomForSpeed(SPEED_SLOW_MPS + 0.5)).toBeLessThan(0.01);
    expect(zoomForSpeed(SPEED_FAST_MPS - 0.5) - ZOOM_FAST).toBeLessThan(0.01);
  });

  it('treats garbage speeds as stopped', () => {
    expect(zoomForSpeed(-5)).toBe(ZOOM_SLOW);
    expect(zoomForSpeed(Number.NaN)).toBe(ZOOM_SLOW);
    expect(zoomForSpeed(Number.POSITIVE_INFINITY)).toBe(ZOOM_SLOW);
  });
});

describe('stepZoom', () => {
  const run = (from: number, to: number, seconds: number, fps: number) => {
    let z = from;
    for (let i = 0; i < seconds * fps; i++) z = stepZoom(z, to, 1 / fps);
    return z;
  };

  it('converges on the target', () => {
    expect(run(ZOOM_SLOW, ZOOM_FAST, 20, 60)).toBeCloseTo(ZOOM_FAST, 2);
    expect(run(ZOOM_FAST, ZOOM_SLOW, 30, 60)).toBeCloseTo(ZOOM_SLOW, 2);
  });

  it('never moves faster than ZOOM_MAX_RATE', () => {
    let z = ZOOM_SLOW;
    for (let i = 0; i < 120; i++) {
      const next = stepZoom(z, 5, 1 / 60);
      expect(Math.abs(next - z)).toBeLessThanOrEqual(ZOOM_MAX_RATE / 60 + 1e-12);
      z = next;
    }
  });

  it('zooms out (speeding up) faster than it zooms in (slowing down)', () => {
    const out = ZOOM_SLOW - run(ZOOM_SLOW, ZOOM_FAST, 2, 60);
    const back = run(ZOOM_FAST, ZOOM_SLOW, 2, 60) - ZOOM_FAST;
    expect(out).toBeGreaterThan(back);
  });

  it('is (nearly) frame-rate independent', () => {
    expect(run(16, 15.8, 1, 60)).toBeCloseTo(run(16, 15.8, 1, 120), 3);
    expect(run(16.6, 15, 2, 30)).toBeCloseTo(run(16.6, 15, 2, 120), 2);
  });

  it('does not pump in stop-and-go traffic (speed hold + easing)', () => {
    // 0 ↔ 15 m/s every 5 s for two minutes.
    const fps = 60;
    const speedAt = (t: number) => (Math.floor(t / 5) % 2 === 0 ? 0 : 15);
    let held = Number.NaN;
    let z = zoomForSpeed(0);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 120 * fps; i++) {
      const t = i / fps;
      held = stepSpeedHold(held, speedAt(t), 1 / fps);
      z = stepZoom(z, zoomForSpeed(held), 1 / fps);
      if (t > 60) {
        min = Math.min(min, z);
        max = Math.max(max, z);
      }
    }
    const rawSwing = zoomForSpeed(0) - zoomForSpeed(15);
    expect(max - min).toBeLessThan(rawSwing * 0.3);
  });

  it('handles odd inputs', () => {
    expect(stepZoom(Number.NaN, 15, 0.016)).toBe(15);
    expect(stepZoom(16, 15, 0)).toBe(16);
    expect(stepZoom(16, 15, -1)).toBe(16);
  });
});

describe('stepSpeedHold', () => {
  it('rises immediately', () => {
    expect(stepSpeedHold(5, 20, 0.016)).toBe(20);
    expect(stepSpeedHold(Number.NaN, 12, 0.016)).toBe(12);
  });

  it('decays towards a lower speed with SPEED_HOLD_HALF_LIFE_S', () => {
    let held = 30;
    for (let i = 0; i < SPEED_HOLD_HALF_LIFE_S * 60; i++) held = stepSpeedHold(held, 10, 1 / 60);
    expect(held).toBeCloseTo(20, 6);
  });

  it('treats garbage speeds as stopped', () => {
    expect(stepSpeedHold(Number.NaN, Number.NaN, 0.016)).toBe(0);
    expect(stepSpeedHold(10, -3, 0)).toBe(10);
  });
});

describe('followPadding / followPoint', () => {
  const centreOf = (w: number, h: number, p: ReturnType<typeof followPadding>) => ({
    x: (p.left + (w - p.right)) / 2,
    y: (p.top + (h - p.bottom)) / 2,
  });

  it('puts the vehicle where the mockup has it on an iPhone 15/16 Pro (852×393)', () => {
    const p = followPadding(852, 393);
    expect(p).toEqual({ left: 188, right: 0, top: 131, bottom: 0 });
    const c = centreOf(852, 393, p);
    expect(c.x).toBeCloseTo(520, 0);
    expect(c.y).toBeCloseTo(262, 0);
  });

  it('keeps the vehicle right of the speed cluster on small phones', () => {
    for (const [w, h] of [
      [667, 375],
      [568, 320],
      [932, 430],
    ]) {
      const c = centreOf(w, h, followPadding(w, h));
      expect(c.x).toBeGreaterThanOrEqual(Math.min(345, w * 0.7) - 1);
      expect(c.x).toBeCloseTo(followPoint(w, h).x, 0);
      expect(c.y / h).toBeCloseTo(0.667, 2);
    }
  });

  it('never produces negative padding or padding wider than the map', () => {
    for (let w = 100; w <= 1400; w += 50) {
      const p = followPadding(w, 400);
      expect(Math.min(p.top, p.bottom, p.left, p.right)).toBeGreaterThanOrEqual(0);
      expect(p.left + p.right).toBeLessThan(w);
    }
  });

  it('is all zero for an unsized map', () => {
    expect(followPadding(0, 0)).toEqual(NO_PAD);
    expect(followPadding(Number.NaN, 300)).toEqual(NO_PAD);
  });

  it('restingPadding keeps the horizontal offset but centres vertically', () => {
    expect(restingPadding(852, 393)).toEqual({ left: 188, right: 0, top: 0, bottom: 0 });
  });
});

describe('metersPerPixel', () => {
  it('matches the 512 px Mapbox world', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78_271.517, 2);
    expect(metersPerPixel(0, 16)).toBeCloseTo(78_271.517 / 65_536, 6);
    expect(metersPerPixel(60, 10)).toBeCloseTo(metersPerPixel(0, 10) / 2, 6);
  });
});

describe('interpolateCamera', () => {
  const a: CameraState = { lng: 10, lat: 50, zoom: 12, bearing: 350, pitch: 0, padding: NO_PAD };
  const b: CameraState = {
    lng: 11,
    lat: 51,
    zoom: 16,
    bearing: 10,
    pitch: 57,
    padding: { top: 131, bottom: 0, left: 188, right: 0 },
  };

  it('returns the endpoints at t = 0 and t = 1 (and clamps t)', () => {
    expect(sameCamera(interpolateCamera(a, b, 0), a)).toBe(true);
    expect(sameCamera(interpolateCamera(a, b, 1), b)).toBe(true);
    expect(sameCamera(interpolateCamera(a, b, -3), a)).toBe(true);
    expect(sameCamera(interpolateCamera(a, b, 7), b)).toBe(true);
  });

  it('turns the short way across north', () => {
    expect(interpolateCamera(a, b, 0.5).bearing).toBeCloseTo(0, 9);
  });

  it('crosses the antimeridian the short way', () => {
    const r = interpolateCamera({ ...a, lng: 179 }, { ...a, lng: -179 }, 0.5);
    expect(Math.abs(r.lng)).toBeCloseTo(180, 6);
  });

  it('interpolates zoom, pitch and padding linearly', () => {
    const m = interpolateCamera(a, b, 0.25);
    expect(m.zoom).toBeCloseTo(13, 9);
    expect(m.pitch).toBeCloseTo(57 / 4, 9);
    expect(m.padding.left).toBeCloseTo(47, 9);
  });

  it('mercator helpers round-trip', () => {
    const { mercX, mercY, lngFromX, latFromY } = __mercator;
    for (const lat of [-80, -33.9, 0, 40.7, 69.6]) expect(latFromY(mercY(lat))).toBeCloseTo(lat, 9);
    for (const lng of [-179.5, -73.9, 0, 151.2]) expect(lngFromX(mercX(lng))).toBeCloseTo(lng, 9);
  });
});

describe('easeInOutCubic', () => {
  it('starts and ends at rest, symmetric, monotonic', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
    let prev = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('isFarJump', () => {
  const here = { lng: -122.42, lat: 37.77, zoom: 16 };
  it('blends short hops and flies long ones', () => {
    expect(isFarJump(here, here)).toBe(false);
    expect(isFarJump(here, { ...here, lat: here.lat + 0.002 })).toBe(false); // ~220 m
    expect(isFarJump(here, { ...here, lat: here.lat + 0.1 })).toBe(true); // ~11 km
    expect(isFarJump({ lng: -75, lat: 30, zoom: 1 }, here)).toBe(true); // from the globe
  });
});

// ---------------------------------------------------------------------------
// Controller against a fake map
// ---------------------------------------------------------------------------

type Handler = (e: Record<string, unknown>) => void;

function fakeMap(w = 852, h = 393) {
  const listeners = new Map<string, Set<Handler>>();
  const cam = { lng: -75, lat: 30, zoom: 1, bearing: 0, pitch: 0, padding: { ...NO_PAD } };
  const jumps: Record<string, unknown>[] = [];
  const flights: { options: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const eases: Record<string, unknown>[] = [];

  const fire = (type: string, e: Record<string, unknown> = {}) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, ...e });
  };
  const applyOptions = (o: Record<string, unknown>) => {
    const center = o.center as [number, number] | undefined;
    if (center) [cam.lng, cam.lat] = center;
    if (typeof o.zoom === 'number') cam.zoom = o.zoom;
    if (typeof o.bearing === 'number') cam.bearing = o.bearing;
    if (typeof o.pitch === 'number') cam.pitch = o.pitch;
    if (o.padding) cam.padding = { ...(o.padding as typeof cam.padding) };
  };

  const map = {
    getContainer: () => ({ clientWidth: w, clientHeight: h }),
    getCenter: () => ({ lng: cam.lng, lat: cam.lat }),
    getZoom: () => cam.zoom,
    getBearing: () => cam.bearing,
    getPitch: () => cam.pitch,
    getPadding: () => ({ ...cam.padding }),
    jumpTo(o: Record<string, unknown>) {
      jumps.push(o);
      applyOptions(o);
      fire('movestart');
      fire('moveend');
    },
    flyTo(options: Record<string, unknown>, data: Record<string, unknown>) {
      flights.push({ options, data });
      fire('movestart', data);
    },
    easeTo(o: Record<string, unknown>) {
      eases.push(o);
    },
    on(type: string, fn: Handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    off(type: string, fn: Handler) {
      listeners.get(type)?.delete(fn);
    },
  };

  return {
    map: map as unknown as MapboxMap,
    cam,
    jumps,
    flights,
    eases,
    fire,
    /** Finish the last flight like Mapbox does: land on the target and fire moveend with the eventData. */
    land() {
      const last = flights.at(-1)!;
      applyOptions(last.options);
      fire('moveend', last.data);
    },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

const pose = (over: Partial<PoseSnapshot> = {}): PoseSnapshot => ({
  has: true,
  lat: 37.7749,
  lng: -122.4194,
  headingDeg: 90,
  speedMps: 0,
  accuracyM: 5,
  ...over,
});

const resting = { lng: -75, lat: 30, zoom: 1, bearing: 0, pitch: 0 };

describe('createFollowCamera', () => {
  afterEach(() => ui.reset());

  it('does nothing before the first pose', () => {
    const f = fakeMap();
    const camera = createFollowCamera(f.map, resting);
    for (let i = 0; i < 10; i++) camera.tick(i * 16, 0.016, pose({ has: false }));
    expect(f.jumps).toHaveLength(0);
    expect(f.flights).toHaveLength(0);
    camera.destroy();
  });

  it('flies in on the first pose, catches up, then follows heading-up every frame', () => {
    const f = fakeMap();
    const camera = createFollowCamera(f.map, resting);
    let t = 0;
    const tick = (p: PoseSnapshot) => camera.tick((t += 16), 0.016, p);

    tick(pose());
    expect(f.flights).toHaveLength(1);
    const fly = f.flights[0].options;
    expect(fly.center).toEqual([-122.4194, 37.7749]);
    expect(fly.pitch).toBe(FOLLOW_PITCH_DEG);
    expect(fly.bearing).toBe(90);
    expect(fly.zoom).toBeCloseTo(ZOOM_SLOW, 6);
    expect(fly.padding).toEqual(followPadding(852, 393));
    expect(f.flights[0].data.dashFlyId).toEqual(expect.any(Number));

    // While flying nothing else touches the camera.
    tick(pose({ lng: -122.419 }));
    expect(f.jumps).toHaveLength(0);

    // Landing starts a catch-up blend onto the moved vehicle.
    f.land();
    for (let i = 0; i < Math.ceil(CATCH_UP_MS / 16) + 2; i++) tick(pose({ lng: -122.419 }));
    expect(f.cam.lng).toBeCloseTo(-122.419, 9);

    // Steady follow: camera = pose, heading-up.
    tick(pose({ lng: -122.418, headingDeg: 135 }));
    expect(f.cam.lng).toBeCloseTo(-122.418, 9);
    expect(f.cam.bearing).toBe(135);
    expect(f.cam.pitch).toBe(FOLLOW_PITCH_DEG);
    expect(ui.get().following).toBe(true); // our own jumpTo events never unfollow
    camera.destroy();
  });

  it('does not touch the camera while parked (nothing changed)', () => {
    const f = fakeMap();
    const camera = createFollowCamera(f.map, resting);
    camera.tick(0, 0.016, pose());
    f.land();
    for (let i = 1; i < 200; i++) camera.tick(i * 16, 0.016, pose());
    const settled = f.jumps.length;
    for (let i = 200; i < 260; i++) camera.tick(i * 16, 0.016, pose());
    expect(f.jumps.length).toBe(settled);
    camera.destroy();
  });

  it('a user gesture unfollows; recenter blends back to the live vehicle', () => {
    const f = fakeMap();
    const camera = createFollowCamera(f.map, resting);
    let t = 0;
    const tick = (p: PoseSnapshot) => camera.tick((t += 16), 0.016, p);
    tick(pose());
    f.land();
    for (let i = 0; i < 60; i++) tick(pose());

    // User drags the map away.
    f.fire('dragstart', { originalEvent: { type: 'touchmove' } });
    f.fire('movestart', { originalEvent: { type: 'touchmove' } });
    expect(ui.get().following).toBe(false);
    f.map.jumpTo({ center: [-122.43, 37.78], zoom: 15, bearing: 20, pitch: 30 });
    const jumpsBefore = f.jumps.length;
    for (let i = 0; i < 30; i++) tick(pose({ lng: -122.4194 + i * 1e-5 }));
    expect(f.jumps.length).toBe(jumpsBefore); // the camera leaves the user alone

    // Recenter (what the chip does): blend over RECENTER_MS onto the moving vehicle.
    ui.set((s) => ({ ...s, following: true }));
    tick(pose({ lng: -122.4189 }));
    const midway = f.cam.lng;
    expect(midway).toBeCloseTo(-122.43, 3); // the blend starts where the user left it
    for (let i = 0; i < Math.ceil(RECENTER_MS / 16) + 2; i++) tick(pose({ lng: -122.4189 }));
    expect(f.cam.lng).toBeCloseTo(-122.4189, 9);
    expect(f.cam.bearing).toBe(90);
    expect(f.cam.pitch).toBe(FOLLOW_PITCH_DEG);
    expect(f.flights).toHaveLength(1); // short hop: no second flight
    camera.destroy();
  });

  it('a gesture during the fly-in stops following without a fight', () => {
    const f = fakeMap();
    const camera = createFollowCamera(f.map, resting);
    camera.tick(0, 0.016, pose());
    // Mapbox stops the flight (moveend with our eventData), then reports the gesture.
    f.land();
    f.fire('movestart', { originalEvent: { type: 'touchstart' } });
    expect(ui.get().following).toBe(false);
    const n = f.jumps.length;
    for (let i = 1; i < 50; i++) camera.tick(i * 16, 0.016, pose());
    expect(f.jumps.length).toBe(n);
    camera.destroy();
  });

  it('recenter before any pose eases back to the resting view', () => {
    const f = fakeMap();
    const camera = createFollowCamera(f.map, resting);
    ui.set((s) => ({ ...s, following: false }));
    ui.set((s) => ({ ...s, following: true }));
    expect(f.eases).toHaveLength(1);
    expect(f.eases[0]).toMatchObject({ center: [-75, 30], zoom: 1, padding: restingPadding(852, 393) });
    camera.destroy();
  });

  it('zoom follows speed smoothly while following', () => {
    const f = fakeMap();
    const camera = createFollowCamera(f.map, resting);
    let t = 0;
    camera.tick(t, 0.016, pose());
    f.land();
    // Let the catch-up blend finish first (it may move the zoom faster than the follow rate).
    for (let i = 0; i < Math.ceil(CATCH_UP_MS / 16) + 2; i++) camera.tick((t += 16), 1 / 60, pose());
    const zooms: number[] = [];
    for (let i = 0; i < 60 * 15; i++) {
      camera.tick((t += 16), 1 / 60, pose({ speedMps: 30 }));
      zooms.push(f.cam.zoom);
    }
    for (let i = 1; i < zooms.length; i++) {
      expect(zooms[i]).toBeLessThanOrEqual(zooms[i - 1] + 1e-9);
      expect(zooms[i - 1] - zooms[i]).toBeLessThanOrEqual(ZOOM_MAX_RATE / 60 + 1e-6);
    }
    expect(zooms.at(-1)!).toBeCloseTo(zoomForSpeed(30), 1);
    camera.destroy();
  });

  it('destroy removes every listener it added', () => {
    const f = fakeMap();
    const camera = createFollowCamera(f.map, resting);
    expect(f.listenerCount()).toBeGreaterThan(0);
    camera.destroy();
    expect(f.listenerCount()).toBe(0);
  });
});
