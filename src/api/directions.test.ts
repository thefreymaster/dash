import { QueryClient, QueryObserver, environmentManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Place } from '../types';
import {
  ROUTE_REFRESH_MS,
  RouteUnavailableError,
  directionsUrl,
  isRouteUnavailable,
  parseDirections,
  routeQueryKey,
  routeQueryOptions,
  sameRouteDestination,
  type RouteOrigin,
  type RouteResult,
} from './directions';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Shaped like a Directions v5 response with `geometries=geojson&overview=full&steps=true&banner_instructions=true`. */
const DIRECTIONS_RESPONSE = {
  routes: [
    {
      weight_name: 'auto',
      weight: 412.6,
      duration: 380.4,
      duration_typical: 402.1,
      distance: 2331.6,
      legs: [
        {
          via_waypoints: [],
          admins: [{ iso_3166_1_alpha3: 'USA', iso_3166_1: 'US' }],
          weight: 412.6,
          duration: 380.4,
          distance: 2331.6,
          summary: 'Embarcadero, Bay Street',
          steps: [
            {
              bannerInstructions: [
                { distanceAlongGeometry: 1200, primary: { text: 'Bay Street', components: [{ text: 'Bay Street', type: 'text' }], type: 'turn', modifier: 'left' }, secondary: null, sub: null },
              ],
              intersections: [],
              maneuver: { type: 'depart', instruction: 'Drive northwest on The Embarcadero.', bearing_after: 318, bearing_before: 0, location: [-122.395336, 37.796768] },
              name: 'The Embarcadero',
              duration: 190.2,
              distance: 1240.1,
              driving_side: 'right',
              weight: 200,
              mode: 'driving',
              geometry: { coordinates: [[-122.395336, 37.796768], [-122.399036, 37.800976], [-122.405631, 37.80669]], type: 'LineString' },
            },
            {
              bannerInstructions: [
                { distanceAlongGeometry: 900, primary: { text: 'I 80 East / Bay Bridge', components: [], type: 'on ramp', modifier: 'slight right' }, secondary: null },
              ],
              intersections: [],
              maneuver: { type: 'turn', modifier: 'left', instruction: 'Turn left onto Bay Street.', bearing_after: 262, bearing_before: 318, location: [-122.405631, 37.80669] },
              name: 'Bay Street',
              duration: 150.2,
              distance: 1091.5,
              driving_side: 'right',
              weight: 180,
              mode: 'driving',
              geometry: { coordinates: [[-122.405631, 37.80669], [-122.417163, 37.805185]], type: 'LineString' },
            },
            {
              bannerInstructions: [],
              intersections: [],
              maneuver: { type: 'on ramp', modifier: 'slight right', instruction: 'Take the ramp onto I 80 East.', bearing_after: 270, bearing_before: 262, location: [-122.417163, 37.805185] },
              name: '',
              ref: 'I 80',
              destinations: 'I 80 East: Bay Bridge',
              duration: 40,
              distance: 0,
              mode: 'driving',
              geometry: { coordinates: [[-122.417163, 37.805185], [-122.417163, 37.805185]], type: 'LineString' },
            },
            {
              intersections: [],
              maneuver: { type: 'arrive', modifier: 'right', instruction: 'Your destination is on the right.', bearing_after: 0, bearing_before: 262, location: [-122.417163, 37.805185] },
              name: 'Bay Street',
              duration: 0,
              distance: 0,
              mode: 'driving',
              geometry: { coordinates: [[-122.417163, 37.805185], [-122.417163, 37.805185]], type: 'LineString' },
            },
          ],
        },
      ],
      geometry: {
        coordinates: [
          [-122.395336, 37.796768],
          [-122.399036, 37.800976],
          [-122.405631, 37.80669],
          [-122.417163, 37.805185],
        ],
        type: 'LineString',
      },
    },
  ],
  waypoints: [
    { distance: 2.1, name: 'The Embarcadero', location: [-122.395336, 37.796768] },
    { distance: 4.3, name: 'Bay Street', location: [-122.417163, 37.805185] },
  ],
  code: 'Ok',
  uuid: 'example-uuid',
};

