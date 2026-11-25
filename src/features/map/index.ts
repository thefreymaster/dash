/**
 * Map — public contract.
 *
 * Components take NO props. They read `pose`, `ui`, `settings`, `telemetry`
 * from `src/state` and write `ui.following`.
 *
 *   MapView        full-bleed Mapbox Standard map (one instance for the app's life), follow
 *                  camera, vehicle puck, day/night light preset; a themed placeholder when no
 *                  token is configured. Fills its positioned parent; own stacking
 *                  context at z-index 0. Attribution + logo sit bottom-left, just above the
 *                  compass strip (override with `--dash-map-attrib-left` / `--dash-map-attrib-bottom`).
 *   RecenterChip   glass pill shown while `ui.following` is false. NOT positioned — the layout
 *                  owner places it.
 *   MapNotice      compact "Map off" pill for builds without a token (nothing otherwise). NOT
 *                  positioned — the shell puts it in the bottom strip's free gap.
 *   getMap         the live `mapboxgl.Map` once its style has loaded, else null.
 *   whenMapReady   run a callback once the style has loaded (immediately if it has).
 *   recenter       same as tapping the chip: `ui.following = true`, camera animates back.
 *
 * Moving the camera from another feature (route overview, …): set `ui.following = false`
 * FIRST, otherwise the follow camera overwrites the camera on the next frame.
 */
import type { Map as MapboxMap } from 'mapbox-gl';
import { getMap as getMapInstance, whenMapReady as whenReady } from './mapInstance';

export { MapView } from './MapView';
export { RecenterChip } from './RecenterChip';
export { MapNotice } from './MapNotice';
export { recenter } from './camera';

/** The live map instance, or null before it has loaded / without a token. */
export function getMap(): MapboxMap | null {
  return getMapInstance();
}

/**
 * Run `cb` once the map style has loaded (immediately if it already has).
 * Used by later features (route line) to add sources and layers — they survive day/night
 * changes (the light preset is a style config property; the style is never reloaded).
 * Safe to call before the map exists and without a token (then it simply never fires).
 * Returns an unsubscribe function.
 */
export function whenMapReady(cb: (map: MapboxMap) => void): () => void {
  return whenReady(cb);
}
