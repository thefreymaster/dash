import { QueryClient, skipToken } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { destinationPoint } from '../lib';
import type { Fix, LngLat, Telemetry } from '../types';
import { HttpError, hasMapboxToken } from './client';
import {
  ROAD_MAX_ACCURACY_M,
  ROAD_NAME_ROOT,
  ROAD_REFETCH_DISTANCE_M,
  ROAD_REFETCH_MIN_INTERVAL_MS,
  ROAD_TURN_MIN_INTERVAL_MS,
  advanceRoadAnchor,
  createRoadAnchorSelector,
  fetchRoadName,
  latestRoadMatch,
  parseRoadCandidates,
  pickRoad,
  roadNameQueryOptions,
  roadNameUrl,
  type RoadAnchor,
} from './roadName';

afterEach(() => {
  vi.unstubAllGlobals();
});

const HOME: LngLat = [-122.4194, 37.7749];

/** Example response from the Tilequery docs (vector tileset, abridged there too). No road layer in it. */
const DOCS_EXAMPLE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 4174053671,
      geometry: { type: 'Point', coordinates: [-122.42901, 37.80633] },
      properties: {
        class: 'national_park',
        type: 'national_park',
        tilequery: { distance: 0, geometry: 'polygon', layer: 'landuse_overlay' },
      },
    },
    {
      type: 'Feature',
      id: 822070541,
      geometry: { type: 'Point', coordinates: [-122.4289919435978, 37.806283149631255] },
      properties: {
        name: 'Fort Mason',
        maki: 'park',
        tilequery: { distance: 5.4376397785894595, geometry: 'point', layer: 'poi_label' },
      },
    },
  ],
};

/**
 * A road-layer feature in the same shape: a Point at the closest point on the line,
 * `distanceM` away from HOME on `bearing`, with Streets v8 road fields.
 */
function roadFeature(id: number, props: Record<string, unknown>, distanceM: number, bearing: number) {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: destinationPoint(HOME, bearing, distanceM) },
    properties: {
      oneway: 'false',
      structure: 'none',
      iso_3166_1: 'US',
      iso_3166_2: 'US-CA',
      ...props,
      tilequery: { distance: distanceM, geometry: 'linestring', layer: 'road' },
    },
  };
}

/**
 * Driving north on Main Street (GPS puts us 12 m east of its centreline), 9.8 m before
 * Elm Street. Sidewalks and an unnamed alley are closer than either.
 */
const ROAD_RESPONSE = {
  type: 'FeatureCollection',
  features: [
    roadFeature(1, { class: 'path', type: 'sidewalk', name: 'Main Street Sidewalk' }, 2.1, 270),
    roadFeature(2, { class: 'service', type: 'alley' }, 4.4, 90),
    roadFeature(3, { class: 'street', type: 'residential', name: 'Elm Street' }, 9.8, 0),
    roadFeature(4, { class: 'secondary', type: 'secondary', name: 'Main Street', ref: null, reflen: null }, 12, 270),
    roadFeature(5, { class: 'major_rail', type: 'rail', name: 'Caltrain' }, 20, 180),
  ],
};

const anchorAt = (headingDeg: number | null, at: LngLat = HOME): RoadAnchor => ({
  lng: at[0],
  lat: at[1],
  headingDeg,
  accuracyM: 5,
  at: 0,
});

