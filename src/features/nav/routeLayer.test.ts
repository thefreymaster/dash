import type { Map as MapboxMap } from 'mapbox-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadyRegistry } from '../map/readyRegistry';

// The map feature's real registry semantics: once resolved, `when` runs the callback
// synchronously (and logs, rather than throws, if it fails).
const registry = vi.hoisted(() => ({ current: null as null | { when: (cb: (m: MapboxMap) => void) => () => void } }));
vi.mock('../map', () => ({
  whenMapReady: (cb: (m: MapboxMap) => void) => registry.current!.when(cb),
}));
vi.mock('mapbox-gl', () => {
  class Marker {
    el: HTMLElement;
    constructor(options: { element: HTMLElement }) {
      this.el = options.element;
    }
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    getElement() {
      return this.el;
    }
    remove() {}
  }
  return { default: { Marker }, Marker };
});

import { ROUTE_LINE_LAYER_ID, ROUTE_SOURCE_ID, createRouteLayer } from './routeLayer';

/** Just enough of a loaded `mapboxgl.Map` for the route layer. */
function fakeMap() {
  const sources = new Map<string, { data: unknown; setData(d: unknown): void }>();
  const layers = new Map<string, Record<string, unknown>>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => {
      const source = { data: null as unknown, setData: (d: unknown) => (source.data = d) };
      sources.set(id, source);
    },
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string; paint: Record<string, unknown> }) => layers.set(layer.id, { ...layer.paint }),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    setPaintProperty: (id: string, name: string, value: unknown) => {
      const paint = layers.get(id);
      if (paint) paint[name] = value;
    },
  };
  return { map: map as unknown as MapboxMap, sources, layers };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRouteLayer', () => {
  it('works when the map has ALREADY loaded — the ready callback runs synchronously (regression: TDZ crash, no route line)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ready = createReadyRegistry<MapboxMap>('map');
    registry.current = ready;
    const { map, sources, layers } = fakeMap();
    ready.resolve(map); // the map loaded long before navigation started

    const layer = createRouteLayer('day');
    expect(errors).not.toHaveBeenCalled();

    layer.setRoute(
      [
        [-122.4, 37.79],
        [-122.39, 37.8],
      ],
      { drawIn: false },
    );
    expect(sources.get(ROUTE_SOURCE_ID)?.data).toMatchObject({ geometry: { type: 'LineString' } });
    expect(layers.get(ROUTE_LINE_LAYER_ID)?.['line-opacity']).toBe(1);
    layer.destroy();
    expect(sources.has(ROUTE_SOURCE_ID)).toBe(false);
  });

  it('draws a route set before the map was ready once it loads', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ready = createReadyRegistry<MapboxMap>('map');
    registry.current = ready;
    const layer = createRouteLayer('night');
    layer.setRoute(
      [
        [-122.4, 37.79],
        [-122.39, 37.8],
      ],
      { drawIn: false },
    );
    const { map, sources } = fakeMap();
    ready.resolve(map);
    expect(errors).not.toHaveBeenCalled();
    expect(sources.get(ROUTE_SOURCE_ID)?.data).toMatchObject({ geometry: { type: 'LineString' } });
    layer.destroy();
  });
});
