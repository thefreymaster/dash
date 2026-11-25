/**
 * Mapbox Search Box API (v1) — destination search for navigation (T26).
 *
 *   GET https://api.mapbox.com/search/searchbox/v1/suggest?q=…&session_token=…&access_token=…
 *       &limit=6&types=poi,address,street,place,locality,neighborhood,postcode
 *       &proximity={lng},{lat}&origin={lng},{lat}
 *     → { suggestions: [{ mapbox_id, name, feature_type, address?, full_address?,
 *          place_formatted, poi_category?, maki?, distance? (m, from `origin`), … }], attribution }
 *     Suggestions carry NO coordinates.
 *   GET https://api.mapbox.com/search/searchbox/v1/retrieve/{mapbox_id}?session_token=…&access_token=…
 *     → GeoJSON FeatureCollection; `features[0].geometry.coordinates` = [lng, lat] and
 *       `properties.coordinates.routable_points[]` (where a car should go, e.g. a car-park entrance).
 *
 * Billing: a SESSION = any number of /suggest calls (max 50) followed by one /retrieve, all
 * with the same `session_token` (UUIDv4); /retrieve ends it, otherwise it times out after
 * 180 s. So: one token per opening of the search sheet, a fresh one after every retrieve
 * (`newSessionToken`). Cached suggest responses (TanStack, keyed by text + token) cost nothing.
 * Rate limit 10 req/s — irrelevant with debounced typing.
 *
 * Category/brand suggestions (`feature_type: 'category' | 'brand'`) need a different
 * endpoint and are dropped; the `types` filter already asks for places you can drive to.
 */
