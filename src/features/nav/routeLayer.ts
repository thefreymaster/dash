/**
 * Route line on the map (T27): one GeoJSON source (`lineMetrics: true`) drawn by a casing and
 * a line layer in the Standard style's `middle` slot (under labels and 3D buildings), coloured
 * from `glassPalette[theme].route / routeCasing`, plus a destination pin (DOM marker).
 *
 *   - Draw-in: when a route first appears (or after a reroute) `line-trim-offset` hides the
 *     tail [t, 1] and t animates 0 → 1, so the line grows from the car to the destination.
 *   - Progress: the travelled part [0, fraction] is trimmed away as you drive (fraction is
 *     measured in Web-Mercator length, the same metric as Mapbox's `line-progress`).
 *   - Cancel: the layers fade out, then the source, layers and marker are removed.
 *
 * Everything is applied through `whenMapReady`, so it is safe to call before the map exists
 * and without a token (then nothing is drawn) — and after it has loaded, when the ready
 * callback runs synchronously inside `createRouteLayer` (so it subscribes last). No React
 * here; the nav engine drives it.
 */
import mapboxgl from 'mapbox-gl';
import type { GeoJSONSource, Map as MapboxMap, Marker } from 'mapbox-gl';
import { animate } from 'motion/react';
import { glassPalette, motionTokens } from '../../theme';
import type { LngLat, ResolvedTheme } from '../../types';
import { whenMapReady } from '../map';

export const ROUTE_SOURCE_ID = 'dash-nav-route';
export const ROUTE_CASING_LAYER_ID = 'dash-nav-route-casing';
export const ROUTE_LINE_LAYER_ID = 'dash-nav-route-line';
/** Duration of the draw-in, s. */
export const ROUTE_DRAW_IN_S = 1.1;
/** Fade-out before removal on cancel/arrival, ms. */
export const ROUTE_FADE_OUT_MS = 350;

/** Line widths by zoom, px. The casing is 3 px wider on each side. */
const LINE_WIDTH = ['interpolate', ['exponential', 1.5], ['zoom'], 10, 4, 13, 7, 16, 13, 19, 28] as const;
const CASING_WIDTH = ['interpolate', ['exponential', 1.5], ['zoom'], 10, 7, 13, 11, 16, 19, 19, 36] as const;

/** GeoJSON accepted by the source (typed via mapbox-gl; `@types/geojson` is not a dependency). */
type SourceData = Parameters<GeoJSONSource['setData']>[0];
const EMPTY = { type: 'FeatureCollection', features: [] } as unknown as SourceData;

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** The destination pin element: Mapbox positions the root, the inner element animates. */
function pinElement(): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement('div');
  root.setAttribute('aria-hidden', 'true');
  root.style.pointerEvents = 'none';
  const body = document.createElement('div');
  body.style.cssText = 'width:34px;height:44px;transform-origin:50% 100%;filter:drop-shadow(0 4px 6px rgba(0,20,50,.35));';
  body.innerHTML = `
<svg viewBox="0 0 34 44" width="34" height="44" focusable="false">
  <defs>
    <linearGradient id="dash-dest-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color: var(--chakra-colors-accent-alt, #20c4d4)" />
      <stop offset="1" style="stop-color: var(--chakra-colors-accent-solid, #0a84ff)" />
    </linearGradient>
  </defs>
  <path d="M17 42c-1-6-14-14-14-25a14 14 0 0 1 28 0c0 11-13 19-14 25z" fill="url(#dash-dest-fill)" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>
  <circle cx="17" cy="17" r="5.2" fill="#fff"/>
</svg>`;
  root.appendChild(body);
  return { root, body };
}

export interface RouteLayer {
  /** Show `line` (or remove the route with `null`). `drawIn` animates it growing from the start. */
  setRoute(line: readonly LngLat[] | null, options?: { drawIn?: boolean }): void;
  /** Travelled fraction [0, 1] (Web-Mercator length) — trimmed from the start of the line. */
  setProgress(fraction: number): void;
  setTheme(theme: ResolvedTheme): void;
  /** Destination pin (`null` removes it, with a little lift-and-fade). */
  setDestination(point: LngLat | null): void;
  /** Remove everything immediately and stop listening. */
  destroy(): void;
}

