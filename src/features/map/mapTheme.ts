/**
 * Day/night for the map (T15): drives the Mapbox Standard style's `lightPreset` config
 * property on the `basemap` import.
 *
 *   settings.themeMode = 'day' | 'night' → that preset
 *   settings.themeMode = 'auto'          → `lightPreset(lat, lng, now)` from `lib/sun`
 *                                          (dawn / day / dusk / night) at the current pose
 *
 * Re-evaluated on style load, when the setting changes, when the first pose arrives, when the
 * page becomes visible and once a minute. Only `setConfigProperty` is used — never `setStyle`
 * — so sources and layers added by other features (route line) are untouched.
 *
 * This does not touch `ui.resolvedTheme` (the UI theme); the two read the same sun maths.
 */
import type { Map as MapboxMap } from 'mapbox-gl';
import { lightPreset } from '../../lib';
import { pose, settings } from '../../state';
import type { LightPreset, ThemeMode } from '../../types';

/** Import id of the Standard style inside `mapbox://styles/mapbox/standard`. */
export const BASEMAP_IMPORT_ID = 'basemap';
/** How often `auto` re-checks the sun, ms. */
export const THEME_INTERVAL_MS = 60_000;

/** Preset for a theme preference at a place and time. Pure. */
export function resolveLightPreset(mode: ThemeMode, position: { lat: number; lng: number }, now: Date): LightPreset {
  if (mode === 'day' || mode === 'night') return mode;
  return lightPreset(position.lat, position.lng, now);
}

/**
 * Where the sun maths should look: the live pose, otherwise `fallback` (the remembered
 * position or the resting view's guess).
 */
export function themePosition(fallback: { lat: number; lng: number }): { lat: number; lng: number } {
  return pose.hasPose.get() ? { lat: pose.lat.get(), lng: pose.lng.get() } : fallback;
}

/** Preset to pass in the Map constructor's `config`, so the first frame is already right. */
export function initialLightPreset(fallback: { lat: number; lng: number }): LightPreset {
  return resolveLightPreset(settings.get().themeMode, themePosition(fallback), new Date());
}

/**
 * Keep the map's light preset in sync. Returns a detach function.
 * Does nothing on styles without a `basemap` import (e.g. the dev harness's local style).
 */
export function attachMapTheme(map: MapboxMap, fallback: { lat: number; lng: number }): () => void {
  let styleReady = false;
  let hasBasemap = false;
  let applied: LightPreset | null = null;

  const apply = () => {
    if (!styleReady || !hasBasemap) return;
    const preset = resolveLightPreset(settings.get().themeMode, themePosition(fallback), new Date());
    if (preset === applied) return;
    try {
      map.setConfigProperty(BASEMAP_IMPORT_ID, 'lightPreset', preset);
      applied = preset;
    } catch (error) {
      console.warn('[map] could not set lightPreset', error);
    }
  };

  const onStyleLoad = () => {
    styleReady = true;
    hasBasemap = (map.getStyle()?.imports ?? []).some((i) => i.id === BASEMAP_IMPORT_ID);
    // The constructor `config` already set a preset; re-read it so we only write on change.
    const current: unknown = hasBasemap ? map.getConfigProperty(BASEMAP_IMPORT_ID, 'lightPreset') : null;
    applied = typeof current === 'string' ? (current as LightPreset) : null;
    apply();
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') apply();
  };

  map.on('style.load', onStyleLoad);
  if (map.isStyleLoaded()) onStyleLoad();
  const unsubscribeSettings = settings.subscribe(apply);
  const unsubscribePose = pose.hasPose.on('change', (has) => {
    if (has) apply();
  });
  const timer = setInterval(apply, THEME_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    map.off('style.load', onStyleLoad);
    unsubscribeSettings();
    unsubscribePose();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