describe('parseRoadCandidates', () => {
  it('ignores non-road layers (the docs example has none)', () => {
    expect(parseRoadCandidates(DOCS_EXAMPLE)).toEqual([]);
  });

  it('keeps named, drivable road lines with their distance and closest point', () => {
    const roads = parseRoadCandidates(ROAD_RESPONSE);
    expect(roads.map((r) => r.name)).toEqual(['Elm Street', 'Main Street']);
    expect(roads[1]).toMatchObject({ roadClass: 'secondary', ref: null, distanceM: 12 });
    expect(roads[1].point[0]).toBeCloseTo(ROAD_RESPONSE.features[3].geometry.coordinates[0] as number, 9);
  });

  it('keeps a road known only by its route number, first of several', () => {
    const json = {
      type: 'FeatureCollection',
      features: [roadFeature(7, { class: 'motorway', type: 'motorway', name: '  ', ref: 'I 80;US 6' }, 3, 90)],
    };
    expect(parseRoadCandidates(json)).toEqual([
      expect.objectContaining({ name: null, ref: 'I 80', roadClass: 'motorway' }),
    ]);
  });

  it('skips malformed features one by one', () => {
    const good = roadFeature(9, { class: 'street', name: 'Good  Street ' }, 5, 0);
    const json = {
      type: 'FeatureCollection',
      features: [
        null,
        'x',
        { type: 'Feature' },
        { ...good, properties: { ...good.properties, class: 42 } },
        { ...good, geometry: { type: 'Point', coordinates: ['a', 37] } },
        { ...good, geometry: { type: 'Point', coordinates: [Number.NaN, 37] } },
        { ...good, properties: { ...good.properties, tilequery: { distance: '5', layer: 'road', geometry: 'linestring' } } },
        { ...good, properties: { ...good.properties, tilequery: { distance: -1, layer: 'road', geometry: 'linestring' } } },
        { ...good, properties: { ...good.properties, tilequery: { distance: 1, layer: 'road', geometry: 'point' } } },
        good,
      ],
    };
    expect(parseRoadCandidates(json).map((r) => r.name)).toEqual(['Good Street']);
  });

  it('throws for a body that is not a FeatureCollection', () => {
    expect(() => parseRoadCandidates(null)).toThrow();
    expect(() => parseRoadCandidates({ message: 'Not Authorized - Invalid Token' })).toThrow();
    expect(() => parseRoadCandidates([])).toThrow();
  });
});

describe('pickRoad', () => {
  const roads = parseRoadCandidates(ROAD_RESPONSE);

  it('prefers the road along the heading over a nearer cross street ahead', () => {
    expect(pickRoad(roads, anchorAt(0))?.name).toBe('Main Street');
    expect(pickRoad(roads, anchorAt(180))?.name).toBe('Main Street');
  });

  it('falls back to the nearest road without a heading', () => {
    expect(pickRoad(roads, anchorAt(null))?.name).toBe('Elm Street');
  });

  it('picks the cross street after turning onto it', () => {
    // Heading east: Elm's closest point (north of us) is now to the side, Main's (west) behind.
    expect(pickRoad(roads, anchorAt(90))?.name).toBe('Elm Street');
  });

  it('penalises service roads in a near tie', () => {
    const json = {
      type: 'FeatureCollection',
      features: [
        roadFeature(1, { class: 'service', name: 'Parking Aisle' }, 3, 90),
        roadFeature(2, { class: 'primary', name: 'Broadway' }, 8, 270),
      ],
    };
    expect(pickRoad(parseRoadCandidates(json), anchorAt(0))?.name).toBe('Broadway');
  });

  it('returns null for no candidates', () => {
    expect(pickRoad([], anchorAt(0))).toBeNull();
  });
});

describe('roadNameUrl / fetchRoadName', () => {
  it('builds a Tilequery URL for the road layer, lng before lat', () => {
    const url = new URL(roadNameUrl({ lat: 37.7749, lng: -122.4194 }, 'pk.test'));
    expect(url.origin + url.pathname).toBe(
      'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/-122.4194,37.7749.json',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      radius: '35',
      limit: '20',
      layers: 'road',
      geometry: 'linestring',
      access_token: 'pk.test',
    });
  });

  it('fetches, parses and ranks', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ROAD_RESPONSE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchRoadName(anchorAt(0), { token: 'pk.test' })).resolves.toEqual({
      name: 'Main Street',
      ref: null,
      roadClass: 'secondary',
    });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/tilequery/-122.4194,37.7749.json');
  });

  it('resolves null when nothing named and drivable is near', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(DOCS_EXAMPLE), { status: 200 }));
    await expect(fetchRoadName(anchorAt(0), { token: 'pk.test' })).resolves.toBeNull();
  });

  it('rejects with HttpError on an API error', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"message":"Not Authorized - Invalid Token"}', { status: 401 }));
    await expect(fetchRoadName(anchorAt(0), { token: 'pk.bad' })).rejects.toBeInstanceOf(HttpError);
  });
});

// ---------------------------------------------------------------------------
// Anchor / request cadence
// ---------------------------------------------------------------------------

function sample(at: LngLat, headingDeg: number | null, accuracyM = 5, timestamp = 0): Pick<Telemetry, 'fix' | 'headingDeg'> {
  const fix: Fix = { lng: at[0], lat: at[1], speedMps: headingDeg === null ? 0 : 12, headingDeg, accuracyM, timestamp };
  return { fix, headingDeg };
}
const ahead = (m: number, bearing = 0): LngLat => destinationPoint(HOME, bearing, m);
const T0 = 1_700_000_000_000;

