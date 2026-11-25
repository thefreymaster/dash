/**
 * Route overview: when a new destination's route first arrives, show the whole route
 * north-up, hold it briefly, then hand the camera back to the follow camera.
 *
 * Order matters (see `src/features/map`): `ui.following = false` is set BEFORE the camera is
 * moved — while following, the follow camera overwrites the camera every frame. Going back
 * uses `recenter()`, which animates from wherever the overview left the camera. If the user
 * touches the map during the overview, they keep control (no automatic recenter); the
 * Recenter chip is showing anyway.
 */
import { LngLatBounds } from 'mapbox-gl';
import { ui } from '../../state';
import type { LngLat } from '../../types';
import { getMap, recenter } from '../map';

/** Camera flight to the overview, ms. */
export const OVERVIEW_FLY_MS = 1400;
/** How long the overview stays before returning to following, ms. */
export const OVERVIEW_HOLD_MS = 3200;

const GESTURES = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const;

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

export interface Overview {
  /** Stop the overview. `returnToFollow`: recenter now if the overview still owns the camera. */
  cancel(returnToFollow: boolean): void;
}

const NOOP: Overview = { cancel: () => {} };

/** Fit `line` on screen, clear of the HUD (speedometer left, banner top, ETA chip bottom). */
export function showRouteOverview(line: readonly LngLat[]): Overview {
  const map = getMap();
  if (!map || line.length < 2) return NOOP;

  const bounds = new LngLatBounds(line[0], line[0]);
  for (const p of line) bounds.extend(p);

  const container = map.getContainer();
  const w = container.clientWidth;
  const h = container.clientHeight;
  // Room for the speedometer (≈ 240 px from the left inset) and the top/bottom widgets; never
  // more than the map can give (tiny screens, tests).
  const padding = {
    left: Math.min(Math.round(w * 0.42), 300),
    right: Math.min(Math.round(w * 0.08), 56),
    top: Math.min(Math.round(h * 0.3), 104),
    bottom: Math.min(Math.round(h * 0.25), 84),
  };

  // 1. Take the camera away from the follow camera FIRST.
  ui.set((s) => (s.following ? { ...s, following: false } : s));

  let userTookOver = false;
  let done = false;
  const onGesture = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent) userTookOver = true;
  };
  for (const type of GESTURES) map.on(type, onGesture);

  const duration = prefersReducedMotion() ? 0 : OVERVIEW_FLY_MS;
  try {
    map.fitBounds(bounds, { padding, bearing: 0, pitch: 0, maxZoom: 16, duration, essential: true });
  } catch {
    // Degenerate bounds / zero-size map: skip the overview.
  }

  const finish = (returnToFollow: boolean) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const type of GESTURES) map.off(type, onGesture);
    if (returnToFollow && !userTookOver && !ui.get().following) recenter();
  };
  const timer = setTimeout(() => finish(true), duration + OVERVIEW_HOLD_MS);

  return { cancel: finish };
}
