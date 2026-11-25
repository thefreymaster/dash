/**
 * DEV ONLY — loaded by `../index.ts` behind `import.meta.env.DEV`; never part of a build.
 *
 * Without a Mapbox token, search and directions cannot be exercised live. This harness lets
 * the WHOLE navigation path run anyway (URL building → fetchJson → parsers → TanStack keys
 * and cadence → engine → UI) by answering requests that carry the placeholder token
 * `pk.dev-fixtures` with doc-shaped fixture responses:
 *
 *   /search/searchbox/v1/suggest     fixture places whose name contains the query
 *                                    ("fail" in the query → HTTP 503, to see the error state)
 *   /search/searchbox/v1/retrieve    the place as a GeoJSON FeatureCollection
 *   /directions/v5/…/driving-traffic a route along the demo loop's real streets (the
 *                                    simulator's fallback loop, downtown San Francisco), with
 *                                    turn steps and banners; > 50 km → `NoRoute`;
 *                                    a destination named "…Unreachable…" → HTTP 503
 *
 * Console / automation (`window.__dashNav`):
 *   __dashNav.useFixtures()           enable the above (also seeds a few recents)
 *   __dashNav.open() / .close()       search sheet
 *   __dashNav.go('Harbor Coffee')     set a fixture destination directly
 *   __dashNav.cancel()                end navigation
 *   __dashNav.fakeKeyboard(true)      shrink visualViewport by 200 px + draw a keyboard placeholder
 *   __dashNav.view.get()              status + progress the banner/ETA chip show
 */
import { angleDiffDeg, bearingDeg, cumulativeLengthsM, haversineM, nearestPointOnLine } from '../../../lib';
import { SIM_FALLBACK_LOOP } from '../../../sensors/simulator';
import { addRecent, nav, recents } from '../../../state';
import type { LngLat, Place } from '../../../types';
import { endNavigation } from '../actions';
import { closeSearchSheet, navView, openSearchSheet, searchOpen } from '../navState';
import { __setDevNavToken } from '../token';

export const FIXTURE_TOKEN = 'pk.dev-fixtures';
const LATENCY_MS = 650;

// ---------------------------------------------------------------------------
// The demo loop's streets (SIM_FALLBACK_LOOP, closed), named per segment
// ---------------------------------------------------------------------------

const LOOP: LngLat[] = [...SIM_FALLBACK_LOOP.map((p) => [p[0], p[1]] as LngLat), [SIM_FALLBACK_LOOP[0][0], SIM_FALLBACK_LOOP[0][1]]];
const LOOP_CUM = cumulativeLengthsM(LOOP);
const LOOP_TOTAL = LOOP_CUM[LOOP_CUM.length - 1];
/** Street of segment i (vertex i → i + 1). */
const SEGMENT_NAMES = [
  'The Embarcadero',
  'The Embarcadero',
  'Bay Street',
  'Bay Street',
  'Van Ness Avenue',
  'Van Ness Avenue',
  'California Street',
  'California Street',
  'California Street',
  'Drumm Street',
];

function loopPoint(along: number): LngLat {
  const s = ((along % LOOP_TOTAL) + LOOP_TOTAL) % LOOP_TOTAL;
  let i = 0;
  while (i < LOOP.length - 2 && LOOP_CUM[i + 1] < s) i++;
  const seg = LOOP_CUM[i + 1] - LOOP_CUM[i];
  const t = seg > 0 ? (s - LOOP_CUM[i]) / seg : 0;
  return [LOOP[i][0] + (LOOP[i + 1][0] - LOOP[i][0]) * t, LOOP[i][1] + (LOOP[i + 1][1] - LOOP[i][1]) * t];
}
const segmentAt = (along: number) => {
  const s = ((along % LOOP_TOTAL) + LOOP_TOTAL) % LOOP_TOTAL;
  let i = 0;
  while (i < LOOP.length - 2 && LOOP_CUM[i + 1] <= s) i++;
  return i;
};

// ---------------------------------------------------------------------------
// Fixture places (fictional names, real streets of the demo loop)
// ---------------------------------------------------------------------------

interface FixturePlace extends Place {
  kind: 'poi' | 'address';
  category?: string;
  maki?: string;
}

const onLoop = (along: number) => loopPoint(along);
const fp = (id: string, name: string, along: number, address: string, category?: string, maki?: string): FixturePlace => {
  const [lng, lat] = onLoop(along);
  return { id, name, lat, lng, address, kind: category ? 'poi' : 'address', category, maki };
};