import { keepPreviousData, queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { shouldRetry } from '../state/queryClient';
import type { LngLat, Place } from '../types';
import { fetchJson } from './client';

export const SEARCH_BOX_URL = 'https://api.mapbox.com/search/searchbox/v1';
/** Suggestions per request (API max 10). */
export const SUGGEST_LIMIT = 6;
/** Feature types worth driving to. */
export const SUGGEST_TYPES = 'poi,address,street,place,locality,neighborhood,postcode';
/** Shortest query that is sent. */
export const MIN_QUERY_LENGTH = 2;
/** API limit on `q`. */
export const MAX_QUERY_LENGTH = 256;
/** Proximity/origin rounding, decimal places (~110 m): keeps the cache key stable while parked. */
export const PROXIMITY_DECIMALS = 3;
/** Suggestions stay fresh this long (typing back and forth re-uses them). */
export const SUGGEST_STALE_MS = 5 * 60_000;

/** Icon family for a suggestion row. */
export type SuggestionKind = 'food' | 'coffee' | 'fuel' | 'park' | 'parking' | 'shop' | 'poi' | 'address' | 'street' | 'place';

/** One search suggestion, ready to render (no coordinates — retrieve it to get a `Place`). */
export interface Suggestion {
  /** `mapbox_id`, used for /retrieve. */
  id: string;
  /** Primary label, e.g. "Blue Bottle Coffee" or "1120 Elm St". */
  name: string;
  /** Secondary label, e.g. "Coffee · 1120 Elm St" or "Oakland, California 94607, United States". */
  detail: string;
  /** API `feature_type` (`poi`, `address`, `street`, `place`, …). */
  featureType: string;
  kind: SuggestionKind;
  /** Distance from the request `origin`, metres, when the API returns one. */
  distanceM: number | null;
}

// ---------------------------------------------------------------------------
// Pure: tokens, URLs, parsing
// ---------------------------------------------------------------------------

/** A UUIDv4 session token (`crypto.randomUUID` when available). */
export function newSessionToken(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Query text as sent and cached: trimmed, inner whitespace collapsed, capped at the API limit. */
export function normalizeQuery(q: string): string {
  return q.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

/** `[lng, lat]` rounded to `PROXIMITY_DECIMALS`, or `null`. */
export function roundProximity(p: LngLat | null | undefined): LngLat | null {
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  const f = 10 ** PROXIMITY_DECIMALS;
  return [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
}

export interface SuggestParams {
  /** What the user typed. */
  q: string;
  sessionToken: string;
  /** Current position, biases results and gives distances. `null` → the API uses IP proximity. */
  proximity: LngLat | null;
}

/** /suggest URL. `proximity` is rounded; it is also sent as `origin` so results carry a distance. */
export function suggestUrl(params: SuggestParams, token: string): string {
  const search = new URLSearchParams({
    q: normalizeQuery(params.q),
    access_token: token,
    session_token: params.sessionToken,
    limit: String(SUGGEST_LIMIT),
    types: SUGGEST_TYPES,
  });
  const p = roundProximity(params.proximity);
  if (p) {
    search.set('proximity', `${p[0]},${p[1]}`);
    search.set('origin', `${p[0]},${p[1]}`);
  } else {
    search.set('proximity', 'ip');
  }
  return `${SEARCH_BOX_URL}/suggest?${search.toString()}`;
}

/** /retrieve URL for one suggestion. */
export function retrieveUrl(id: string, sessionToken: string, token: string): string {
  const search = new URLSearchParams({ session_token: sessionToken, access_token: token });
  return `${SEARCH_BOX_URL}/retrieve/${encodeURIComponent(id)}?${search.toString()}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const FOOD_MAKI = new Set(['restaurant', 'fast-food', 'bakery', 'bar', 'beer', 'restaurant-pizza', 'restaurant-noodle', 'restaurant-seafood', 'ice-cream', 'food']);
const SHOP_MAKI = new Set(['shop', 'grocery', 'convenience', 'clothing-store', 'shoe', 'mall', 'department-store', 'pharmacy', 'hardware']);

/** Icon family from `feature_type`, `maki` and `poi_category`. */
export function suggestionKind(featureType: string, maki: string | null, categories: readonly string[]): SuggestionKind {
  if (featureType === 'address') return 'address';
  if (featureType === 'street') return 'street';
  if (featureType !== 'poi') return 'place';
  const cats = categories.map((c) => c.toLowerCase());
  const has = (word: string) => cats.some((c) => c.includes(word));
  if (maki === 'cafe' || has('coffee') || has('cafe')) return 'coffee';
  if (maki === 'fuel' || maki === 'charging-station' || has('gas station') || has('fuel') || has('charging')) return 'fuel';
  if (maki === 'parking' || maki === 'parking-garage' || has('parking')) return 'parking';
  if (maki === 'park' || maki === 'garden' || has('park')) return 'park';
  if ((maki && FOOD_MAKI.has(maki)) || has('restaurant') || has('food')) return 'food';
  if ((maki && SHOP_MAKI.has(maki)) || has('shop') || has('store') || has('grocery')) return 'shop';
  return 'poi';
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * /suggest response → suggestions. Tolerant: malformed entries and category/brand
 * suggestions are skipped; a malformed body yields `[]`… except that a body with no
 * `suggestions` array at all throws (so the UI shows an error, not "no results").
 */
export function parseSuggestResponse(json: unknown): Suggestion[] {
  if (!isRecord(json) || !Array.isArray(json.suggestions)) throw new Error('Malformed suggest response');
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const raw of json.suggestions as unknown[]) {
    if (!isRecord(raw)) continue;
    const id = str(raw.mapbox_id);
    const name = str(raw.name_preferred) ?? str(raw.name);
    const featureType = str(raw.feature_type) ?? 'poi';
    if (!id || !name || seen.has(id)) continue;
    if (featureType === 'category' || featureType === 'brand' || featureType === 'query') continue;
    seen.add(id);
    const categories = Array.isArray(raw.poi_category) ? raw.poi_category.filter((c): c is string => typeof c === 'string') : [];
    const placeFormatted = str(raw.place_formatted);
    let detail: string;
    if (featureType === 'poi') {
      const where = str(raw.address) ?? placeFormatted ?? str(raw.full_address) ?? '';
      const what = categories[0] ? capitalize(categories[0]) : null;
      detail = what && where ? `${what} · ${where}` : (what ?? where);
    } else {
      detail = placeFormatted ?? str(raw.full_address) ?? '';
    }
    const distance = num(raw.distance);
    out.push({
      id,
      name,
      detail,
      featureType,
      kind: suggestionKind(featureType, str(raw.maki), categories),
      distanceM: distance !== null && distance >= 0 ? distance : null,
    });
  }
  return out;
}

/**
 * /retrieve response → `Place`. Uses the first routable point when there is one (the spot a
 * car should drive to), else the feature's point. Throws when no usable coordinates exist.
 */
export function parseRetrieveResponse(json: unknown, fallback?: Pick<Suggestion, 'id' | 'name' | 'detail'>): Place {
  const features = isRecord(json) && Array.isArray(json.features) ? (json.features as unknown[]) : [];
  const feature = features.find(isRecord);
  if (!feature) throw new Error('Place not found');
  const props = isRecord(feature.properties) ? feature.properties : {};
  const geometry = isRecord(feature.geometry) ? feature.geometry : {};
  const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const pc = isRecord(props.coordinates) ? props.coordinates : {};

  let lng = num(coords[0]) ?? num(pc.longitude);
  let lat = num(coords[1]) ?? num(pc.latitude);
  const routable = Array.isArray(pc.routable_points) ? pc.routable_points.find(isRecord) : undefined;
  if (routable) {
    const rLat = num(routable.latitude);
    const rLng = num(routable.longitude);
    if (rLat !== null && rLng !== null && Math.abs(rLat) <= 90 && Math.abs(rLng) <= 180) {
      lat = rLat;
      lng = rLng;
    }
  }
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Place has no coordinates');

  const id = str(props.mapbox_id) ?? fallback?.id ?? `${lng.toFixed(6)},${lat.toFixed(6)}`;
  const name = str(props.name_preferred) ?? str(props.name) ?? fallback?.name ?? 'Dropped pin';
  const featureType = str(props.feature_type);
  const address =
    featureType === 'poi'
      ? (str(props.full_address) ?? str(props.place_formatted) ?? undefined)
      : (str(props.place_formatted) ?? str(props.full_address) ?? undefined);
  const place: Place = { id, name, lat, lng };
  const finalAddress = address && address !== name ? address : fallback?.detail || undefined;
  if (finalAddress) place.address = finalAddress;
  return place;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchSuggestions(params: SuggestParams, token: string, signal?: AbortSignal): Promise<Suggestion[]> {
  return parseSuggestResponse(await fetchJson<unknown>(suggestUrl(params, token), { signal }));
}

export async function fetchPlace(
  suggestion: Pick<Suggestion, 'id' | 'name' | 'detail'>,
  sessionToken: string,
  token: string,
  signal?: AbortSignal,
): Promise<Place> {
  return parseRetrieveResponse(await fetchJson<unknown>(retrieveUrl(suggestion.id, sessionToken, token), { signal }), suggestion);
}

// ---------------------------------------------------------------------------
// TanStack Query
// ---------------------------------------------------------------------------

/**
 * Query key for suggestions: normalised (lower-cased) text, session token and rounded
 * proximity. The token is part of the key because a cached response belongs to its session.
 */
export function suggestQueryKey(params: SuggestParams) {
  const p = roundProximity(params.proximity);
  return ['search', 'suggest', normalizeQuery(params.q).toLowerCase(), params.sessionToken, p ? `${p[0]},${p[1]}` : 'ip'] as const;
}

/** Options for `useSuggestions` (exported so the dev fixtures/tests can seed the same key). */
export function suggestQueryOptions(params: SuggestParams, token: string) {
  return queryOptions({
    queryKey: suggestQueryKey(params),
    queryFn: ({ signal }) => fetchSuggestions(params, token, signal),
    enabled: token !== '' && normalizeQuery(params.q).length >= MIN_QUERY_LENGTH,
    staleTime: SUGGEST_STALE_MS,
    // Keep the last results on screen while the next keystroke's results load.
    placeholderData: keepPreviousData,
    // A reconnect must not replay a burst of keystroke queries.
    refetchOnReconnect: false,
  });
}

/** Suggestions for `params.q` (debounce the text before passing it in). Disabled without a token or with < 2 characters. */
export function useSuggestions(params: SuggestParams, token: string) {
  return useQuery(suggestQueryOptions(params, token));
}

export interface RetrieveVariables {
  suggestion: Suggestion;
  sessionToken: string;
  token: string;
}

/**
 * Retrieve a suggestion's coordinates (ends the billing session). A mutation rather than a
 * query: it runs once per tap, has a side effect on billing, and its result is handed straight
 * to navigation. Retries network/5xx failures like queries do.
 */
export function useRetrievePlace() {
  return useMutation({
    mutationKey: ['search', 'retrieve'],
    mutationFn: ({ suggestion, sessionToken, token }: RetrieveVariables) => fetchPlace(suggestion, sessionToken, token),
    retry: shouldRetry,
  });
}
