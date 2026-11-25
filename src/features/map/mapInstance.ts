/**
 * The one `mapboxgl.Map` of the app (T12).
 *
 * The map lives in a container element owned by this module, created on the first
 * `mountMap(host)` and kept for the life of the page: unmounting `MapView` (React StrictMode
 * runs effects twice, layout changes, …) only detaches the container, and the next mount
 * re-attaches it — the map is never re-created on re-render or theme change. Day/night is a
 * `setConfigProperty` call (see `mapTheme.ts`), never `setStyle`, so sources and layers that
 * other features add through `whenMapReady` survive.
 *
 * One rAF loop (`frameLoop.ts`) reads the `pose` Motion values once per frame and feeds the
 * puck and the follow camera; it pauses while the document is hidden.
 */
import mapboxgl from 'mapbox-gl';
import type { Map as MapboxMap, MapOptions, StyleSpecification } from 'mapbox-gl';
import { MAPBOX_TOKEN, hasMapboxToken } from '../../api/client';
import { pose, telemetry } from '../../state';
import { createFollowCamera, restingPadding, type PoseSnapshot } from './camera';
import { startFrameLoop } from './frameLoop';
import { attachMapTheme, initialLightPreset } from './mapTheme';
import { createPuck } from './puck';
import { createReadyRegistry } from './readyRegistry';
import { SAVE_INTERVAL_MS, loadLastPosition, rememberPosition, restingView } from './resting';

/** Mapbox Standard. */
export const STANDARD_STYLE_URL = 'mapbox://styles/mapbox/standard';

/**
 * Standard style configuration (`basemap` import) for a calm driving map: no POI, transit,
 * landmark or pedestrian clutter; road names and place names on; 3D buildings kept (they give
 * the pitched view its depth). `lightPreset` is added at runtime by `mapTheme.ts`.
 */
export const BASEMAP_CONFIG = {
  showPointOfInterestLabels: false,
  showTransitLabels: false,
  showLandmarkIcons: false,
  showLandmarkIconLabels: false,
  showPedestrianRoads: false,
  showRoadLabels: true,
  showPlaceLabels: true,
  show3dObjects: true,
} as const;

const ready = createReadyRegistry<MapboxMap>('map');

interface Instance {
  map: MapboxMap;
  container: HTMLDivElement;
  observer: ResizeObserver | null;
  destroy(): void;
}

let instance: Instance | null = null;
let devStyle: StyleSpecification | null = null;

/**
 * DEV harness only (`src/features/map/dev/`): render a local style without a Mapbox token.
 * Call before `MapView` first mounts. Ignored in production builds.
 */
export function __useDevStyle(style: StyleSpecification): void {
  if (import.meta.env.DEV) devStyle = style;
}

/** `true` when a map can be shown (a token is configured, or the dev harness supplied a style). */
export function isMapEnabled(): boolean {
  return hasMapboxToken || devStyle !== null;
}

/** The live map instance, or `null` before its style has loaded / without a token. */
export function getMap(): MapboxMap | null {
  return ready.get();
}

/**
 * Run `cb` once the map style has loaded (immediately if it already has). Safe to call before
 * the map exists. Returns an unsubscribe function. Add route sources/layers here (use
 * `slot: 'middle'` for lines under the 3D buildings and labels); they survive day/night changes.
 */
export function whenMapReady(cb: (map: MapboxMap) => void): () => void {
  return ready.when(cb);
}

/**
 * Attach the map to `host` (creating it on first use). Returns a function that detaches it
 * again without destroying it. No-op without a token.
 */
export function mountMap(host: HTMLElement): () => void {
  if (!isMapEnabled()) return () => {};
  if (instance) {
    host.appendChild(instance.container);
    instance.map.resize();
  } else {
    instance = createInstance(host);
  }
  const current = instance;
  current.observer?.observe(host);
  return () => {
    current.observer?.disconnect();
    if (current.container.parentElement === host) current.container.remove();
  };
}

function readPose(): PoseSnapshot {
  return {
    has: pose.hasPose.get(),
    lat: pose.lat.get(),
    lng: pose.lng.get(),
    headingDeg: pose.headingDeg.get(),
    speedMps: pose.speedMps.get(),
    accuracyM: pose.accuracyM.get(),
  };
}

function createInstance(host: HTMLElement): Instance {
  const container = document.createElement('div');
  container.className = 'dash-map__gl';
  host.appendChild(container);

  const resting = restingView(loadLastPosition(), new Date().getTimezoneOffset());

  const styleOptions: Pick<MapOptions, 'style' | 'config' | 'accessToken' | 'testMode'> = devStyle
    ? { style: devStyle, ...(hasMapboxToken ? { accessToken: MAPBOX_TOKEN } : { testMode: true }) }
    : {
        style: STANDARD_STYLE_URL,
        accessToken: MAPBOX_TOKEN,
        config: { basemap: { ...BASEMAP_CONFIG, lightPreset: initialLightPreset(resting) } },
      };

  const map = new mapboxgl.Map({
    container,
    ...styleOptions,
    center: [resting.lng, resting.lat],
    zoom: resting.zoom,
    pitch: resting.pitch,
    bearing: resting.bearing,
    maxPitch: 75,
    // Heading-up map: never snap a user rotation back to north.
    bearingSnap: 0,
    keyboard: false,
    boxZoom: false,
    attributionControl: false,
    // Placed above the compass strip by map.css (bottom-right is the HUD's chip column).
    logoPosition: 'bottom-left',
    performanceMetricsCollection: false,
  });
  map.setPadding(restingPadding(host.clientWidth, host.clientHeight));
  map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

  const camera = createFollowCamera(map, resting);
  const puck = createPuck(map);
  const detachTheme = attachMapTheme(map, resting);

  const onReady = () => ready.resolve(map);
  map.on('style.load', onReady);
  map.on('load', onReady); // belt and braces: whichever comes first
  map.on('resize', camera.resize);

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.resize());

  // Remember where we are, so the next launch rests over it (real GPS only — never the demo drive).
  let lastSaveMs = Number.NEGATIVE_INFINITY;
  const save = (p: PoseSnapshot) =>
    rememberPosition({ lng: p.lng, lat: p.lat, headingDeg: p.headingDeg, savedAt: Date.now() }, telemetry.get());
  const onPageHide = () => {
    if (pose.hasPose.get()) save(readPose());
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') onPageHide();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);

  const stopLoop = startFrameLoop((now, dt) => {
    const p = readPose();
    puck.update(p);
    camera.tick(now, dt, p);
    if (p.has && now - lastSaveMs >= SAVE_INTERVAL_MS) {
      lastSaveMs = now;
      save(p);
    }
  });

  return {
    map,
    container,
    observer,
    destroy() {
      stopLoop();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      observer?.disconnect();
      detachTheme();
      puck.destroy();
      camera.destroy();
      ready.reset();
      map.remove();
      container.remove();
    },
  };
}

// Vite HMR: editing a map module would otherwise leak a second WebGL map.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    instance?.destroy();
    instance = null;
  });
}