export const FIXTURE_PLACES: FixturePlace[] = [
  fp('fx-harbor-coffee', 'Harbor Coffee Roasters', LOOP_CUM[2] + 480, '1120 Bay St, San Francisco, California 94133', 'coffee', 'cafe'),
  fp('fx-harbor-park', 'Harbor Point Park', LOOP_CUM[4] + 300, 'Van Ness Ave, San Francisco, California 94109', 'park', 'park'),
  fp('fx-harborview', 'Harborview Marina', LOOP_CUM[1] + 300, 'Pier 33, San Francisco, California 94111', 'marina', 'harbor'),
  fp('fx-nob-hill', 'Nob Hill Market', LOOP_CUM[6] + 600, '1500 California St, San Francisco, California 94109', 'grocery', 'grocery'),
  fp('fx-ferry', 'Ferry Plaza Garage', LOOP_CUM[9] + 250, 'Drumm St, San Francisco, California 94111', 'parking', 'parking'),
  fp('fx-1355-bay', '1355 Bay Street', LOOP_CUM[3] + 150, 'San Francisco, California 94123'),
  { id: 'fx-honolulu', name: 'Honolulu Harbor', lat: 21.3069, lng: -157.8664, address: 'Honolulu, Hawaii 96813', kind: 'poi', category: 'harbor', maki: 'harbor' },
  { ...fp('fx-unreachable', 'Harbor Unreachable Café', LOOP_CUM[2] + 200, 'Bay St, San Francisco, California 94133', 'cafe', 'cafe') },
];

const RECENT_SEED: Place[] = [
  { id: 'fx-home', name: 'Home', address: '44 Birch Ln', ...lngLatObj(onLoop(LOOP_CUM[7] + 300)) },
  { id: 'fx-work', name: 'Work', address: '600 Montgomery St', ...lngLatObj(onLoop(LOOP_CUM[8] + 300)) },
  { id: 'fx-lakeside', name: 'Lakeside Market', address: 'Grocery · 210 Lake Ave', ...lngLatObj(onLoop(LOOP_CUM[5] + 200)) },
];
function lngLatObj(p: LngLat) {
  return { lng: p[0], lat: p[1] };
}

// ---------------------------------------------------------------------------
// Doc-shaped responses
// ---------------------------------------------------------------------------

function suggestResponse(url: URL): unknown {
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  const origin = url.searchParams.get('origin')?.split(',').map(Number) as LngLat | undefined;
  const limit = Number(url.searchParams.get('limit') ?? 6);
  const matches = FIXTURE_PLACES.filter((p) => p.name.toLowerCase().includes(q) || (p.address ?? '').toLowerCase().includes(q)).slice(0, limit);
  return {
    suggestions: matches.map((p) => ({
      name: p.name,
      mapbox_id: p.id,
      feature_type: p.kind,
      address: p.kind === 'poi' ? (p.address ?? '').split(',')[0] : p.name,
      full_address: p.kind === 'poi' ? p.address : `${p.name}, ${p.address}`,
      place_formatted: p.kind === 'poi' ? (p.address ?? '').split(',').slice(1).join(',').trim() : p.address,
      context: { country: { name: 'United States', country_code: 'US', country_code_alpha_3: 'USA' }, place: { id: 'sf', name: 'San Francisco' } },
      language: 'en',
      maki: p.maki,
      poi_category: p.category ? [p.category] : undefined,
      poi_category_ids: p.category ? [p.category] : undefined,
      metadata: {},
      distance: origin && Number.isFinite(origin[0]) ? Math.round(haversineM(origin, [p.lng, p.lat])) : undefined,
    })),
    attribution: '© 2026 Mapbox and its suppliers. All rights reserved. (dev fixture)',
    response_id: 'dev-fixture',
  };
}

function retrieveResponse(id: string): unknown {
  const p = FIXTURE_PLACES.find((x) => x.id === id);
  if (!p) return { type: 'FeatureCollection', features: [], attribution: '' };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {
          name: p.name,
          mapbox_id: p.id,
          feature_type: p.kind,
          address: (p.address ?? '').split(',')[0],
          full_address: p.kind === 'poi' ? p.address : `${p.name}, ${p.address}`,
          place_formatted: (p.address ?? '').split(',').slice(1).join(',').trim(),
          context: {},
          coordinates: { latitude: p.lat, longitude: p.lng, routable_points: [{ name: 'default', latitude: p.lat, longitude: p.lng }] },
          language: 'en',
          maki: p.maki,
          poi_category: p.category ? [p.category] : undefined,
          metadata: {},
          operational_status: 'active',
        },
      },
    ],
    attribution: '© 2026 Mapbox and its suppliers. All rights reserved. (dev fixture)',
  };
}

