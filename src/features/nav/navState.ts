/**
 * Navigation-local client state (TanStack Query cache via `defineClientState`, not persisted).
 * Shared intent (`nav.destination`, `nav.rerouteNonce`) and `recents` live in `src/state`.
 *
 *   searchOpen     the destination search sheet is showing
 *   searchSession  Search Box session token for the current sheet opening (billing unit)
 *   searchOrigin   position the current sheet opening searches around, frozen when it opened
 *                  (GPS wander while parked must not re-request the same text)
 *   typingLock     whether typing a destination is allowed now, and why (see `format.ts`);
 *                  kept current from `telemetry` for the whole session
 *   navView        what the banner and ETA chip show — written ONLY by the nav engine
 *                  (route status from the route query + ~1 Hz progress from telemetry fixes)
 */
import { newSessionToken, roundProximity } from '../../api/search';
import { defineClientState, telemetry } from '../../state';
import type { LngLat, Telemetry } from '../../types';
import { INITIAL_TYPING_LOCK, nextTypingLock, type TypingLock } from './format';
import type { Progress } from './progress';

export const searchOpen = defineClientState<boolean>('nav.searchOpen', false);

export const searchSession = defineClientState<string>('nav.searchSession', '');

export const searchOrigin = defineClientState<LngLat | null>('nav.searchOrigin', null);

export const typingLock = defineClientState<TypingLock>('nav.typingLock', nextTypingLock(INITIAL_TYPING_LOCK, telemetry.get()));

// Session-wide, from the first import: "seen moving" must count even while the sheet is closed.
const stopFollowingTelemetry = telemetry.subscribe((t) => {
  typingLock.set((prev) => nextTypingLock(prev, t));
  if (searchOpen.get()) adoptFirstSearchOrigin(t);
});
// Vite HMR re-runs this module: do not stack subscriptions.
if (import.meta.hot) import.meta.hot.dispose(stopFollowingTelemetry);

/**
 * Route status while a destination is set:
 *   idle         no destination
 *   no-token     no Mapbox token: cannot route
 *   waiting-gps  no position yet to route from
 *   routing      first request for this destination in flight
 *   offline      request paused until the network is back
 *   active       following a route
 *   off-route    the car left the route: the maneuver no longer applies; a reroute is coming
 *                (or failed — `message` says why — and retries by itself). Progress is frozen.
 *   rerouting    back on the previous route while a reroute (or its retry) is in flight:
 *                its guidance still applies, the ETA is about to change
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
  | 'off-route'
  | 'rerouting'
  | 'no-route'
  | 'error'
  | 'arrived';

export interface NavView {
  status: RouteStatus;
  /** Short reason for `error` / `no-route`, or why an `off-route` reroute has not arrived. */
  message: string | null;
  /** Latest progress along the current route, `null` before a route exists. */
  progress: Progress | null;
}

export const initialNavView: NavView = { status: 'idle', message: null, progress: null };

export const navView = defineClientState<NavView>('nav.view', initialNavView);

/** Where the current fix is, rounded like the search cache key, or `null`. */
function originOf(t: Pick<Telemetry, 'fix'>): LngLat | null {
  return t.fix ? roundProximity([t.fix.lng, t.fix.lat]) : null;
}

/** Open the search sheet with a fresh Search Box session, searching around where we are now. */
export function openSearchSheet(): void {
  searchSession.set(newSessionToken());
  searchOrigin.set(originOf(telemetry.get()));
  searchOpen.set(true);
}

/** The sheet opened before the first fix: search around the first position once it arrives (then it stays). */
function adoptFirstSearchOrigin(t: Pick<Telemetry, 'fix'>): void {
  if (searchOrigin.get() !== null) return;
  const origin = originOf(t);
  if (origin) searchOrigin.set(origin);
}

export function closeSearchSheet(): void {
  searchOpen.set(false);
}
