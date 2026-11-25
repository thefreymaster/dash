/**
 * The nav engine's decisions as pure functions (no React, no map), so they can be tested
 * against real TanStack query results:
 *
 *   shownRoute(query, lastGood)   which route to guide along right now
 *   routeStatus(input)            what the banner and ETA chip say
 *   mayReroute(…)                 whether an off-route fix may bump `nav.rerouteNonce`
 *
 * KEEPING THE ROUTE THROUGH A REROUTE — a reroute is a new query key (`rerouteNonce`). While it
 * loads, the old route is its placeholder; if it FAILS the query has no data at all, so the
 * engine falls back to the last route that loaded for the same destination (`lastGoodRoute`,
 * read from the query cache). Guidance, progress, the line and arrival keep working on it; the
 * failed request retries by itself after `ROUTE_RETRY_MS`.
 */
import type { FetchStatus, QueryStatus } from '@tanstack/react-query';
import { isRouteUnavailable, type RouteResult } from '../../api/directions';
import { routeErrorMessage } from './actions';
import type { RouteStatus } from './navState';

/** Where the shown route comes from. */
export type RouteSource =
  /** The current query's own route. */
  | 'current'
  /** The previous reroute's route, while this one loads. */
  | 'placeholder'
  /** The last route that loaded for this destination: this request failed or has no data yet. */
  | 'fallback'
  /** Nothing to guide along. */
  | 'none';

/** The parts of a `useQuery` result the engine looks at. */
export interface RouteQueryState {
  data: RouteResult | undefined;
  isPlaceholderData: boolean;
  status: QueryStatus;
  fetchStatus: FetchStatus;
  error: unknown;
}

export interface ShownRoute {
  route: RouteResult | null;
  source: RouteSource;
}

/** The route to guide along. `lastGood` is `lastGoodRoute(client, destination)` (or `null`). */
export function shownRoute(query: RouteQueryState, lastGood: RouteResult | null): ShownRoute {
  if (query.data) return { route: query.data, source: query.isPlaceholderData ? 'placeholder' : 'current' };
  if (lastGood) return { route: lastGood, source: 'fallback' };
  return { route: null, source: 'none' };
}

export interface StatusInput {
  hasDestination: boolean;
  arrived: boolean;
  hasToken: boolean;
  /** A first fix exists. */
  hasFix: boolean;
  shown: ShownRoute;
  /** Latest progress says we are off the shown route. */
  offRoute: boolean;
  query: Pick<RouteQueryState, 'status' | 'fetchStatus' | 'error'>;
}

/** Route status and its short reason (see `RouteStatus`). */
export function routeStatus(input: StatusInput): { status: RouteStatus; message: string | null } {
  const { shown, query } = input;
  if (!input.hasDestination) return { status: 'idle', message: null };
  if (input.arrived) return { status: 'arrived', message: null };
  if (!input.hasToken) return { status: 'no-token', message: null };
  if (shown.route) {
    const inFlight = query.fetchStatus !== 'idle';
    // Off the route: the maneuver no longer applies. Say so — and why no new route came yet.
    if (input.offRoute) {
      const failed = shown.source === 'fallback' && query.status === 'error' && !inFlight;
      return { status: 'off-route', message: failed ? routeErrorMessage(query.error) : null };
    }
    // On the old route while a reroute (or its retry) is in flight: its guidance is still valid.
    if (shown.source !== 'current' && inFlight) return { status: 'rerouting', message: null };
    // Settled — or back on the old route after a failed reroute, which retries quietly.
    return { status: 'active', message: null };
  }
  if (query.status === 'error') {
    return { status: isRouteUnavailable(query.error) ? 'no-route' : 'error', message: routeErrorMessage(query.error) };
  }
  if (!input.hasFix) return { status: 'waiting-gps', message: null };
  if (query.fetchStatus === 'paused') return { status: 'offline', message: null };
  return { status: 'routing', message: null };
}

/**
 * May an off-route fix bump `nav.rerouteNonce` now? Only with a settled route on screen and no
 * request in flight. After a failed reroute the failed query retries by itself (every
 * `ROUTE_RETRY_MS`), so a new nonce is only needed when Directions said there is no route from
 * where the car was then (it will not retry that by itself).
 */
export function mayReroute(shown: ShownRoute, query: Pick<RouteQueryState, 'status' | 'fetchStatus' | 'error'>, arrived: boolean): boolean {
  if (!shown.route || arrived || query.fetchStatus !== 'idle') return false;
  if (shown.source === 'current') return true;
  return shown.source === 'fallback' && query.status === 'error' && isRouteUnavailable(query.error);
}

/** Arrival was detected for this destination selection (`rerouteNonce` at that moment). */
export interface Arrival {
  destination: object;
  rerouteNonce: number;
}

/**
 * "Arrived" belongs to one selection of a destination, never to the place itself: a new
 * selection — even of the same place, the very same object from Recent — bumps `rerouteNonce`
 * (`navigateTo`), so it starts un-arrived. (Reroutes cannot bump the nonce after arrival.)
 */
export function isArrived(arrival: Arrival | null, destination: object | null, rerouteNonce: number): boolean {
  return destination !== null && arrival !== null && arrival.destination === destination && arrival.rerouteNonce === rerouteNonce;
}