describe('advanceRoadAnchor', () => {
  it('waits for the first usable fix', () => {
    expect(advanceRoadAnchor(null, { fix: null, headingDeg: null })).toBeNull();
    expect(advanceRoadAnchor(null, sample(HOME, 0, ROAD_MAX_ACCURACY_M + 1))).toBeNull();
    const first = advanceRoadAnchor(null, sample(HOME, 12.4, 5, T0));
    expect(first).toEqual({ lat: 37.7749, lng: -122.4194, headingDeg: 12, accuracyM: 5, at: T0 });
  });

  it('keeps the same anchor (same reference) until the vehicle has travelled far enough', () => {
    // 5 m/s (city): distance is what paces the lookups.
    const first = advanceRoadAnchor(null, sample(HOME, 0, 5, T0))!;
    let a = first;
    for (let m = 10; m < ROAD_REFETCH_DISTANCE_M; m += 10) {
      a = advanceRoadAnchor(a, sample(ahead(m), m % 20 === 0 ? 8 : 352, 5, T0 + m * 200))!; // weaving ±8°
      expect(a).toBe(first);
    }
    const next = advanceRoadAnchor(a, sample(ahead(ROAD_REFETCH_DISTANCE_M + 2), 0, 5, T0 + 25_400))!;
    expect(next).not.toBe(first);
    expect(next.lat).toBeGreaterThan(first.lat);
  });

  it('at highway speed waits for the time floor too (regression: the rate grew with speed)', () => {
    const first = advanceRoadAnchor(null, sample(HOME, 0, 5, T0))!;
    // 31 m/s (70 mph): 125 m is passed after 4 s, but the next lookup waits for 15 s.
    let a = first;
    for (let s = 1; s * 1000 < ROAD_REFETCH_MIN_INTERVAL_MS; s++) {
      a = advanceRoadAnchor(a, sample(ahead(31 * s), 0, 5, T0 + s * 1000))!;
      expect(a).toBe(first);
    }
    const next = advanceRoadAnchor(a, sample(ahead(31 * 15), 0, 5, T0 + ROAD_REFETCH_MIN_INTERVAL_MS))!;
    expect(next).not.toBe(first);
  });

  it('bounds an hour of straight driving: ≤ 240 lookups at 70 mph (was ~900), one per 125 m when slow', () => {
    const lookupsPerHour = (speedMps: number) => {
      let anchor = advanceRoadAnchor(null, sample(HOME, 90, 5, T0))!;
      let count = 1;
      for (let s = 1; s <= 3600; s++) {
        const next = advanceRoadAnchor(anchor, sample(destinationPoint(HOME, 90, speedMps * s), 90, 5, T0 + s * 1000))!;
        if (next !== anchor) count++;
        anchor = next;
      }
      return count;
    };
    expect(lookupsPerHour(31.3)).toBeLessThanOrEqual(3_600_000 / ROAD_REFETCH_MIN_INTERVAL_MS + 1);
    expect(lookupsPerHour(31.3)).toBeGreaterThan(200);
    expect(lookupsPerHour(5)).toBeLessThanOrEqual((5 * 3600) / ROAD_REFETCH_DISTANCE_M + 1);
    expect(lookupsPerHour(5)).toBeGreaterThan(130);
  });

  it('never re-anchors while stopped, even with GPS jitter and a lost heading', () => {
    const first = advanceRoadAnchor(null, sample(HOME, 90, 5, T0))!;
    expect(advanceRoadAnchor(first, sample(ahead(6, 45), null, 5, T0 + 60_000))).toBe(first);
    expect(advanceRoadAnchor(first, sample(ahead(9, 200), null, 5, T0 + 120_000))).toBe(first);
  });

  it('re-anchors after a turn once past the intersection', () => {
    const first = advanceRoadAnchor(null, sample(HOME, 0, 5, T0))!;
    // Mid-turn, still in the intersection: not yet.
    expect(advanceRoadAnchor(first, sample(ahead(12, 45), 75, 5, T0 + 6_000))).toBe(first);
    // Turned 90° and 25 m on: new lookup with the new heading.
    const turned = advanceRoadAnchor(first, sample(ahead(25, 60), 90, 5, T0 + 8_000))!;
    expect(turned).not.toBe(first);
    expect(turned.headingDeg).toBe(90);
    // A gentle curve does not count as a turn.
    expect(advanceRoadAnchor(first, sample(ahead(40, 10), 35, 5, T0 + 8_000))).toBe(first);
  });

  it('a turn right after a lookup waits only briefly', () => {
    const first = advanceRoadAnchor(null, sample(HOME, 0, 5, T0))!;
    expect(advanceRoadAnchor(first, sample(ahead(25, 60), 90, 5, T0 + ROAD_TURN_MIN_INTERVAL_MS - 1000))).toBe(first);
    expect(advanceRoadAnchor(first, sample(ahead(30, 60), 90, 5, T0 + ROAD_TURN_MIN_INTERVAL_MS))?.headingDeg).toBe(90);
  });

  it('re-anchors once a heading is known after starting from rest', () => {
    const parked = advanceRoadAnchor(null, sample(HOME, null, 5, T0))!;
    expect(parked.headingDeg).toBeNull();
    expect(advanceRoadAnchor(parked, sample(ahead(8), 0, 5, T0 + 30_000))).toBe(parked);
    expect(advanceRoadAnchor(parked, sample(ahead(22), 0, 5, T0 + 32_000))?.headingDeg).toBe(0);
  });

  it('re-anchors when a coarse start-up fix is followed by a much better one', () => {
    const coarse = advanceRoadAnchor(null, sample(HOME, null, 65))!;
    expect(advanceRoadAnchor(coarse, sample(ahead(3), null, 40))).toBe(coarse);
    const fine = advanceRoadAnchor(coarse, sample(ahead(3), null, 8))!;
    expect(fine).not.toBe(coarse);
    // Already good: improving further does not re-anchor.
    expect(advanceRoadAnchor(fine, sample(ahead(3), null, 3))).toBe(fine);
  });

  it('keeps the anchor when fixes disappear or are coarse', () => {
    const first = advanceRoadAnchor(null, sample(HOME, 0, 5, T0))!;
    expect(advanceRoadAnchor(first, { fix: null, headingDeg: null })).toBe(first);
    expect(advanceRoadAnchor(first, sample(ahead(500), 0, 300, T0 + 60_000))).toBe(first);
  });
});

