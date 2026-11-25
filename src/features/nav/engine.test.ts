import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../api/client';
import { RouteUnavailableError, lastGoodRoute, routeQueryOptions, type RouteResult } from '../../api/directions';
import { nav, recents } from '../../state';
import type { Place } from '../../types';
import { endNavigation, navigateTo } from './actions';
import { isArrived, mayReroute, routeStatus, shownRoute, type RouteQueryState, type ShownRoute } from './engine';

afterEach(() => {
  vi.unstubAllGlobals();
  nav.reset();
  recents.reset();
});

const DIRECTIONS = {
  code: 'Ok',
  routes: [
    {
      distance: 1000,
      duration: 100,
      geometry: { type: 'LineString', coordinates: [[-122.4, 37.7], [-122.39, 37.7]] },
      legs: [{ steps: [] }],
    },
  ],
};
const DEST: Place = { id: 'x', name: 'X', lat: 37.7, lng: -122.39 };
const ROUTE = { line: [[0, 0], [1, 1]] } as unknown as RouteResult;

const q = (over: Partial<RouteQueryState> = {}): RouteQueryState => ({
  data: undefined,
  isPlaceholderData: false,
  status: 'pending',
  fetchStatus: 'idle',
  error: null,
  ...over,
});
const status = (shown: ShownRoute, query: RouteQueryState, offRoute = false, extra: Partial<Parameters<typeof routeStatus>[0]> = {}) =>
  routeStatus({ hasDestination: true, arrived: false, hasToken: true, hasFix: true, shown, offRoute, query, ...extra });

describe('a reroute that fails keeps guiding along the last good route (ported review repro)', () => {
  it('the engine still has the old route, tracks against it and says it is off route', async () => {
    let fail = false;
    vi.stubGlobal('fetch', async () => {
      if (fail) throw new TypeError('Load failed');
      return new Response(JSON.stringify(DIRECTIONS), { status: 200 });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    const getOrigin = () => ({ point: [-122.4, 37.7] as [number, number], at: 1, headingDeg: null, fresh: true });
    const options = (rerouteNonce: number) => routeQueryOptions({ destination: DEST, rerouteNonce, token: 't', getOrigin, enabled: true }) as never;
    const observer = new QueryObserver<RouteResult>(client, options(0));
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBeTruthy());
    const good = observer.getCurrentResult().data!;

    // What NavEngine computes each render: `shownRoute(query, lastGoodRoute(...))`.
    const engineView = (offRoute: boolean) => {
      const result = observer.getCurrentResult();
      const shown = shownRoute(result, result.data ? null : lastGoodRoute(client, DEST));
      return { shown, ...status(shown, result, offRoute), mayReroute: mayReroute(shown, result, false) };
    };
    expect(engineView(false)).toMatchObject({ shown: { route: good, source: 'current' }, status: 'active', mayReroute: true });

    fail = true;
    observer.setOptions(options(1)); // off-route → nonce bumped
    expect(engineView(true)).toMatchObject({ shown: { route: good, source: 'placeholder' }, status: 'off-route', message: null, mayReroute: false });
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('error'));

    // Before the fix the route was `query.data` → null here: line erased, tracking stopped, "Route failed".
    const failed = engineView(true);
    expect(failed.shown).toEqual({ route: good, source: 'fallback' });
    expect(failed.status).toBe('off-route');
    expect(failed.message).toBe('No connection');
    // The failed query retries by itself (20 s); no extra nonce bump needed.
    expect(failed.mayReroute).toBe(false);
    // Back on the old route: its guidance is valid again.
    expect(engineView(false).status).toBe('active');
    unsubscribe();
    client.clear();
  });
});

