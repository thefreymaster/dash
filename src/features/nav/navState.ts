/**
 * Navigation-local client state (TanStack Query cache via `defineClientState`, not persisted).
 * Shared intent (`nav.destination`, `nav.rerouteNonce`) and `recents` live in `src/state`.
 *
 *   searchOpen     the destination search sheet is showing
 *   searchSession  Search Box session token for the current sheet opening (billing unit)
 *   navView        what the banner and ETA chip show — written ONLY by the nav engine
 *                  (route status from the route query + ~1 Hz progress from telemetry fixes)
 */
import { newSessionToken } from '../../api/search';
import { defineClientState } from '../../state';
import type { Progress } from './progress';

export const searchOpen = defineClientState<boolean>('nav.searchOpen', false);

export const searchSession = defineClientState<string>('nav.searchSession', '');

/**
 * Route status while a destination is set:
 *   idle         no destination
 *   no-token     no Mapbox token: cannot route
 *   waiting-gps  no position yet to route from
 *   routing      first request for this destination in flight
 *   offline      request paused until the network is back
 *   active       following a route
 *   rerouting    off-route: new request in flight, old line still shown
 *   no-route     Directions found no drivable route
 *   error        request failed (network, server, bad token)
 *   arrived      the brief arrival moment, then navigation ends by itself
 */
export type RouteStatus =
  | 'idle'
  | 'no-token'
  | 'waiting-gps'
  | 'routing'
  | 'offline'
  | 'active'
  | 'rerouting'
  | 'no-route'
  | 'error'
  | 'arrived';

export interface NavView {
  status: RouteStatus;
  /** Short reason for `error` / `no-route`. */
  message: string | null;
  /** Latest progress along the current route, `null` before a route exists. */
  progress: Progress | null;
}

export const initialNavView: NavView = { status: 'idle', message: null, progress: null };

export const navView = defineClientState<NavView>('nav.view', initialNavView);

/** Open the search sheet with a fresh Search Box session. */
export function openSearchSheet(): void {
  searchSession.set(newSessionToken());
  searchOpen.set(true);
}

export function closeSearchSheet(): void {
  searchOpen.set(false);
}
