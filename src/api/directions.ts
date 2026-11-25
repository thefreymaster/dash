/**
 * Mapbox Directions API (v5) — the navigation route (T27).
 *
 *   GET https://api.mapbox.com/directions/v5/mapbox/driving-traffic/{lng},{lat};{lng},{lat}
 *       ?alternatives=false&geometries=geojson&overview=full&steps=true&banner_instructions=true
 *       [&bearings={heading},45;]&access_token=…
 *   → { code: 'Ok' | 'NoRoute' | 'NoSegment' | …, routes: [{ distance (m), duration (s),
 *        duration_typical?, geometry: { type: 'LineString', coordinates }, legs: [{ steps: [{
 *        distance, duration, name, ref?, destinations?, maneuver: { type, modifier?, exit?,
 *        location, bearing_after, instruction }, bannerInstructions?: [{ primary: { text } }] }] }] }] }
 *   `NoRoute` / `NoSegment` arrive with HTTP 200; bad token 401, bad profile 404, bad input 422.
 *   Limit 300 requests/minute.
 *
 * `bearings` gives the origin the vehicle's heading (±45°) so a route requested while moving
 * starts in the direction of travel instead of asking for a U-turn.
 *
 * REQUEST CADENCE — the query key is `['nav', 'route', destination, rerouteNonce]`: the ORIGIN
 * IS NOT IN THE KEY (it is read from the latest fix when the request runs), so new GPS fixes
 * never refetch. A request happens when:
 *   1. a destination is set (new key);
 *   2. `nav.rerouteNonce` is bumped (off-route, retry) (new key);
 *   3. every `ROUTE_REFRESH_MS` (2 min) from the current position, for fresh traffic/ETA
 *      (`refetchInterval`, foreground only) — skipped when there is no fresh fix;
 *   4. `ROUTE_RETRY_MS` (20 s) after a request failed for a network/server reason (a failed
 *      reroute must not wait for the 2-minute refresh).
 * NoRoute/NoSegment and 4xx are not retried; network/5xx/timeouts (`fetchJson`, 10 s) are
 * retried twice (app default). Worst case while navigating normally: 30 refreshes an hour plus
 * the reroutes (≤ 4 a minute, backing off to 1 per 2 min); while every request fails, one
 * attempt (≤ 3 requests) per 20 s.
 *
 * CACHE — route queries never expire by themselves (`gcTime: Infinity`); the nav engine prunes
 * them with `pruneRouteQueries` (other destinations whenever the destination changes, older
 * reroutes once a newer one loaded). So the last route that loaded for the current destination
 * stays available (`lastGoodRoute`) to keep guiding while a reroute is pending or has failed.
 */
import { queryOptions, useQuery, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { shouldRetry } from '../state/queryClient';
import type { LngLat, Place } from '../types';
import { fetchJson, isHttpError } from './client';

export const DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving-traffic';
/** Periodic traffic/ETA refresh while navigating. */
export const ROUTE_REFRESH_MS = 2 * 60_000;
/** Retry of a route request that failed for a transient reason (network, timeout, 5xx, 408/429). */
export const ROUTE_RETRY_MS = 20_000;
/** Allowed deviation of the origin bearing, degrees (Mapbox recommends 45 or 90). */
export const ORIGIN_BEARING_TOLERANCE_DEG = 45;

/** One maneuver (the start of a step). */
export interface RouteManeuver {
  /** Mapbox maneuver type: `turn`, `new name`, `depart`, `arrive`, `merge`, `on ramp`, `off ramp`, `fork`, `end of road`, `continue`, `roundabout`, `rotary`, `roundabout turn`, `notification`, `exit roundabout`, `exit rotary`. */
  type: string;
  /** `uturn`, `sharp right`, `right`, `slight right`, `straight`, `slight left`, `left`, `sharp left`, or `null`. */
  modifier: string | null;
  /** Roundabout/rotary exit number. */
  exit: number | null;
  /** Where it happens, `[lng, lat]`. */
  location: LngLat;
  /** Heading after the maneuver, degrees. */
  bearingAfter: number | null;
  /** Mapbox's English instruction, e.g. "Turn left onto Adalbertstraße" (accessibility label). */
  instruction: string;
}

export interface RouteStep {
  maneuver: RouteManeuver;
  /** What to show as the target of this step's maneuver: banner text, else road name, ref or signed destinations. May be ''. */
  label: string;
  /** Length of the step (from its maneuver to the next one), metres. */
  distanceM: number;
  /** Typical-traffic-aware duration of the step, seconds. */
  durationS: number;
}

export interface Route {
  /** Full route geometry, `[lng, lat]`. */
  line: LngLat[];
  distanceM: number;
  durationS: number;
  steps: RouteStep[];
}

/** What the route query stores: the route plus where/when it was requested from. */
export interface RouteResult extends Route {
  /** The origin the request used. */
  origin: LngLat;
  /** Timestamp of the fix used as origin, epoch ms (progress tracking starts there). */
  originAt: number;
  /** When the response arrived, epoch ms. */
  fetchedAt: number;
}

/** `code` other than `Ok` (no drivable route between the points). Never retried. */
export class RouteUnavailableError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message || (code === 'NoSegment' ? 'No road near one of the points' : 'No route found'));
    this.name = 'RouteUnavailableError';
    this.code = code;
  }
}