describe('routeStatus', () => {
  it('covers the states without a route', () => {
    const none: ShownRoute = { route: null, source: 'none' };
    expect(routeStatus({ hasDestination: false, arrived: false, hasToken: true, hasFix: true, shown: none, offRoute: false, query: q() }).status).toBe('idle');
    expect(status(none, q(), false, { arrived: true }).status).toBe('arrived');
    expect(status(none, q(), false, { hasToken: false }).status).toBe('no-token');
    expect(status(none, q(), false, { hasFix: false }).status).toBe('waiting-gps');
    expect(status(none, q({ fetchStatus: 'fetching' })).status).toBe('routing');
    expect(status(none, q({ fetchStatus: 'paused' })).status).toBe('offline');
    expect(status(none, q({ status: 'error', error: new RouteUnavailableError('NoRoute') }))).toEqual({ status: 'no-route', message: 'Can’t drive there from here' });
    expect(status(none, q({ status: 'error', error: new HttpError(401, '', 'u', '') }))).toEqual({ status: 'error', message: 'Map service refused this build' });
  });

  it('off-route wins over guidance whenever the car has left the route (regression: frozen "In 400 ft, turn right")', () => {
    const current: ShownRoute = { route: ROUTE, source: 'current' };
    expect(status(current, q({ data: ROUTE, status: 'success' }), false).status).toBe('active');
    expect(status(current, q({ data: ROUTE, status: 'success' }), true)).toEqual({ status: 'off-route', message: null });
    // The 2-minute refresh in flight is not a reroute.
    expect(status(current, q({ data: ROUTE, status: 'success', fetchStatus: 'fetching' })).status).toBe('active');
  });

  it('on the old route while a reroute is in flight → rerouting; after it failed → active (retrying quietly)', () => {
    const placeholder: ShownRoute = { route: ROUTE, source: 'placeholder' };
    const fallback: ShownRoute = { route: ROUTE, source: 'fallback' };
    expect(status(placeholder, q({ data: ROUTE, isPlaceholderData: true, fetchStatus: 'fetching' })).status).toBe('rerouting');
    expect(status(fallback, q({ status: 'error', error: new TypeError('x'), fetchStatus: 'fetching' })).status).toBe('rerouting');
    expect(status(fallback, q({ status: 'error', error: new TypeError('x') })).status).toBe('active');
    expect(status(fallback, q({ status: 'error', error: new DOMException('t', 'TimeoutError') }), true)).toEqual({ status: 'off-route', message: 'Connection too slow' });
  });
});

describe('mayReroute', () => {
  it('only with a settled route and nothing in flight; after a NoRoute reroute it may try again from a new place', () => {
    const current: ShownRoute = { route: ROUTE, source: 'current' };
    const fallback: ShownRoute = { route: ROUTE, source: 'fallback' };
    expect(mayReroute(current, q({ status: 'success' }), false)).toBe(true);
    expect(mayReroute(current, q({ status: 'success', fetchStatus: 'fetching' }), false)).toBe(false);
    expect(mayReroute(current, q({ status: 'success' }), true)).toBe(false);
    expect(mayReroute({ route: ROUTE, source: 'placeholder' }, q({ fetchStatus: 'fetching' }), false)).toBe(false);
    expect(mayReroute(fallback, q({ status: 'error', error: new TypeError('x') }), false)).toBe(false);
    expect(mayReroute(fallback, q({ status: 'error', error: new RouteUnavailableError('NoSegment') }), false)).toBe(true);
    expect(mayReroute({ route: null, source: 'none' }, q({ status: 'error' }), false)).toBe(false);
  });
});

describe('re-picking the place you just arrived at (ported review repro)', () => {
  /** What the engine records when progress says "arrived". */
  const arrivalNow = () => ({ destination: nav.get().destination!, rerouteNonce: nav.get().rerouteNonce });
  const arrivedNow = (arrival: ReturnType<typeof arrivalNow>) => isArrived(arrival, nav.get().destination, nav.get().rerouteNonce);

  it('starts a new navigation instead of ending at once', () => {
    const fromSearch: Place = { id: 'poi.1', name: 'Home', lat: 37.7, lng: -122.4, address: '1 Main St' };
    navigateTo(fromSearch);
    const arrival = arrivalNow();
    expect(arrivedNow(arrival)).toBe(true);
    endNavigation(); // the arrival hold ends navigation
    expect(arrivedNow(arrival)).toBe(false);
    // Later: the same row in Recent (the only option while moving) — the very same object.
    const tapped = recents.get()[0];
    expect(tapped).toBe(arrival.destination);
    navigateTo(tapped);
    expect(nav.get().destination).toBe(tapped);
    expect(arrivedNow(arrival)).toBe(false);
  });

  it('…even when picked again during the arrival moment, before navigation ended', () => {
    const place: Place = { id: 'poi.2', name: 'Work', lat: 37.79, lng: -122.4 };
    navigateTo(place);
    const arrival = arrivalNow();
    navigateTo(recents.get()[0]);
    expect(nav.get().destination).toBe(arrival.destination); // structural sharing keeps the object…
    expect(arrivedNow(arrival)).toBe(false); // …but it is a new selection
  });

  it('reroutes never change which selection arrived (they cannot happen after arrival anyway)', () => {
    const d = { id: 'a' };
    expect(isArrived({ destination: d, rerouteNonce: 3 }, d, 3)).toBe(true);
    expect(isArrived({ destination: d, rerouteNonce: 3 }, { id: 'a' }, 3)).toBe(false);
    expect(isArrived(null, d, 3)).toBe(false);
    expect(isArrived({ destination: d, rerouteNonce: 3 }, null, 3)).toBe(false);
  });
});