function modifierFor(turn: number): string {
  const a = Math.abs(turn);
  const side = turn > 0 ? 'right' : 'left';
  if (a < 15) return 'straight';
  if (a < 45) return `slight ${side}`;
  if (a < 125) return side;
  if (a < 170) return `sharp ${side}`;
  return 'uturn';
}

/** A driving route from origin to destination along the demo loop (forward direction). */
function directionsResponse(origin: LngLat, dest: LngLat): unknown {
  if (haversineM(origin, dest) > 50_000) return { code: 'NoRoute', message: 'No route found', routes: [] };
  const o = nearestPointOnLine(LOOP, origin, LOOP_CUM)!;
  const d = nearestPointOnLine(LOOP, dest, LOOP_CUM)!;
  let end = d.alongM;
  if (end <= o.alongM + 5) end += LOOP_TOTAL;

  // Geometry: the origin, the loop every ≤ 20 m (plus every corner), the destination.
  const samples: number[] = [];
  for (let s = o.alongM; s < end; s += 20) samples.push(s);
  for (let lap = 0; lap <= 1; lap++) {
    for (let i = 1; i < LOOP.length - 1; i++) {
      const s = LOOP_CUM[i] + lap * LOOP_TOTAL;
      if (s > o.alongM && s < end) samples.push(s);
    }
  }
  samples.push(end);
  samples.sort((a, b) => a - b);
  const line: LngLat[] = [origin];
  for (const s of samples) {
    const p = loopPoint(s);
    if (haversineM(line[line.length - 1], p) > 0.5) line.push(p);
  }
  if (haversineM(line[line.length - 1], dest) > 0.5) line.push(dest);

  // Maneuvers: depart, each corner where the street or direction changes, arrive.
  interface M { along: number; location: LngLat; type: string; modifier: string | null; name: string; bearingAfter: number; bearingBefore: number }
  const startSeg = segmentAt(o.alongM);
  const maneuvers: M[] = [
    { along: o.alongM, location: origin, type: 'depart', modifier: null, name: SEGMENT_NAMES[startSeg], bearingAfter: Math.round(bearingDeg(LOOP[startSeg], LOOP[startSeg + 1])), bearingBefore: 0 },
  ];
  for (let lap = 0; lap <= 1; lap++) {
    for (let i = 1; i < LOOP.length - 1; i++) {
      const s = LOOP_CUM[i] + lap * LOOP_TOTAL;
      if (!(s > o.alongM + 1 && s < end - 1)) continue;
      const before = bearingDeg(LOOP[i - 1], LOOP[i]);
      const after = bearingDeg(LOOP[i], LOOP[i + 1]);
      const turn = angleDiffDeg(before, after);
      if (SEGMENT_NAMES[i] === SEGMENT_NAMES[i - 1] && Math.abs(turn) < 30) continue;
      maneuvers.push({
        along: s,
        location: LOOP[i],
        type: Math.abs(turn) < 15 ? 'new name' : 'turn',
        modifier: modifierFor(turn),
        name: SEGMENT_NAMES[i],
        bearingAfter: Math.round(after),
        bearingBefore: Math.round(before),
      });
    }
  }
  maneuvers.sort((a, b) => a.along - b.along);
  const finalLeg = haversineM(loopPoint(end), dest);
  maneuvers.push({ along: end + finalLeg, location: dest, type: 'arrive', modifier: 'right', name: '', bearingAfter: 0, bearingBefore: 0 });

  const SPEED = 11; // m/s, city traffic
  const steps = maneuvers.map((m, i) => {
    const next = maneuvers[i + 1];
    const distance = next ? Math.max(0, next.along - m.along) : 0;
    const instruction =
      m.type === 'depart' ? `Drive along ${m.name}.` : m.type === 'arrive' ? 'Your destination is on the right.' : `Turn ${m.modifier} onto ${m.name}.`;
    return {
      maneuver: { type: m.type, ...(m.modifier ? { modifier: m.modifier } : {}), location: m.location, bearing_after: m.bearingAfter, bearing_before: m.bearingBefore, instruction },
      name: m.name,
      distance: Math.round(distance * 10) / 10,
      duration: Math.round((distance / SPEED) * 10) / 10,
      mode: 'driving',
      driving_side: 'right',
      weight: distance / SPEED,
      intersections: [],
      geometry: { type: 'LineString', coordinates: [m.location, next ? next.location : m.location] },
      bannerInstructions: next
        ? [{ distanceAlongGeometry: distance, primary: { text: next.type === 'arrive' ? 'Destination' : next.name, type: next.type, modifier: next.modifier ?? undefined, components: [] }, secondary: null }]
        : [],
    };
  });
  const distance = steps.reduce((s, x) => s + x.distance, 0);
  const duration = steps.reduce((s, x) => s + x.duration, 0);
  return {
    code: 'Ok',
    uuid: 'dev-fixture',
    waypoints: [
      { name: SEGMENT_NAMES[startSeg], location: origin, distance: 0 },
      { name: '', location: dest, distance: 0 },
    ],
    routes: [
      {
        weight_name: 'auto',
        weight: duration,
        duration,
        duration_typical: duration * 1.1,
        distance,
        geometry: { type: 'LineString', coordinates: line },
        legs: [{ distance, duration, summary: 'dev fixture', steps, via_waypoints: [], admins: [{ iso_3166_1: 'US', iso_3166_1_alpha3: 'USA' }] }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// fetch interceptor
// ---------------------------------------------------------------------------

let installed = false;
/** Requests answered so far, newest last (for automation checks). */
export const fixtureLog: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Service Unavailable', headers: { 'Content-Type': 'application/json' } });
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

function installFetch(): void {
  if (installed) return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.includes(`access_token=${FIXTURE_TOKEN}`)) return real(input, init);
    const url = new URL(href);
    fixtureLog.push(`${url.pathname}${url.search.replace(FIXTURE_TOKEN, '…')}`);
    await delay(LATENCY_MS, init?.signal);
    if (url.pathname.endsWith('/suggest')) {
      if ((url.searchParams.get('q') ?? '').toLowerCase().includes('fail')) return json(503, { message: 'Service Unavailable' });
      return json(200, suggestResponse(url));
    }
    if (url.pathname.includes('/retrieve/')) return json(200, retrieveResponse(decodeURIComponent(url.pathname.split('/retrieve/')[1])));
    if (url.pathname.includes('/directions/')) {
      const [a, b] = url.pathname.split('/').pop()!.split(';').map((c) => c.split(',').map(Number) as LngLat);
      const unreachable = FIXTURE_PLACES.find((p) => p.id === 'fx-unreachable')!;
      if (haversineM(b, [unreachable.lng, unreachable.lat]) < 2) return json(503, { message: 'Service Unavailable' });
      return json(200, directionsResponse(a, b));
    }
    return json(404, { message: 'Not Found' });
  };
}

// ---------------------------------------------------------------------------
// Keyboard placeholder (for screenshots of the keyboard-height constraint)
// ---------------------------------------------------------------------------

const KEYBOARD_PX = 200;
let keyboardEl: HTMLDivElement | null = null;

function fakeKeyboard(on: boolean): void {
  const vv = window.visualViewport;
  if (on) {
    if (vv) Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - KEYBOARD_PX });
    if (!keyboardEl) {
      keyboardEl = document.createElement('div');
      keyboardEl.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${KEYBOARD_PX}px;z-index:99;pointer-events:none;
        background:rgba(208,211,218,.9);backdrop-filter:blur(30px);border-top:1px solid rgba(255,255,255,.8);
        font:600 13px -apple-system,system-ui;color:rgba(10,18,32,.55);display:flex;align-items:flex-start;justify-content:center;padding-top:10px;`;
      keyboardEl.textContent = 'iOS keyboard placeholder · 200 px';
      document.body.appendChild(keyboardEl);
    }
  } else {
    if (vv) delete (vv as unknown as Record<string, unknown>).height;
    keyboardEl?.remove();
    keyboardEl = null;
  }
  vv?.dispatchEvent(new Event('resize'));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const hook = {
  /** Serve fixture responses for search/directions and seed recents. */
  useFixtures(): void {
    installFetch();
    __setDevNavToken(FIXTURE_TOKEN);
    if (recents.get().length === 0) [...RECENT_SEED].reverse().forEach(addRecent);
  },
  places: FIXTURE_PLACES,
  open: openSearchSheet,
  close: closeSearchSheet,
  /** Navigate to a fixture place by (partial) name, as if chosen in the sheet. */
  go(name: string): Place | null {
    const p = FIXTURE_PLACES.find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
    if (!p) return null;
    const place: Place = { id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng };
    nav.set((n) => ({ ...n, destination: place }));
    addRecent(place);
    return place;
  },
  cancel: endNavigation,
  fakeKeyboard,
  view: navView,
  nav,
  recents,
  searchOpen,
  fixtureLog,
};

declare global {
  interface Window {
    __dashNav?: typeof hook;
  }
}

if (import.meta.env.DEV) window.__dashNav = hook;