export function createRouteLayer(initialTheme: ResolvedTheme): RouteLayer {
  let map: MapboxMap | null = null;
  let theme = initialTheme;
  let line: LngLat[] | null = null;
  let fraction = 0;
  /** Draw-in position: the tail [drawT, 1] is hidden while < 1. */
  let drawT = 1;
  let drawAnim: { stop(): void } | null = null;
  let removeTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingDrawIn = false;
  let destination: LngLat | null = null;
  let marker: Marker | null = null;
  let destroyed = false;

  const hasLayers = (m: MapboxMap) => Boolean(m.getSource(ROUTE_SOURCE_ID));

  function ensureLayers(m: MapboxMap): void {
    if (hasLayers(m)) return;
    const colors = glassPalette[theme];
    m.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY, lineMetrics: true });
    m.addLayer({
      id: ROUTE_CASING_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      slot: 'middle',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': colors.routeCasing,
        'line-width': CASING_WIDTH as unknown as number,
        'line-emissive-strength': 1,
        'line-opacity': 0,
        'line-opacity-transition': { duration: ROUTE_FADE_OUT_MS, delay: 0 },
        'line-trim-offset': [0, 0],
      },
    });
    m.addLayer({
      id: ROUTE_LINE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      slot: 'middle',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': colors.route,
        'line-width': LINE_WIDTH as unknown as number,
        'line-emissive-strength': 1,
        'line-opacity': 0,
        'line-opacity-transition': { duration: ROUTE_FADE_OUT_MS, delay: 0 },
        'line-trim-offset': [0, 0],
      },
    });
  }

  function removeLayers(m: MapboxMap): void {
    if (m.getLayer(ROUTE_LINE_LAYER_ID)) m.removeLayer(ROUTE_LINE_LAYER_ID);
    if (m.getLayer(ROUTE_CASING_LAYER_ID)) m.removeLayer(ROUTE_CASING_LAYER_ID);
    if (m.getSource(ROUTE_SOURCE_ID)) m.removeSource(ROUTE_SOURCE_ID);
  }

  function setTrim(start: number, end: number): void {
    if (!map || !hasLayers(map)) return;
    const s = clamp01(start);
    const e = Math.max(s, clamp01(end));
    map.setPaintProperty(ROUTE_CASING_LAYER_ID, 'line-trim-offset', [s, e]);
    map.setPaintProperty(ROUTE_LINE_LAYER_ID, 'line-trim-offset', [s, e]);
  }

  /** Current trim: the hidden tail during a draw-in, else the travelled head. */
  function applyTrim(): void {
    if (drawT < 1) setTrim(drawT, 1);
    else setTrim(0, fraction);
  }

  function setOpacity(value: number): void {
    if (!map || !hasLayers(map)) return;
    map.setPaintProperty(ROUTE_CASING_LAYER_ID, 'line-opacity', value);
    map.setPaintProperty(ROUTE_LINE_LAYER_ID, 'line-opacity', value);
  }

  function stopDraw(): void {
    drawAnim?.stop();
    drawAnim = null;
  }

  function applyRoute(drawIn: boolean): void {
    pendingDrawIn = false;
    const m = map;
    if (!m) {
      pendingDrawIn = drawIn;
      return;
    }
    if (removeTimer !== null) {
      clearTimeout(removeTimer);
      removeTimer = null;
    }
    if (!line) {
      stopDraw();
      if (!hasLayers(m)) return;
      setOpacity(0);
      removeTimer = setTimeout(() => {
        removeTimer = null;
        if (!line && map) removeLayers(map);
      }, ROUTE_FADE_OUT_MS + 50);
      return;
    }
    ensureLayers(m);
    (m.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined)?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: line.map((p) => [p[0], p[1]]) },
    } as unknown as SourceData);
    setOpacity(1);
    stopDraw();
    if (drawIn && !prefersReducedMotion()) {
      drawT = 0;
      applyTrim();
      drawAnim = animate(0, 1, {
        duration: ROUTE_DRAW_IN_S,
        ease: motionTokens.easeOut,
        onUpdate: (t) => {
          drawT = t;
          applyTrim();
        },
        onComplete: () => {
          drawT = 1;
          drawAnim = null;
          applyTrim();
        },
      });
    } else {
      drawT = 1;
      applyTrim();
    }
  }

  function applyDestination(): void {
    const m = map;
    if (!m) return;
    if (destination) {
      if (!marker) {
        const { root, body } = pinElement();
        marker = new mapboxgl.Marker({ element: root, anchor: 'bottom' }).setLngLat(destination).addTo(m);
        if (!prefersReducedMotion()) {
          body.animate(
            [
              { transform: 'translateY(-36px) scale(0.6)', opacity: 0 },
              { transform: 'translateY(0) scale(1)', opacity: 1 },
            ],
            { duration: 650, easing: `cubic-bezier(${motionTokens.easeSpring.join(',')})`, fill: 'both' },
          );
        }
      } else {
        marker.setLngLat(destination);
      }
      return;
    }
    if (!marker) return;
    const leaving = marker;
    marker = null;
    const body = leaving.getElement().firstElementChild as HTMLElement | null;
    if (body && !prefersReducedMotion()) {
      const anim = body.animate(
        [
          { transform: 'translateY(0) scale(1)', opacity: 1 },
          { transform: 'translateY(-14px) scale(0.8)', opacity: 0 },
        ],
        { duration: 300, easing: 'ease-in', fill: 'forwards' },
      );
      anim.onfinish = () => leaving.remove();
    } else {
      leaving.remove();
    }
  }

  // Subscribe LAST: when the map has already loaded, `whenMapReady` runs the callback right
  // here, synchronously — everything it touches must be initialised by now.
  const unsubscribe = whenMapReady((m) => {
    if (destroyed) return;
    map = m;
    applyRoute(pendingDrawIn);
    applyDestination();
  });

  return {
    setRoute(next, options = {}) {
      line = next ? next.map((p) => [p[0], p[1]] as LngLat) : null;
      if (!next) fraction = 0;
      applyRoute(options.drawIn === true);
    },
    setProgress(next) {
      fraction = clamp01(next);
      if (drawT >= 1) applyTrim();
    },
    setTheme(next) {
      theme = next;
      const m = map;
      if (!m || !hasLayers(m)) return;
      m.setPaintProperty(ROUTE_CASING_LAYER_ID, 'line-color', glassPalette[theme].routeCasing);
      m.setPaintProperty(ROUTE_LINE_LAYER_ID, 'line-color', glassPalette[theme].route);
    },
    setDestination(next) {
      destination = next ? [next[0], next[1]] : null;
      applyDestination();
    },
    destroy() {
      destroyed = true;
      unsubscribe();
      stopDraw();
      if (removeTimer !== null) clearTimeout(removeTimer);
      marker?.remove();
      marker = null;
      if (map) {
        try {
          removeLayers(map);
        } catch {
          // The map may already be gone (HMR).
        }
      }
      map = null;
    },
  };
}
