import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './client';
import {
  MIN_QUERY_LENGTH,
  SUGGEST_LIMIT,
  fetchPlace,
  newSessionToken,
  normalizeQuery,
  parseRetrieveResponse,
  parseSuggestResponse,
  retrieveUrl,
  suggestQueryKey,
  suggestQueryOptions,
  suggestUrl,
  suggestionKind,
} from './search';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Shaped like the Search Box API docs' /suggest example (Michigan Stadium) plus an address and a category. */
const SUGGEST_RESPONSE = {
  suggestions: [
    {
      name: 'Michigan Stadium',
      name_local: { en: 'Michigan Stadium' },
      mapbox_id: 'dXJuOm1ieHBvaTo0ZTg2ZWFkNS1jOWMwLTQ3OWEtOTA5Mi1kMDVlNDQ3NDdlODk',
      feature_type: 'poi',
      address: '1300 South Main Street',
      full_address: '1300 South Main Street, Ann Arbor, Michigan 48104, United States',
      place_formatted: 'Ann Arbor, Michigan 48104, United States',
      context: {
        country: { name: 'United States', country_code: 'US', country_code_alpha_3: 'USA' },
        region: { name: 'Michigan', region_code: 'MI', region_code_full: 'US-MI' },
        postcode: { id: 'POSTCODE_ID', name: '48104' },
        place: { id: 'PLACE_ID', name: 'Ann Arbor' },
        neighborhood: { id: 'NEIGHBORHOOD_ID', name: 'South Main' },
        address: { name: '1300 South Main Street', address_number: '1300', street_name: 'South Main Street' },
        street: { name: 'South Main Street' },
      },
      language: 'en',
      maki: 'fitness-centre',
      poi_category: ['sports', 'stadium'],
      poi_category_ids: ['sports', 'stadium'],
      external_ids: { provider: 'SOME_ID' },
      metadata: {},
      distance: 1834,
    },
    {
      name: '1120 Elm Street',
      mapbox_id: 'dXJuOm1ieGFkcjphZGRyZXNz',
      feature_type: 'address',
      address: '1120 Elm Street',
      full_address: '1120 Elm Street, Ann Arbor, Michigan 48104, United States',
      place_formatted: 'Ann Arbor, Michigan 48104, United States',
      context: { country: { name: 'United States', country_code: 'US', country_code_alpha_3: 'USA' } },
      language: 'en',
    },
    { name: 'Coffee', mapbox_id: 'coffee', feature_type: 'category', place_formatted: '', context: {}, language: 'en' },
    { name: 'Broken', feature_type: 'poi' },
    {
      name: 'Harbor Coffee Roasters',
      mapbox_id: 'harbor-coffee',
      feature_type: 'poi',
      address: '1120 Elm St',
      place_formatted: 'Ann Arbor, Michigan 48104, United States',
      maki: 'cafe',
      poi_category: ['coffee', 'cafe'],
      context: {},
      language: 'en',
    },
  ],
  attribution: '© 2023 Mapbox and its suppliers. All rights reserved.',
  response_id: 'abc',
};

/** Shaped like the docs' /retrieve example. */
const RETRIEVE_RESPONSE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { coordinates: [-83.74874231395097, 42.265884912011956], type: 'Point' },
      properties: {
        name: 'Michigan Stadium',
        mapbox_id: 'dXJuOm1ieHBvaTo0ZTg2ZWFkNS1jOWMwLTQ3OWEtOTA5Mi1kMDVlNDQ3NDdlODk',
        feature_type: 'poi',
        address: '1300 South Main Street',
        full_address: '1300 South Main Street, Ann Arbor, Michigan 48104, United States',
        place_formatted: 'Ann Arbor, Michigan 48104, United States',
        context: {},
        coordinates: {
          latitude: 42.265884912011956,
          longitude: -83.74874231395097,
          routable_points: [{ name: 'POI', latitude: 42.265818837636, longitude: -83.75026591132605 }],
        },
        language: 'en',
        maki: 'fitness-centre',
        poi_category: ['sports', 'stadium'],
        metadata: { phone: 'PHONE_NUMBER', website: 'WEBSITE' },
        operational_status: 'active',
      },
    },
  ],
  attribution: '© 2026 Mapbox and its suppliers. All rights reserved.',
};

