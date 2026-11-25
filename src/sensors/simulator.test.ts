import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destinationPoint, haversineM, mphToMps } from '../lib';
import { telemetry } from '../state';
import type { LngLat } from '../types';
import {
  INITIAL_SIM_STATE,
  SIM_FALLBACK_LOOP,
  SIM_MAX_CRUISE_MPS,
  SIM_MIN_CRUISE_MPS,
  SIM_RIGHT_ANGLE_SPEED_MPS,
  SIM_STOP_MAX_S,
  SIM_STOP_MIN_S,
  SIM_WAYPOINTS,
  advanceSim,
  buildSimRoute,
  closeLoop,
  cornerSpeedMps,
  cruiseSpeedMps,
  directionsUrl,
  hash01,
  headingAlong,
  loadSimLine,
  parseDemoParam,
  parseDirectionsLine,
  pointAlong,
  SIM_ROUTE_PAD_M,
  buildRouteSimRoute,
  isSimDrivingRoute,
  simDriveRoute,
  simFix,
  simReleaseRoute,
  startSimulator,
  stopSimulator,
  type SimRoute,
  type SimState,
} from './simulator';
import { fakeTimers } from './testUtils';

const START: LngLat = [-122.4, 37.79];
/** Clockwise loop: `legs` = [bearing, metres][]. */
function loop(legs: Array<[number, number]>): LngLat[] {
  const pts: LngLat[] = [START];
  for (const [bearing, m] of legs) pts.push(destinationPoint(pts[pts.length - 1], bearing, m));
  return pts;
}
const RECT = loop([
  [90, 400],
  [180, 300],
  [270, 400],
]); // closes back north 300 m
const LONG = loop([
  [90, 4000],
  [180, 200],
  [270, 4000],
]);

/** Simulate `seconds` in 0.1 s ticks, recording every state. */
function drive(route: SimRoute, seconds: number, state: SimState = INITIAL_SIM_STATE) {
  const states: SimState[] = [state];
  let s = state;
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    s = advanceSim(s, route, 0.1);
    states.push(s);
  }
  return states;
}

describe('route geometry', () => {
  it('closeLoop drops duplicates and closes the ring once', () => {
    const ring = closeLoop([START, START, [-122.39, 37.79], [-122.39, 37.8], START]);
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
  });

  it('pointAlong interpolates and wraps around the loop', () => {
    const r = buildSimRoute(RECT);
    expect(r.totalM).toBeCloseTo(1400, -1);
    expect(haversineM(pointAlong(r, 0), START)).toBeLessThan(0.01);
    expect(haversineM(pointAlong(r, r.totalM), START)).toBeLessThan(0.01);
    expect(haversineM(pointAlong(r, 200), destinationPoint(START, 90, 200))).toBeLessThan(0.5);
    expect(haversineM(pointAlong(r, -100), pointAlong(r, r.totalM - 100))).toBeLessThan(0.01);
    expect(headingAlong(r, 200)).toBeCloseTo(90, 0);
    expect(headingAlong(r, 550)).toBeCloseTo(180, 0);
  });

  it('finds the four right-angle corners, their stop lines and a light on the long side', () => {
    const r = buildSimRoute(RECT);
    expect(r.corners.map((c) => Math.round(c.alongM / 10) * 10)).toEqual([0, 400, 700, 1100]);
    for (const c of r.corners) {
      expect(c.turnDeg).toBeCloseTo(90, -1);
      expect(c.maxSpeedMps).toBeCloseTo(SIM_RIGHT_ANGLE_SPEED_MPS, 3);
    }
    expect(r.stops.map((s) => Math.round(s.alongM))).toEqual([394, 694, 900, 1094, Math.round(r.totalM - 6)]);
  });

  it('corner speed falls with sharper turns', () => {
    expect(cornerSpeedMps(10)).toBe(Infinity);
    expect(cornerSpeedMps(-45)).toBeCloseTo(cornerSpeedMps(45), 9);
    expect(cornerSpeedMps(45)).toBeGreaterThan(cornerSpeedMps(70));
    expect(cornerSpeedMps(90)).toBe(SIM_RIGHT_ANGLE_SPEED_MPS);
    expect(cornerSpeedMps(170)).toBeLessThan(SIM_RIGHT_ANGLE_SPEED_MPS);
  });

  it('builds from the shipped fallback loop', () => {
    const r = buildSimRoute(SIM_FALLBACK_LOOP);
    expect(r.totalM).toBeGreaterThan(6000);
    expect(r.totalM).toBeLessThan(9000);
    expect(r.corners.length).toBe(5); // Embarcadero→Bay, Bay→Van Ness, Van Ness→California, California→Drumm, →Embarcadero
  });
});