export const isRouteUnavailable = (error: unknown): error is RouteUnavailableError =>
  error instanceof Error && error.name === 'RouteUnavailableError';

// ---------------------------------------------------------------------------
// Pure: URL and parsing
// ---------------------------------------------------------------------------

export interface RouteRequest {
  origin: LngLat;
  destination: LngLat;
  /** Current course, degrees; `null` when unknown or stopped. */
  headingDeg: number | null;
}

const coord = (p: LngLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

export function directionsUrl(req: RouteRequest, token: string): string {
  const params = new URLSearchParams({
    alternatives: 'false',
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    banner_instructions: 'true',
  });
  if (req.headingDeg !== null && Number.isFinite(req.headingDeg)) {
    const h = ((Math.round(req.headingDeg) % 360) + 360) % 360;
    params.set('bearings', `${h},${ORIGIN_BEARING_TOLERANCE_DEG};`);
  }
  params.set('access_token', token);
  return `${DIRECTIONS_URL}/${coord(req.origin)};${coord(req.destination)}?${params.toString()}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parsePoint(v: unknown): LngLat | null {
  if (!Array.isArray(v)) return null;
  const lng = num(v[0]);
  const lat = num(v[1]);
  if (lng === null || lat === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

/** Primary banner text of a raw step (describes the maneuver at the END of that step). */
function bannerText(rawStep: Record<string, unknown>): string | null {
  const banners = Array.isArray(rawStep.bannerInstructions) ? rawStep.bannerInstructions : [];
  for (const b of banners) {
    if (isRecord(b) && isRecord(b.primary)) {
      const text = str(b.primary.text);
      if (text) return text;
    }
  }
  return null;
}

/**
 * Directions response → the first route. Throws `RouteUnavailableError` for `NoRoute` /
 * `NoSegment` / an empty route list, and a plain `Error` for a malformed body.
 */
export function parseDirections(json: unknown): Route {
  if (!isRecord(json)) throw new Error('Malformed directions response');
  const code = str(json.code) ?? 'Ok';
  if (code !== 'Ok') throw new RouteUnavailableError(code, str(json.message) ?? undefined);
  const route = Array.isArray(json.routes) ? json.routes.find(isRecord) : undefined;
  if (!route) throw new RouteUnavailableError('NoRoute');

  const geometry = isRecord(route.geometry) ? route.geometry : null;
  const coords = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  if (!coords) throw new Error('Directions response has no GeoJSON geometry');
  const line: LngLat[] = [];
  for (const c of coords) {
    const p = parsePoint(c);
    if (!p) throw new Error('Directions geometry has an invalid coordinate');
    line.push(p);
  }
  if (line.length < 2) throw new Error('Directions geometry is too short');

  const rawSteps: Record<string, unknown>[] = [];
  for (const leg of Array.isArray(route.legs) ? route.legs : []) {
    if (!isRecord(leg) || !Array.isArray(leg.steps)) continue;
    for (const s of leg.steps) if (isRecord(s)) rawSteps.push(s);
  }

  const steps: RouteStep[] = [];
  let previousBanner: string | null = null;
  for (const s of rawSteps) {
    const m = isRecord(s.maneuver) ? s.maneuver : null;
    const location = m ? parsePoint(m.location) : null;
    if (!m || !location) {
      previousBanner = bannerText(s);
      continue;
    }
    const type = str(m.type) ?? 'turn';
    const exit = num(m.exit);
    const maneuver: RouteManeuver = {
      type,
      modifier: str(m.modifier),
      exit: exit !== null && exit > 0 ? Math.round(exit) : null,
      location,
      bearingAfter: num(m.bearing_after),
      instruction: str(m.instruction) ?? '',
    };
    const label = previousBanner ?? str(s.name) ?? str(s.ref) ?? str(s.destinations) ?? '';
    steps.push({
      maneuver,
      label: type === 'arrive' ? '' : label,
      distanceM: Math.max(0, num(s.distance) ?? 0),
      durationS: Math.max(0, num(s.duration) ?? 0),
    });
    previousBanner = bannerText(s);
  }

  return {
    line,
    distanceM: Math.max(0, num(route.distance) ?? 0),
    durationS: Math.max(0, num(route.duration) ?? 0),
    steps,
  };
}

export async function fetchRoute(req: RouteRequest, token: string, signal?: AbortSignal): Promise<Route> {
  return parseDirections(await fetchJson<unknown>(directionsUrl(req, token), { signal }));
}

// ---------------------------------------------------------------------------
// TanStack Query
// ---------------------------------------------------------------------------

/** Where to route from, read at request time. */
export interface RouteOrigin {
  point: LngLat;
  /** Fix timestamp, epoch ms. */
  at: number;
  headingDeg: number | null;
  /** `false` while the GPS is stale: a refresh then keeps the route it has. */
  fresh: boolean;
}

export const ROUTE_QUERY_ROOT = ['nav', 'route'] as const;

/** `['nav', 'route', id, lat, lng, nonce]` — no origin, so GPS fixes never change the key. */
export function routeQueryKey(destination: Place | null, rerouteNonce: number) {
  return destination
    ? ([...ROUTE_QUERY_ROOT, destination.id, destination.lat, destination.lng, rerouteNonce] as const)
    : ([...ROUTE_QUERY_ROOT, null, null, null, rerouteNonce] as const);
}

/** `['nav', 'route', id, lat, lng]` — prefix of every reroute of one destination. */
export function routeDestinationKey(destination: Place) {
  return [...ROUTE_QUERY_ROOT, destination.id, destination.lat, destination.lng] as const;
}

/** A route query key belongs to `destination` (same id and coordinates; `null` matches no-destination keys). */
function keyIsFor(key: QueryKey, destination: Place | null): boolean {
  if (key[0] !== 'nav' || key[1] !== 'route') return false;
  if (!destination) return key[2] === null;
  return key[2] === destination.id && key[3] === destination.lat && key[4] === destination.lng;
}

/**
 * The route that most recently loaded for `destination`, under any reroute nonce, or `null`.
 * While a reroute is in flight or has failed, the engine keeps guiding along this one.
 */
export function lastGoodRoute(client: QueryClient, destination: Place | null): RouteResult | null {
  if (!destination) return null;
  let best: RouteResult | null = null;
  let bestAt = -Infinity;
  for (const query of client.getQueryCache().findAll({ queryKey: routeDestinationKey(destination) })) {
    const data = query.state.data as RouteResult | undefined;
    if (data && query.state.dataUpdatedAt > bestAt) {
      best = data;
      bestAt = query.state.dataUpdatedAt;
    }
  }
  return best;
}

/**
 * Forget route queries nobody observes that are no longer useful: every other destination's
 * (so A → B → A routes from here, not from where A was first chosen) and — when `keepNonce` is
 * given (that reroute has loaded) — this destination's older reroutes.
 */
export function pruneRouteQueries(client: QueryClient, destination: Place | null, keepNonce?: number): void {
  client.removeQueries({
    queryKey: ROUTE_QUERY_ROOT,
    predicate: (query) => {
      if (query.getObserversCount() > 0) return false;
      if (!keyIsFor(query.queryKey, destination)) return true;
      return keepNonce !== undefined && destination !== null && query.queryKey[5] !== keepNonce;
    },
  });
}

/**
 * How long until the route query fetches again: the periodic refresh while it has a route; a
 * quick retry after a transient failure; the slow refresh after a 4xx (bad token, bad input);
 * never for a destination Directions cannot reach.
 */
export function routeRefetchInterval(state: { data?: unknown; error?: unknown; status?: string }): number | false {
  if (state.data !== undefined) return ROUTE_REFRESH_MS;
  if (state.status !== 'error') return ROUTE_REFRESH_MS;
  if (isRouteUnavailable(state.error)) return false;
  if (isHttpError(state.error) && !shouldRetry(0, state.error)) return ROUTE_REFRESH_MS;
  return ROUTE_RETRY_MS;
}

/** Same (non-null) destination in two route query keys (reroute → keep showing the old line meanwhile). */
export function sameRouteDestination(a: QueryKey, b: QueryKey): boolean {
  return (
    a[0] === 'nav' && a[1] === 'route' && b[0] === 'nav' && b[1] === 'route' &&
    a[2] !== null && a[2] === b[2] && a[3] === b[3] && a[4] === b[4]
  );
}

export interface RouteQueryArgs {
  /** `null` → the query is disabled. */
  destination: Place | null;
  rerouteNonce: number;
  token: string;
  /** Current origin, or `null` before the first fix. */
  getOrigin: () => RouteOrigin | null;
  /** Extra gate (e.g. a first fix exists, not after arrival). Keep it stable: toggling it refetches a failed route. */
  enabled: boolean;
  /** Clock, epoch ms (tests). */
  now?: () => number;
}

export function routeQueryOptions(args: RouteQueryArgs) {
  const { destination, rerouteNonce, token, getOrigin, enabled } = args;
  const now = args.now ?? Date.now;
  return queryOptions({
    queryKey: routeQueryKey(destination, rerouteNonce),
    queryFn: async ({ signal, client, queryKey }): Promise<RouteResult> => {
      if (!destination) throw new Error('No destination');
      const origin = getOrigin();
      const previous = client.getQueryData<RouteResult>(queryKey);
      // A periodic refresh without a fresh fix keeps the route it has; a first request uses
      // the last known position even if the GPS is momentarily stale.
      if (previous && (!origin || !origin.fresh)) return previous;
      if (!origin) throw new Error('No position to route from');
      const route = await fetchRoute(
        { origin: origin.point, destination: [destination.lng, destination.lat], headingDeg: origin.headingDeg },
        token,
        signal,
      );
      return { ...route, origin: origin.point, originAt: origin.at, fetchedAt: now() };
    },
    enabled: enabled && destination !== null && token !== '',
    // Never refetch on mount/focus/reconnect-while-fresh; only the interval and key changes fetch.
    staleTime: Infinity,
    // Kept until the engine prunes it (see CACHE above): the last good route must not expire
    // while a reroute keeps failing.
    gcTime: Infinity,
    // Periodic traffic refresh; a quick retry after a failure; never poll an unreachable destination.
    refetchInterval: (query) => routeRefetchInterval(query.state),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    // While rerouting to the same destination keep drawing the old route; never across destinations.
    placeholderData: (previous, previousQuery) =>
      previousQuery && sameRouteDestination(previousQuery.queryKey, routeQueryKey(destination, rerouteNonce)) ? previous : undefined,
    retry: (failureCount, error) => !isRouteUnavailable(error) && shouldRetry(failureCount, error),
  });
}

/** The navigation route. Mount it ONCE (the nav engine): every observer would run its own refresh timer. */
export function useRoute(args: RouteQueryArgs) {
  return useQuery(routeQueryOptions(args));
}