describe('URLs', () => {
  it('builds /suggest with the session token, limit, types and a rounded proximity/origin', () => {
    const url = new URL(suggestUrl({ q: '  Michigan   Stadium ', sessionToken: 'sess-1', proximity: [-83.7487084, 42.2658371] }, 'pk.test'));
    expect(url.origin + url.pathname).toBe('https://api.mapbox.com/search/searchbox/v1/suggest');
    expect(url.searchParams.get('q')).toBe('Michigan Stadium');
    expect(url.searchParams.get('session_token')).toBe('sess-1');
    expect(url.searchParams.get('access_token')).toBe('pk.test');
    expect(url.searchParams.get('limit')).toBe(String(SUGGEST_LIMIT));
    expect(url.searchParams.get('types')).toContain('poi');
    expect(url.searchParams.get('types')).not.toContain('category');
    expect(url.searchParams.get('proximity')).toBe('-83.749,42.266');
    expect(url.searchParams.get('origin')).toBe('-83.749,42.266');
  });

  it('falls back to IP proximity without a position', () => {
    const url = new URL(suggestUrl({ q: 'x y', sessionToken: 's', proximity: null }, 'pk'));
    expect(url.searchParams.get('proximity')).toBe('ip');
    expect(url.searchParams.has('origin')).toBe(false);
  });

  it('builds /retrieve/{id} with the same session token', () => {
    const url = new URL(retrieveUrl('a/b id', 'sess-1', 'pk.test'));
    expect(url.pathname).toBe('/search/searchbox/v1/retrieve/a%2Fb%20id');
    expect(url.searchParams.get('session_token')).toBe('sess-1');
    expect(url.searchParams.get('access_token')).toBe('pk.test');
  });

  it('session tokens are UUIDv4 and unique', () => {
    const a = newSessionToken();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newSessionToken()).not.toBe(a);
  });

  it('normalises queries', () => {
    expect(normalizeQuery('  a   b ')).toBe('a b');
    expect(normalizeQuery('x'.repeat(300))).toHaveLength(256);
  });
});

describe('parseSuggestResponse', () => {
  it('maps the doc-shaped response, drops categories and malformed entries', () => {
    const list = parseSuggestResponse(SUGGEST_RESPONSE);
    expect(list.map((s) => s.id)).toEqual([
      'dXJuOm1ieHBvaTo0ZTg2ZWFkNS1jOWMwLTQ3OWEtOTA5Mi1kMDVlNDQ3NDdlODk',
      'dXJuOm1ieGFkcjphZGRyZXNz',
      'harbor-coffee',
    ]);
    expect(list[0]).toEqual({
      id: 'dXJuOm1ieHBvaTo0ZTg2ZWFkNS1jOWMwLTQ3OWEtOTA5Mi1kMDVlNDQ3NDdlODk',
      name: 'Michigan Stadium',
      detail: 'Sports · 1300 South Main Street',
      featureType: 'poi',
      kind: 'poi',
      distanceM: 1834,
    });
    expect(list[1]).toMatchObject({ name: '1120 Elm Street', detail: 'Ann Arbor, Michigan 48104, United States', kind: 'address', distanceM: null });
    expect(list[2]).toMatchObject({ detail: 'Coffee · 1120 Elm St', kind: 'coffee' });
  });

  it('returns [] for an empty list but throws for a body without suggestions', () => {
    expect(parseSuggestResponse({ suggestions: [], attribution: '' })).toEqual([]);
    expect(() => parseSuggestResponse({ message: 'Not Authorized - Invalid Token' })).toThrow();
    expect(() => parseSuggestResponse(null)).toThrow();
  });

  it('picks icon families', () => {
    expect(suggestionKind('poi', 'fuel', [])).toBe('fuel');
    expect(suggestionKind('poi', null, ['parking lot'])).toBe('parking');
    expect(suggestionKind('poi', 'restaurant', [])).toBe('food');
    expect(suggestionKind('poi', 'park', [])).toBe('park');
    expect(suggestionKind('street', null, [])).toBe('street');
    expect(suggestionKind('place', null, [])).toBe('place');
  });
});

