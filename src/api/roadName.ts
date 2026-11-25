/**
 * T22 Road name — the road the vehicle is on, from the Mapbox Tilequery API.
 *
 * ENDPOINT
 *   GET https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/{lng},{lat}.json
 *       ?radius=35&limit=20&layers=road&geometry=linestring&access_token=…
 *   Returns every road-layer line within `radius` metres, nearest first, each as a GeoJSON
 *   Point at the closest point on that line, with `properties.tilequery.distance` (metres)
 *   and the Streets v8 road fields (`name`, `ref`, `class`, …). Chosen over reverse geocoding
 *   (`/search/geocode/v6/reverse?types=street`) because it returns all nearby candidates with
 *   their geometry, which is what makes heading-aware ranking possible; geocoding returns one
 *   street and no geometry. Both have 100k free requests/month.
 *
 * HEADING-AWARE RANKING (`pickRoad`)
 *   The closest point on the road you are driving along lies to your SIDE (perpendicular to
 *   your heading), while the closest point on a cross street lies AHEAD or BEHIND you, at the
 *   intersection. So each candidate's distance is split into an along-heading and a lateral
 *   component and the along part is weighted `ROAD_ALONG_WEIGHT`× — the cross street 10 m
 *   ahead loses to the street you are on even if GPS puts you 12 m off its centreline.
 *   Without a heading (stopped) it is plain nearest.
 *
 * REQUEST CADENCE (`advanceRoadAnchor`)
 *   The query key is an "anchor" — the fix position/heading at the last lookup — not the live
 *   position. A new anchor (= one request) is taken only when the vehicle has moved
 *   `ROAD_REFETCH_DISTANCE_M` from it, has turned ≥ `ROAD_TURN_DEG` (and moved a little, so
 *   the lookup happens past the intersection), or once a heading becomes known after starting
 *   from rest, or when GPS accuracy has improved a lot. Stopping (heading → null) never
 *   triggers a lookup, so a red light at an intersection cannot flip the name to the cross
 *   street. The anchor is derived inside a `telemetry` selector (≈1 Hz fixes), and the
 *   selector returns the same object until a new anchor is taken, so `useRoadName` re-renders
 *   only when a lookup is due.
 */
import { keepPreviousData, queryOptions, skipToken, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { angleDiffDeg, bearingDeg, haversineM } from '../lib';
import { telemetry } from '../state';
import type { LngLat, Telemetry } from '../types';
import { MAPBOX_TOKEN, fetchJson, hasMapboxToken } from './client';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Mapbox Streets v8 — its `road` layer carries road names since v8 (the old `road_label` was merged in). */
export const ROAD_TILESET = 'mapbox.mapbox-streets-v8';
/** Search radius around the vehicle, metres: GPS error plus half a wide road. */
export const ROAD_QUERY_RADIUS_M = 35;
/** Candidates requested. Sidewalks and crossings are separate `path` lines near the car, so ask for plenty. Max 50. */
export const ROAD_QUERY_LIMIT = 20;
/** Travel from the last lookup that triggers the next one, metres. */
export const ROAD_REFETCH_DISTANCE_M = 125;
/** Heading change since the last lookup that counts as a turn onto another road, degrees. */
export const ROAD_TURN_DEG = 60;
/** Minimum travel before a turn or a newly known heading triggers a lookup, metres (be past the intersection). */
export const ROAD_TURN_MIN_MOVE_M = 20;
/** Fixes less accurate than this are ignored (coarse Wi-Fi/cell positions at start-up), metres. */
export const ROAD_MAX_ACCURACY_M = 75;
/** An anchor this accurate is never replaced just because accuracy improved, metres. */
export const ROAD_GOOD_ACCURACY_M = 25;
/** Weight of the along-heading distance component in `pickRoad`. */
export const ROAD_ALONG_WEIGHT = 3;
/** Cache lifetime of a result nobody observes any more. Long, so the last name survives a dead zone. */
export const ROAD_NAME_GC_MS = 30 * 60_000;
/** Root of every road-name query key. */
export const ROAD_NAME_ROOT = 'road-name';

/** Streets v8 `class` values a car can be driving on. Paths, rail, ferries, aerialways etc. are ignored. */
const DRIVABLE_CLASSES: ReadonlySet<string> = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'street',
  'street_limited',
  'service',
  'track',
]);