describe('createRoadAnchorSelector', () => {
  const telem = (s: Pick<Telemetry, 'fix' | 'headingDeg'>): Telemetry => ({
    status: 'tracking',
    source: 'gps',
    speedMps: 12,
    speedKnown: true,
    compassDeg: null,
    ...s,
  });

  it('only changes its result when a lookup is due, and is idempotent', () => {
    const select = createRoadAnchorSelector();
    const a = select(telem(sample(HOME, 0, 5, T0)));
    expect(select(telem(sample(HOME, 0, 5, T0)))).toBe(a);
    expect(select(telem(sample(ahead(60), 0, 5, T0 + 5_000)))).toBe(a);
    const b = select(telem(sample(ahead(130), 0, 5, T0 + 16_000)));
    expect(b).not.toBe(a);
    expect(select(telem(sample(ahead(130), 0, 5, T0 + 16_000)))).toBe(b);
  });
});

describe('roadNameQueryOptions / latestRoadMatch', () => {
  it('keys on the anchor and is disabled without an anchor (or token)', () => {
    const anchor = anchorAt(90);
    const options = roadNameQueryOptions(anchor);
    expect(options.queryKey).toEqual([ROAD_NAME_ROOT, 37.7749, -122.4194, 90]);
    expect(options.staleTime).toBe(Infinity);
    expect(options.queryFn === skipToken).toBe(!hasMapboxToken);
    expect(roadNameQueryOptions(null).queryFn).toBe(skipToken);
  });

  it('finds the most recent result across anchors, including "no road"', () => {
    const client = new QueryClient();
    expect(latestRoadMatch(client)).toBeUndefined();
    client.setQueryData([ROAD_NAME_ROOT, 1, 1, 0], { name: 'Main Street', ref: null, roadClass: 'street' }, { updatedAt: 1000 });
    client.setQueryData([ROAD_NAME_ROOT, 2, 2, 0], { name: 'Elm Street', ref: null, roadClass: 'street' }, { updatedAt: 3000 });
    client.setQueryData(['weather', 1, 1, 'celsius'], { temperature: 1 }, { updatedAt: 9000 });
    expect(latestRoadMatch(client)?.name).toBe('Elm Street');
    client.setQueryData([ROAD_NAME_ROOT, 3, 3, 0], null, { updatedAt: 5000 });
    expect(latestRoadMatch(client)).toBeNull();
    client.clear();
  });
});