const PLACE: Place = { id: 'dest-1', name: 'Pier 39', lat: 37.805185, lng: -122.417163 };

describe('directionsUrl', () => {
  it('asks driving-traffic for one route with GeoJSON geometry, steps and banners', () => {
    const url = new URL(directionsUrl({ origin: [-122.3953361, 37.7967684], destination: [-122.417163, 37.805185], headingDeg: 318.4 }, 'pk.test'));
    expect(url.pathname).toBe('/directions/v5/mapbox/driving-traffic/-122.395336,37.796768;-122.417163,37.805185');
    expect(url.searchParams.get('alternatives')).toBe('false');
    expect(url.searchParams.get('geometries')).toBe('geojson');
    expect(url.searchParams.get('overview')).toBe('full');
    expect(url.searchParams.get('steps')).toBe('true');
    expect(url.searchParams.get('banner_instructions')).toBe('true');
    expect(url.searchParams.get('bearings')).toBe('318,45;');
    expect(url.searchParams.get('access_token')).toBe('pk.test');
  });

  it('omits bearings without a heading', () => {
    const url = new URL(directionsUrl({ origin: [0, 0], destination: [1, 1], headingDeg: null }, 'pk'));
    expect(url.searchParams.has('bearings')).toBe(false);
  });
});

describe('parseDirections', () => {
  it('maps the route, its line and steps', () => {
    const route = parseDirections(DIRECTIONS_RESPONSE);
    expect(route.distanceM).toBe(2331.6);
    expect(route.durationS).toBe(380.4);
    expect(route.line).toHaveLength(4);
    expect(route.line[0]).toEqual([-122.395336, 37.796768]);
    expect(route.steps).toHaveLength(4);
    expect(route.steps[0]).toMatchObject({ label: 'The Embarcadero', distanceM: 1240.1, durationS: 190.2 });
    expect(route.steps[0].maneuver).toMatchObject({ type: 'depart', modifier: null, bearingAfter: 318 });
    // The banner of the previous step names the target of this maneuver.
    expect(route.steps[1]).toMatchObject({ label: 'Bay Street' });
    expect(route.steps[1].maneuver).toEqual({
      type: 'turn',
      modifier: 'left',
      exit: null,
      location: [-122.405631, 37.80669],
      bearingAfter: 262,
      instruction: 'Turn left onto Bay Street.',
    });
    expect(route.steps[2].label).toBe('I 80 East / Bay Bridge');
    expect(route.steps[3].maneuver.type).toBe('arrive');
    expect(route.steps[3].label).toBe('');
  });

  it('falls back to name, ref, destinations for the label', () => {
    const json = structuredClone(DIRECTIONS_RESPONSE);
    for (const s of json.routes[0].legs[0].steps) s.bannerInstructions = [];
    const route = parseDirections(json);
    expect(route.steps[1].label).toBe('Bay Street');
    expect(route.steps[2].label).toBe('I 80');
  });

  it('reads roundabout exits', () => {
    const json = structuredClone(DIRECTIONS_RESPONSE) as unknown as { routes: Array<{ legs: Array<{ steps: Array<{ maneuver: Record<string, unknown> }> }> }> };
    json.routes[0].legs[0].steps[1].maneuver = { ...json.routes[0].legs[0].steps[1].maneuver, type: 'roundabout', exit: 3 };
    expect(parseDirections(json).steps[1].maneuver).toMatchObject({ type: 'roundabout', exit: 3 });
  });

  it('throws RouteUnavailableError for NoRoute / NoSegment / no routes', () => {
    const noRoute = (() => {
      try {
        parseDirections({ code: 'NoRoute', message: 'No route found', routes: [] });
      } catch (e) {
        return e;
      }
    })();
    expect(isRouteUnavailable(noRoute)).toBe(true);
    expect((noRoute as RouteUnavailableError).code).toBe('NoRoute');
    expect(() => parseDirections({ code: 'NoSegment', routes: [] })).toThrow(RouteUnavailableError);
    expect(() => parseDirections({ code: 'Ok', routes: [] })).toThrow(RouteUnavailableError);
  });

  it('throws a plain error for malformed bodies', () => {
    expect(() => parseDirections(null)).toThrow('Malformed');
    expect(() => parseDirections({ code: 'Ok', routes: [{ geometry: 'encoded_polyline' }] })).toThrow('GeoJSON');
    expect(() => parseDirections({ code: 'Ok', routes: [{ geometry: { coordinates: [[0, 0], [0, 'x']] } }] })).toThrow();
    expect(isRouteUnavailable(new Error('x'))).toBe(false);
  });
});