describe('parseRetrieveResponse', () => {
  it('maps the doc-shaped feature to a Place at its routable point', () => {
    expect(parseRetrieveResponse(RETRIEVE_RESPONSE)).toEqual({
      id: 'dXJuOm1ieHBvaTo0ZTg2ZWFkNS1jOWMwLTQ3OWEtOTA5Mi1kMDVlNDQ3NDdlODk',
      name: 'Michigan Stadium',
      address: '1300 South Main Street, Ann Arbor, Michigan 48104, United States',
      lat: 42.265818837636,
      lng: -83.75026591132605,
    });
  });

  it('uses the feature point without routable points, and properties.coordinates without geometry', () => {
    const feature = RETRIEVE_RESPONSE.features[0];
    const noRoutable = {
      features: [{ ...feature, properties: { ...feature.properties, coordinates: { latitude: 1, longitude: 2 } } }],
    };
    expect(parseRetrieveResponse(noRoutable)).toMatchObject({ lat: 42.265884912011956, lng: -83.74874231395097 });
    const noGeometry = { features: [{ type: 'Feature', properties: { name: 'X', coordinates: { latitude: 10, longitude: 20 } } }] };
    expect(parseRetrieveResponse(noGeometry, { id: 'fallback', name: 'Fallback', detail: 'Somewhere' })).toEqual({
      id: 'fallback',
      name: 'X',
      address: 'Somewhere',
      lat: 10,
      lng: 20,
    });
  });

  it('throws without features or coordinates', () => {
    expect(() => parseRetrieveResponse({ type: 'FeatureCollection', features: [] })).toThrow('Place not found');
    expect(() => parseRetrieveResponse({ features: [{ type: 'Feature', geometry: { coordinates: [500, 1] }, properties: {} }] })).toThrow();
  });
});

describe('fetching through TanStack Query', () => {
  it('fetchPlace calls /retrieve and parses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(RETRIEVE_RESPONSE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const place = await fetchPlace({ id: 'abc', name: 'n', detail: '' }, 'sess', 'pk.t');
    expect(place.name).toBe('Michigan Stadium');
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/retrieve/abc?session_token=sess');
  });

  it('surfaces a bad token as an HttpError', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"message":"Not Authorized - Invalid Token"}', { status: 401 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const opts = suggestQueryOptions({ q: 'coffee', sessionToken: 's', proximity: null }, 'pk.bad');
    const error = await client.fetchQuery(opts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    client.clear();
  });

  it('keys by normalised text, session and rounded position; disabled without token or text', () => {
    const a = suggestQueryKey({ q: 'Blue  Bottle', sessionToken: 's', proximity: [-122.40001, 37.79001] });
    const b = suggestQueryKey({ q: 'blue bottle ', sessionToken: 's', proximity: [-122.40004, 37.79004] });
    expect(a).toEqual(b);
    expect(suggestQueryKey({ q: 'blue bottle', sessionToken: 't', proximity: null })).not.toEqual(a);
    expect(suggestQueryOptions({ q: 'blue', sessionToken: 's', proximity: null }, '').enabled).toBe(false);
    expect(suggestQueryOptions({ q: 'b'.repeat(MIN_QUERY_LENGTH - 1), sessionToken: 's', proximity: null }, 'pk').enabled).toBe(false);
    expect(suggestQueryOptions({ q: 'bl', sessionToken: 's', proximity: null }, 'pk').enabled).toBe(true);
  });
});
