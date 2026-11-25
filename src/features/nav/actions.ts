/**
 * Navigation actions shared by the engine and the HUD components (kept out of component files
 * so Fast Refresh works).
 */
import { isHttpError, isTimeoutError } from '../../api/client';
import { ROUTE_QUERY_ROOT, isRouteUnavailable } from '../../api/directions';
import { addRecent, nav, queryClient } from '../../state';
import type { Place } from '../../types';

/** Short reason for a failed route request. */
export function routeErrorMessage(error: unknown): string {
  if (isRouteUnavailable(error)) return error.code === 'NoSegment' ? 'No road near there' : 'Can’t drive there from here';
  if (isHttpError(error)) {
    const status = error.status;
    if (status === 401 || status === 403) return 'Map service refused this build';
    if (status === 429) return 'Busy — wait a moment';
    if (status === 422) return 'Can’t route there';
    return 'Server didn’t answer';
  }
  if (isTimeoutError(error)) return 'Connection too slow';
  if (error instanceof TypeError) return 'No connection';
  return 'Try again shortly';
}

/**
 * Navigate to `place` and remember it in Recent. Every selection bumps `rerouteNonce`, so it
 * is a new navigation even when it is the same place (the same object, from Recent): "arrived"
 * belongs to one selection (see `isArrived`), and the route is requested fresh from here.
 */
export function navigateTo(place: Place): void {
  nav.set((n) => ({ ...n, destination: place, rerouteNonce: n.rerouteNonce + 1 }));
  addRecent(place);
}

/** Retry a failed route: back to "Finding route…" and request again (only the route on screen). */
export function retryRoute(): void {
  void queryClient.resetQueries({ queryKey: ROUTE_QUERY_ROOT, type: 'active' });
}

/** End navigation (cancel button). */
export function endNavigation(): void {
  nav.set((n) => (n.destination ? { ...n, destination: null } : n));
}
