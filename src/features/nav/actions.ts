/**
 * Navigation actions shared by the engine and the HUD components (kept out of component files
 * so Fast Refresh works).
 */
import { isHttpError } from '../../api/client';
import { ROUTE_QUERY_ROOT, isRouteUnavailable } from '../../api/directions';
import { nav, queryClient } from '../../state';

/** Short reason for a failed route request. */
export function routeErrorMessage(error: unknown): string {
  if (isRouteUnavailable(error)) return error.code === 'NoSegment' ? 'No road near there' : 'Can’t drive there from here';
  if (isHttpError(error)) {
    const status = error.status;
    if (status === 401 || status === 403) return 'Mapbox token rejected';
    if (status === 429) return 'Busy — wait a moment';
    if (status === 422) return 'Can’t route there';
    return 'Server didn’t answer';
  }
  if (error instanceof TypeError) return 'No connection';
  return 'Try again shortly';
}

/** Retry a failed route: back to "Finding route…" and request again. */
export function retryRoute(): void {
  void queryClient.resetQueries({ queryKey: ROUTE_QUERY_ROOT });
}

/** End navigation (cancel button). */
export function endNavigation(): void {
  nav.set((n) => (n.destination ? { ...n, destination: null } : n));
}