describe('speed profile', () => {
  it('hash01 is deterministic and in [0, 1)', () => {
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
    for (let i = 0; i < 1000; i++) {
      const h = hash01(7, i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('cruise speed stays within 25–45 mph and changes smoothly', () => {
    let min = Infinity;
    let max = 0;
    for (let odo = 0; odo < 20_000; odo += 5) {
      const v = cruiseSpeedMps(odo);
      min = Math.min(min, v);
      max = Math.max(max, v);
      expect(Math.abs(cruiseSpeedMps(odo + 1) - v)).toBeLessThan(0.1);
    }
    expect(min).toBeGreaterThanOrEqual(SIM_MIN_CRUISE_MPS);
    expect(max).toBeLessThanOrEqual(SIM_MAX_CRUISE_MPS);
    expect(max - min).toBeGreaterThan(mphToMps(10)); // real variation
  });
});

describe('advanceSim', () => {
  it('starts parked, pulls away and accelerates gently', () => {
    const states = drive(buildSimRoute(LONG), 12);
    expect(states[10].speedMps).toBe(0); // 1 s in: still parked
    expect(states[120].speedMps).toBeGreaterThan(mphToMps(20));
    for (let i = 1; i < states.length; i++) {
      expect(states[i].speedMps - states[i - 1].speedMps).toBeLessThanOrEqual(0.2 + 1e-9); // ≤ 2 m/s²
    }
  });

  it('cruises between 25 and 45 mph on long straights, never faster, never backwards', () => {
    const states = drive(buildSimRoute(LONG), 900);
    const speeds = states.map((s) => s.speedMps);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(SIM_MAX_CRUISE_MPS + 1e-9);
    expect(Math.max(...speeds)).toBeGreaterThan(mphToMps(32));
    const cruising = speeds.filter((v) => v >= mphToMps(24.5)).length / speeds.length;
    expect(cruising).toBeGreaterThan(0.5);
    for (let i = 1; i < states.length; i++) {
      expect(states[i].odoM).toBeGreaterThanOrEqual(states[i - 1].odoM);
      expect(states[i].speedMps).toBeGreaterThanOrEqual(0);
    }
  });

  it('slows for every corner', () => {
    const route = buildSimRoute(RECT);
    const states = drive(route, 600);
    let checked = 0;
    for (let i = 1; i < states.length; i++) {
      for (const c of route.corners) {
        const lap = Math.floor(states[i].odoM / route.totalM);
        const at = lap * route.totalM + c.alongM;
        if (states[i - 1].odoM < at && states[i].odoM >= at) {
          expect(states[i].speedMps).toBeLessThanOrEqual(c.maxSpeedMps + 1);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  it('stops now and then for a few seconds, then drives on, and loops forever', () => {
    const route = buildSimRoute(LONG);
    const states = drive(route, 1800);
    // Collect stop episodes after the initial parked hold.
    const episodes: number[] = [];
    let run = 0;
    for (const s of states.slice(30)) {
      if (s.speedMps === 0) run++;
      else if (run > 0) {
        episodes.push(run / 10);
        run = 0;
      }
    }
    expect(episodes.length).toBeGreaterThanOrEqual(3);
    for (const d of episodes) {
      expect(d).toBeGreaterThanOrEqual(SIM_STOP_MIN_S - 0.2);
      expect(d).toBeLessThanOrEqual(SIM_STOP_MAX_S + 0.2);
    }
    expect(states[states.length - 1].odoM).toBeGreaterThan(route.totalM); // past one full lap
    // Position along the ring is continuous (no teleport at the lap seam).
    for (let i = 1; i < states.length; i++) {
      const jump = haversineM(pointAlong(route, states[i - 1].odoM), pointAlong(route, states[i].odoM));
      expect(jump).toBeLessThanOrEqual(SIM_MAX_CRUISE_MPS * 0.1 + 0.05);
    }
  });

  it('is deterministic and independent of how time is chopped up', () => {
    const route = buildSimRoute(RECT);
    let a = INITIAL_SIM_STATE;
    for (let i = 0; i < 60; i++) a = advanceSim(a, route, 1);
    const b = advanceSim(INITIAL_SIM_STATE, route, 60);
    expect(a.odoM).toBeCloseTo(b.odoM, 6);
    expect(a.speedMps).toBeCloseTo(b.speedMps, 6);
    expect(advanceSim(a, route, 0)).toBe(a);
  });
});

describe('simFix', () => {
  const route = buildSimRoute(RECT);

  it('reports position, speed, heading along the road and noisy accuracy', () => {
    const fix = simFix({ ...INITIAL_SIM_STATE, odoM: 200, speedMps: 12.3456, holdS: 0 }, route, 1234, 0.5);
    expect(haversineM([fix.lng, fix.lat], pointAlong(route, 200))).toBeLessThan(0.01);
    expect(fix.speedMps).toBe(12.35);
    expect(fix.headingDeg).toBeCloseTo(90, 0);
    expect(fix.accuracyM).toBeCloseTo(6.5, 6);
    expect(fix.timestamp).toBe(1234);
  });

  it('has no heading when stopped, like iOS', () => {
    expect(simFix(INITIAL_SIM_STATE, route, 0, 0).headingDeg).toBeNull();
    expect(simFix(INITIAL_SIM_STATE, route, 0, 0).speedMps).toBe(0);
  });
});

describe('demo flag and directions', () => {
  it('parses ?demo=1', () => {
    expect(parseDemoParam('?demo=1')).toBe(true);
    expect(parseDemoParam('?x=2&demo=true')).toBe(true);
    expect(parseDemoParam('?demo=0')).toBe(false);
    expect(parseDemoParam('')).toBe(false);
  });

  it('builds a closed driving loop request', () => {
    const url = directionsUrl(SIM_WAYPOINTS, 'pk.test');
    expect(url.startsWith('https://api.mapbox.com/directions/v5/mapbox/driving/')).toBe(true);
    const coords = url.split('/driving/')[1].split('?')[0].split(';');
    expect(coords).toHaveLength(SIM_WAYPOINTS.length + 1);
    expect(coords[0]).toBe(coords[coords.length - 1]);
    expect(url).toContain('geometries=geojson');
    expect(url).toContain('overview=full');
    expect(url).toContain('access_token=pk.test');
  });

  it('parses the route line and rejects malformed responses', () => {
    const line = [
      [-122.4, 37.79],
      [-122.39, 37.79],
    ];
    expect(parseDirectionsLine({ routes: [{ geometry: { coordinates: line } }] })).toEqual(line);
    expect(parseDirectionsLine({ routes: [] })).toBeNull();
    expect(parseDirectionsLine({ routes: [{ geometry: { coordinates: [[1, 'x']] } }] })).toBeNull();
    expect(parseDirectionsLine(null)).toBeNull();
  });

  it('uses Directions with a token, the fallback without one or on failure', async () => {
    const routed = loop([
      [90, 300],
      [180, 300],
      [270, 300],
    ]);
    await expect(loadSimLine({ token: '' })).resolves.toMatchObject({ routed: false });
    const ok = await loadSimLine({
      token: 'pk.test',
      fetcher: () => Promise.resolve({ routes: [{ geometry: { coordinates: routed } }] }),
    });
    expect(ok).toEqual({ line: routed, routed: true });
    const failed = await loadSimLine({ token: 'pk.test', fetcher: () => Promise.reject(new Error('offline')) });
    expect(failed.routed).toBe(false);
    expect(failed.line).toEqual(SIM_FALLBACK_LOOP.map((p) => [...p]));
    const junk = await loadSimLine({ token: 'pk.test', fetcher: () => Promise.resolve({ message: 'Not Authorized' }) });
    expect(junk.routed).toBe(false);
  });
});

describe('simulator driver', () => {
  beforeEach(() => telemetry.reset());
  afterEach(() => {
    stopSimulator();
    telemetry.reset();
  });

  it('feeds the fix pipeline once a second with source "sim"', async () => {
    const timers = fakeTimers(5_000_000);
    startSimulator({ now: timers.now, timers, random: () => 0.5, loadLine: () => Promise.resolve(LONG), doc: null });
    expect(telemetry.get()).toMatchObject({ source: 'sim', status: 'requesting', fix: null });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const first = telemetry.get().fix;
    expect(telemetry.get().status).toBe('tracking');
    expect(first).not.toBeNull();
    expect(haversineM([first!.lng, first!.lat], START)).toBeLessThan(0.01);

    timers.advance(10_000);
    const t = telemetry.get();
    expect(t.fix!.timestamp).toBe(5_010_000);
    expect(t.speedMps).toBeGreaterThan(0);
    expect(t.headingDeg).toBeCloseTo(90, 0);

    stopSimulator();
    timers.advance(5_000);
    expect(telemetry.get().fix!.timestamp).toBe(5_010_000);
    expect(timers.pending()).toBe(0);
  });
});

describe('navigation hand-off (demo mode)', () => {
  /** An open route: east 600 m, north 400 m. */
  const NAV: LngLat[] = (() => {
    const pts: LngLat[] = [START];
    for (const [bearing, m] of [
      [90, 600],
      [0, 400],
    ] as Array<[number, number]>) {
      const from = pts[pts.length - 1];
      for (let k = 1; k <= 10; k++) pts.push(destinationPoint(from, bearing, (m * k) / 10));
    }
    return pts;
  })();
  const NAV_END = NAV[NAV.length - 1];

  it('buildRouteSimRoute pads an open line and marks its start and end', () => {
    const r = buildRouteSimRoute(NAV);
    expect(r.startM).toBeCloseTo(SIM_ROUTE_PAD_M, 3);
    expect(r.endM - r.startM).toBeCloseTo(1000, 0);
    expect(haversineM(pointAlong(r, r.startM), START)).toBeLessThan(0.01);
    expect(haversineM(pointAlong(r, r.endM), NAV_END)).toBeLessThan(0.01);
    expect(r.corners.some((c) => Math.abs(c.alongM - (r.startM + 600)) < 5)).toBe(true); // the real corner
    expect(() => buildRouteSimRoute([START, START])).toThrow();
  });

  it('drives the route once, stops at its end and waits there', () => {
    const r = buildRouteSimRoute(NAV);
    const states = drive(r, 400, { odoM: r.startM, speedMps: 10, holdS: 0, servedStopOdoM: r.startM });
    for (const s of states) expect(s.odoM).toBeLessThanOrEqual(r.endM + 1e-6);
    const last = states[states.length - 1];
    expect(last.odoM).toBeCloseTo(r.endM, 3);
    expect(last.speedMps).toBe(0);
    expect(last.holdS).toBe(Infinity);
    expect(haversineM(pointAlong(r, last.odoM), NAV_END)).toBeLessThan(0.5);
    // It slowed down for the right-angle corner on the way.
    const corner = r.startM + 600;
    const at = states.findIndex((s) => s.odoM >= corner);
    expect(states[at].speedMps).toBeLessThanOrEqual(SIM_RIGHT_ANGLE_SPEED_MPS + 1);
  });

  describe('driver', () => {
    beforeEach(() => telemetry.reset());
    afterEach(() => {
      stopSimulator();
      telemetry.reset();
    });

    const flush = async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    };

    it('returns false when the simulator is not running or the line is unusable', () => {
      expect(simDriveRoute(NAV)).toBe(false);
      simReleaseRoute(); // no-op
      expect(isSimDrivingRoute()).toBe(false);
    });

    it('drives a handed route from the current position, then goes back to the loop', async () => {
      const timers = fakeTimers(5_000_000);
      startSimulator({ now: timers.now, timers, random: () => 0.5, loadLine: () => Promise.resolve(LONG), doc: null });
      await flush();
      timers.advance(20_000); // pulled away along the loop (heading east)
      const here = telemetry.get().fix!;
      const from: LngLat = [here.lng, here.lat];
      expect(simDriveRoute([[0, 0]])).toBe(false);
      expect(isSimDrivingRoute()).toBe(false);

      // A route that starts where the car is and turns north 500 m later.
      const turn = destinationPoint(from, 90, 500);
      const line: LngLat[] = [from, destinationPoint(from, 90, 250), turn, destinationPoint(turn, 0, 300)];
      expect(simDriveRoute(line)).toBe(true);
      expect(isSimDrivingRoute()).toBe(true);
      timers.advance(1000);
      const first = telemetry.get().fix!;
      expect(haversineM([first.lng, first.lat], from)).toBeLessThan(25); // no jump: it carried on from here
      expect(first.speedMps).toBeGreaterThan(0);

      timers.advance(180_000);
      const parked = telemetry.get();
      expect(haversineM([parked.fix!.lng, parked.fix!.lat], line[line.length - 1])).toBeLessThan(1);
      expect(parked.fix!.speedMps).toBe(0);

      simReleaseRoute();
      expect(isSimDrivingRoute()).toBe(false);
      timers.advance(1000);
      const back = telemetry.get().fix!;
      const loopRoute = buildSimRoute(LONG);
      let nearest = Infinity;
      for (let s = 0; s < loopRoute.totalM; s += 2) nearest = Math.min(nearest, haversineM(pointAlong(loopRoute, s), [back.lng, back.lat]));
      expect(nearest).toBeLessThan(2); // on the loop again
    });

    it('takes a route handed over before the loop has loaded', async () => {
      const timers = fakeTimers(5_000_000);
      let resolveLine: (line: LngLat[]) => void = () => {};
      startSimulator({ now: timers.now, timers, random: () => 0.5, loadLine: () => new Promise((r) => (resolveLine = r)), doc: null });
      expect(simDriveRoute(NAV)).toBe(true);
      expect(isSimDrivingRoute()).toBe(true);
      resolveLine(LONG);
      await flush();
      const fix = telemetry.get().fix!;
      expect(haversineM([fix.lng, fix.lat], START)).toBeLessThan(1); // at the route's start
      timers.advance(400_000);
      const end = telemetry.get().fix!;
      expect(haversineM([end.lng, end.lat], NAV_END)).toBeLessThan(1);
    });
  });
});