/** Extra cost (metres) for minor classes, so an alley beside the road does not win a near tie. */
const CLASS_PENALTY_M: Readonly<Record<string, number>> = {
  service: 10,
  track: 10,
  street_limited: 5,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where and in which direction the last lookup was made. This IS the query key. */
export interface RoadAnchor {
  /** Latitude, degrees, rounded to 1e-5 (≈1 m). */
  lat: number;
  /** Longitude, degrees, rounded to 1e-5. */
  lng: number;
  /** Course over ground at the lookup, whole degrees; `null` when stationary/unknown. */
  headingDeg: number | null;
  /** Accuracy of the fix the anchor was taken from, metres. */
  accuracyM: number;
}

/** One road line near the query point, as parsed from Tilequery. */
export interface RoadCandidate {
  /** Local name, e.g. "Main Street". `null` when the road has only a route number. */
  name: string | null;
  /** First route number, e.g. "I 80". `null` when none. */
  ref: string | null;
  /** Streets v8 road class, e.g. `street`, `motorway`. */
  roadClass: string;
  /** Distance from the query point to the closest point on the road, metres. */
  distanceM: number;
  /** That closest point, `[lng, lat]`. */
  point: LngLat;
}

/** The road the vehicle is on (query data). JSON-safe. */
export interface RoadMatch {
  name: string | null;
  ref: string | null;
  roadClass: string;
}

// ---------------------------------------------------------------------------
// Anchor (query key) — pure
// ---------------------------------------------------------------------------

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5 + 0;

function anchorFrom(fix: NonNullable<Telemetry['fix']>, headingDeg: number | null): RoadAnchor {
  return {
    lat: round5(fix.lat),
    lng: round5(fix.lng),
    headingDeg: headingDeg === null ? null : Math.round(headingDeg) % 360,
    accuracyM: fix.accuracyM,
  };
}

/**
 * Next anchor for a telemetry sample. Returns `prev` itself (same reference) when no new
 * lookup is due — see "REQUEST CADENCE" above for the rules.
 */
export function advanceRoadAnchor(
  prev: RoadAnchor | null,
  t: Pick<Telemetry, 'fix' | 'headingDeg'>,
): RoadAnchor | null {
  const fix = t.fix;
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return prev;
  if (!(fix.accuracyM <= ROAD_MAX_ACCURACY_M)) return prev; // also rejects NaN
  const heading = t.headingDeg !== null && Number.isFinite(t.headingDeg) ? t.headingDeg : null;
  if (!prev) return anchorFrom(fix, heading);

  const moved = haversineM([prev.lng, prev.lat], [fix.lng, fix.lat]);
  if (moved >= ROAD_REFETCH_DISTANCE_M) return anchorFrom(fix, heading);
  if (heading !== null && moved >= ROAD_TURN_MIN_MOVE_M) {
    if (prev.headingDeg === null) return anchorFrom(fix, heading);
    if (Math.abs(angleDiffDeg(prev.headingDeg, heading)) >= ROAD_TURN_DEG) return anchorFrom(fix, heading);
  }
  if (prev.accuracyM > ROAD_GOOD_ACCURACY_M && fix.accuracyM <= prev.accuracyM / 2) {
    return anchorFrom(fix, heading ?? prev.headingDeg);
  }
  return prev;
}

/**
 * A `telemetry.use(selector)` selector that remembers its last anchor, so its result only
 * changes when a lookup is due. Deterministic and idempotent: calling it again with the same
 * telemetry returns the same anchor.
 */
export function createRoadAnchorSelector(): (t: Telemetry) => RoadAnchor | null {
  let last: RoadAnchor | null = null;
  return (t) => (last = advanceRoadAnchor(last, t));
}

/**
 * The app's one anchor selector. Module-level so the anchor survives the road pill being
 * swapped out for the maneuver banner: when it comes back nearby, the key (and cache) match.
 */
const selectRoadAnchor = createRoadAnchorSelector();

// ---------------------------------------------------------------------------
// Request, parsing and ranking — pure
// ---------------------------------------------------------------------------

/** Tilequery URL for an anchor. */
export function roadNameUrl(anchor: Pick<RoadAnchor, 'lat' | 'lng'>, token: string = MAPBOX_TOKEN): string {
  const params = new URLSearchParams({
    radius: String(ROAD_QUERY_RADIUS_M),
    limit: String(ROAD_QUERY_LIMIT),
    layers: 'road',
    geometry: 'linestring',
    access_token: token,
  });
  return `https://api.mapbox.com/v4/${ROAD_TILESET}/tilequery/${anchor.lng},${anchor.lat}.json?${params}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Trimmed, whitespace-collapsed non-empty string, else `null`. */
function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : null;
}

/**
 * Drivable, named road candidates from a Tilequery response. Anything malformed is skipped
 * feature by feature; a body that is not a FeatureCollection throws (the query then keeps
 * the previous name rather than caching "no road").
 */
export function parseRoadCandidates(json: unknown): RoadCandidate[] {
  if (!isRecord(json) || !Array.isArray(json.features)) {
    throw new Error('Tilequery: response is not a FeatureCollection');
  }
  const out: RoadCandidate[] = [];
  for (const feature of json.features) {
    if (!isRecord(feature) || !isRecord(feature.properties) || !isRecord(feature.geometry)) continue;
    const props = feature.properties;
    const tq = isRecord(props.tilequery) ? props.tilequery : {};
    if (tq.layer !== undefined && tq.layer !== 'road') continue;
    if (tq.geometry !== undefined && tq.geometry !== 'linestring') continue;

    const roadClass = typeof props.class === 'string' ? props.class : '';
    if (!DRIVABLE_CLASSES.has(roadClass)) continue;

    const name = cleanText(props.name);
    const ref = cleanText(typeof props.ref === 'string' ? props.ref.split(';')[0] : null);
    if (!name && !ref) continue;

    const coords = feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;

    const distanceM = typeof tq.distance === 'number' && Number.isFinite(tq.distance) && tq.distance >= 0 ? tq.distance : null;
    if (distanceM === null) continue;

    out.push({ name, ref, roadClass, distanceM, point: [lng, lat] });
  }
  return out;
}

/** Ranking cost of a candidate, metres-ish (lower is better). */
export function roadCost(candidate: RoadCandidate, from: LngLat, headingDeg: number | null): number {
  const penalty = CLASS_PENALTY_M[candidate.roadClass] ?? 0;
  const d = candidate.distanceM;
  if (headingDeg === null) return d + penalty;
  const delta = (angleDiffDeg(headingDeg, bearingDeg(from, candidate.point)) * Math.PI) / 180;
  const along = d * Math.abs(Math.cos(delta));
  const lateral = d * Math.abs(Math.sin(delta));
  return lateral + ROAD_ALONG_WEIGHT * along + penalty;
}

/** The candidate the vehicle is most likely on, or `null` for none. Ties keep the API's (nearest-first) order. */
export function pickRoad(candidates: readonly RoadCandidate[], anchor: Pick<RoadAnchor, 'lat' | 'lng' | 'headingDeg'>): RoadCandidate | null {
  const from: LngLat = [anchor.lng, anchor.lat];
  let best: RoadCandidate | null = null;
  let bestCost = Infinity;
  for (const c of candidates) {
    const cost = roadCost(c, from, anchor.headingDeg);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
    }
  }
  return best;
}

export interface FetchRoadNameOptions {
  signal?: AbortSignal;
  /** Mapbox token; defaults to `MAPBOX_TOKEN` (tests pass one). */
  token?: string;
}

/** Look up the road at an anchor. `null` = no named drivable road within the radius. */
export async function fetchRoadName(anchor: RoadAnchor, options: FetchRoadNameOptions = {}): Promise<RoadMatch | null> {
  const json = await fetchJson<unknown>(roadNameUrl(anchor, options.token), { signal: options.signal });
  const best = pickRoad(parseRoadCandidates(json), anchor);
  return best ? { name: best.name, ref: best.ref, roadClass: best.roadClass } : null;
}

// ---------------------------------------------------------------------------
// Query + hook
// ---------------------------------------------------------------------------

/** Query options for an anchor. Disabled (skipToken) without an anchor or a Mapbox token. */
export function roadNameQueryOptions(anchor: RoadAnchor | null) {
  return queryOptions({
    queryKey: [ROAD_NAME_ROOT, anchor?.lat ?? null, anchor?.lng ?? null, anchor?.headingDeg ?? null] as const,
    queryFn: anchor && hasMapboxToken ? ({ signal }) => fetchRoadName(anchor, { signal }) : skipToken,
    // The name of the road at a given point does not change during a drive.
    staleTime: Infinity,
    gcTime: ROAD_NAME_GC_MS,
  });
}

/** Most recently fetched road-name result still in the cache (any anchor), if any. */
export function latestRoadMatch(client: QueryClient): RoadMatch | null | undefined {
  let latestAt = -1;
  let latest: RoadMatch | null | undefined;
  for (const query of client.getQueryCache().findAll({ queryKey: [ROAD_NAME_ROOT] })) {
    const { data, dataUpdatedAt } = query.state;
    if (data !== undefined && dataUpdatedAt > latestAt) {
      latestAt = dataUpdatedAt;
      latest = data as RoadMatch | null;
    }
  }
  return latest;
}

/**
 * The road the vehicle is on, or `null` when unknown (no token, no fix yet, nothing named
 * nearby, or the very first lookup failed). While the next lookup loads, and when it fails
 * (cell dropouts), the previous result stays.
 */
export function useRoadName(): RoadMatch | null {
  const client = useQueryClient();
  const anchor = telemetry.use(selectRoadAnchor);
  const query = useQuery({ ...roadNameQueryOptions(anchor), placeholderData: keepPreviousData });
  if (query.data !== undefined) return query.data;
  // Pending with no placeholder (fresh mount) or failed: fall back to the last result we had.
  return latestRoadMatch(client) ?? null;
}