describe('route query', () => {
  const origin = (): RouteOrigin => ({ point: [-122.395336, 37.796768], at: 1000, headingDeg: 318, fresh: true });

  it('keys on destination and reroute nonce only (never the origin)', () => {
    expect(routeQueryKey(PLACE, 3)).toEqual(['nav', 'route', 'dest-1', 37.805185, -122.417163, 3]);
    expect(sameRouteDestination(routeQueryKey(PLACE, 0), routeQueryKey(PLACE, 1))).toBe(true);
    expect(sameRouteDestination(routeQueryKey(PLACE, 0), routeQueryKey({ ...PLACE, id: 'other' }, 0))).toBe(false);
    expect(sameRouteDestination(routeQueryKey(null, 0), routeQueryKey(null, 1))).toBe(false);
    expect(routeQueryOptions({ destination: null, rerouteNonce: 0, token: 'pk', getOrigin: origin, enabled: true }).enabled).toBe(false);
    expect(routeQueryOptions({ destination: PLACE, rerouteNonce: 0, token: '', getOrigin: origin, enabled: true }).enabled).toBe(false);
  });

  it('fetches from the origin at request time and stamps it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DIRECTIONS_RESPONSE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    const data = await client.fetchQuery(routeQueryOptions({ destination: PLACE, rerouteNonce: 0, token: 'pk', getOrigin: origin, enabled: true, now: () => 5000 }));
    expect(data).toMatchObject({ origin: [-122.395336, 37.796768], originAt: 1000, fetchedAt: 5000, distanceM: 2331.6 });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/driving-traffic/-122.395336,37.796768;-122.417163,37.805185?');
    client.clear();
  });

  it('a refresh without a fresh fix keeps the current route instead of failing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DIRECTIONS_RESPONSE), { status: 200 })));
    const client = new QueryClient();
    let fresh = true;
    const opts = routeQueryOptions({ destination: PLACE, rerouteNonce: 0, token: 'pk', getOrigin: () => ({ ...origin(), fresh }), enabled: true });
    const first = await client.fetchQuery(opts);
    fresh = false;
    const again = await client.fetchQuery({ ...opts, staleTime: 0 });
    expect(again).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('does not retry NoRoute, and stops the refresh timer for it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 'NoRoute', routes: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    const opts = routeQueryOptions({ destination: PLACE, rerouteNonce: 0, token: 'pk', getOrigin: origin, enabled: true });
    const error = await client.fetchQuery(opts).catch((e: unknown) => e);
    expect(isRouteUnavailable(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const query = client.getQueryCache().find({ queryKey: opts.queryKey })!;
    expect(typeof opts.refetchInterval === 'function' && opts.refetchInterval(query as never)).toBe(false);
    client.clear();
  });

  it('refreshes every 2 minutes with one observer, and new fixes alone never refetch', async () => {
    // Node has no `window`, so TanStack treats it as a server and schedules no interval timers.
    environmentManager.setIsServer(() => false);
    onTestFinished(() => environmentManager.setIsServer(() => typeof window === 'undefined'));
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DIRECTIONS_RESPONSE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    let fixTime = 1000;
    const observer = new QueryObserver<RouteResult>(
      client,
      routeQueryOptions({
        destination: PLACE,
        rerouteNonce: 0,
        token: 'pk',
        getOrigin: () => ({ point: [-122.395336, 37.796768], at: fixTime, headingDeg: null, fresh: true }),
        enabled: true,
      }) as never,
    );
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (let s = 0; s < 119; s++) {
      fixTime += 1000; // fixes keep coming; the key does not change
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ROUTE_REFRESH_MS - 119_000 + 10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(58 * 60_000); // an hour in total
    expect(fetchMock).toHaveBeenCalledTimes(1 + 30);
    unsubscribe();
    client.clear();
  });
});
