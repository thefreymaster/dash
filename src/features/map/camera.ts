/**
 * Follow camera (T13).
 *
 * While `ui.following` is true the camera is SET every frame from the `pose` Motion values
 * (`jumpTo`, never queued `easeTo`s): heading-up, pitched, with padding that puts the vehicle
 * right of the speed cluster and below the centre (as in `mockups/glass.html`). Zoom follows
 * speed through `zoomForSpeed` and is eased by `stepZoom` so it never pumps.
 *
 * Transitions into follow mode are driven by the same per-frame loop, so they track a vehicle
 * that keeps moving while the camera animates:
 *   - first pose → `flyTo` (van Wijk path, looks right from a globe) then a short catch-up blend
 *   - recenter   → a blend from wherever the user left the camera to the LIVE follow target
 *                  (or fly + catch-up when the user wandered far away)
 *
 * Any user pan / pinch / rotate / pitch (a map event that carries an `originalEvent`) sets
 * `ui.following = false`; setting it back to true (the RecenterChip does) starts a recenter.
 *
 * Other features that move the camera themselves (route overview, …) must set
 * `ui.following = false` FIRST — while following, this module overwrites the camera every frame.
 *
 * The top half of this file is pure maths (unit tested in `camera.test.ts`); the controller
 * only has a type-level dependency on mapbox-gl.
 */
import type { Map as MapboxMap, PaddingOptions } from 'mapbox-gl';
import { angleDiffDeg, damp, haversineM, lambdaFromHalfLife, lerpAngleDeg, normalizeDeg } from '../../lib';
import { ui } from '../../state';

// ---------------------------------------------------------------------------
// Tunables — adjust after a real drive.
// ---------------------------------------------------------------------------

/** Camera pitch while following, degrees (mockup `--map-pitch: 57deg`). */
export const FOLLOW_PITCH_DEG = 57;

/**
 * Where the vehicle sits on screen while following, as fractions of the map's width/height.
 * Mockup: puck at (520, 262) on an 852×393 screen → right of the speed cluster, below centre.
 */
export const FOLLOW_ANCHOR = { x: 520 / 852, y: 262 / 393 } as const;

/**
 * The vehicle is never placed left of this x (px), so it cannot slide under the speed cluster
 * (which occupies roughly the left 300 px) on narrow phones. Capped at 70 % of the width.
 */
export const FOLLOW_MIN_X_PX = 360;

/** Zoom at walking pace / in town (≤ `SPEED_SLOW_MPS`). */
export const ZOOM_SLOW = 16.6;
/** Zoom at highway speed (≥ `SPEED_FAST_MPS`). */
export const ZOOM_FAST = 15.0;
/** Speed below which the camera stays at `ZOOM_SLOW`, m/s (≈ 11 mph / 18 km/h). */
export const SPEED_SLOW_MPS = 5;
/** Speed above which the camera stays at `ZOOM_FAST`, m/s (≈ 69 mph / 112 km/h). */
export const SPEED_FAST_MPS = 31;

/**
 * The zoom is chosen from a HELD speed: it rises with the speed immediately but decays back
 * towards it with this half-life, seconds. Stop-and-go traffic therefore keeps the wider view;
 * only a sustained slow-down (leaving the highway, parking) brings the camera back in.
 */
export const SPEED_HOLD_HALF_LIFE_S = 10;
/** Half-life of the zoom easing when zooming OUT (speeding up), seconds. */
export const ZOOM_OUT_HALF_LIFE_S = 1.6;
/** Half-life of the zoom easing when zooming IN (slowing down), seconds — slower, so stop-and-go traffic does not pump. */
export const ZOOM_IN_HALF_LIFE_S = 3.2;
/** Hard cap on how fast the follow zoom may change, zoom levels per second. */
export const ZOOM_MAX_RATE = 0.45;

/** Duration of the recenter blend, ms. */
export const RECENTER_MS = 900;
/** Duration of the catch-up blend after a fly-in, ms (the vehicle moved during the flight). */
export const CATCH_UP_MS = 650;
/** Duration of the first-pose fly-in from far away (e.g. the resting globe), ms. */
export const FLY_IN_FAR_MS = 3600;
/** Duration of the first-pose fly-in from nearby (e.g. the remembered last position), ms. */
export const FLY_IN_NEAR_MS = 2000;
/** Duration of a recenter that is too far to blend (user zoomed / panned far away), ms. */
export const RECENTER_FLY_MS = 2200;
/** A recenter further than this (screen px at the lower zoom) or … */
export const FAR_JUMP_PX = 2500;
/** … with a larger zoom change than this flies instead of blending. */
export const FAR_JUMP_ZOOM = 3;

// ---------------------------------------------------------------------------
// Pure maths
// ---------------------------------------------------------------------------

/** Camera state as plain numbers (degrees, zoom levels, px). */
export interface CameraState {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
  pitch: number;
  padding: Required<PaddingOptions>;
}

/** Hermite smoothstep: 0 below `edge0`, 1 above `edge1`, smooth (zero slope) at both ends. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Follow-camera zoom for a ground speed: `ZOOM_SLOW` in town, `ZOOM_FAST` on the highway,
 * a smoothstep in between (flat at both ends, so small speed changes near a limit do nothing).
 * Monotonically non-increasing. Negative / NaN / infinite speeds count as stopped.
 */
export function zoomForSpeed(mps: number): number {
  const v = Number.isFinite(mps) && mps > 0 ? mps : 0;
  return ZOOM_SLOW - (ZOOM_SLOW - ZOOM_FAST) * smoothstep(SPEED_SLOW_MPS, SPEED_FAST_MPS, v);
}

/**
 * One frame of the held speed that drives the zoom: jumps up to a higher `speedMps` at once,
 * decays down towards a lower one with `SPEED_HOLD_HALF_LIFE_S`. Non-finite inputs are
 * treated as stopped / reset.
 */
export function stepSpeedHold(heldMps: number, speedMps: number, dtSeconds: number): number {
  const v = Number.isFinite(speedMps) && speedMps > 0 ? speedMps : 0;
  if (!Number.isFinite(heldMps) || v >= heldMps) return v;
  return damp(heldMps, v, lambdaFromHalfLife(SPEED_HOLD_HALF_LIFE_S), dtSeconds);
}

/**
 * One frame of zoom easing towards `target`: exponential (frame-rate independent), faster
 * when zooming out than in, and never faster than `ZOOM_MAX_RATE` levels/second.
 * A non-finite `current` snaps to `target`.
 */
export function stepZoom(current: number, target: number, dtSeconds: number): number {
  if (!Number.isFinite(current)) return target;
  if (!(dtSeconds > 0)) return current;
  const halfLife = target < current ? ZOOM_OUT_HALF_LIFE_S : ZOOM_IN_HALF_LIFE_S;
  const eased = damp(current, target, lambdaFromHalfLife(halfLife), dtSeconds);
  const maxStep = ZOOM_MAX_RATE * dtSeconds;
  return current + Math.max(-maxStep, Math.min(maxStep, eased - current));
}

/**
 * Screen point (px from the map's top-left) where the vehicle sits while following.
 * See `FOLLOW_ANCHOR` and `FOLLOW_MIN_X_PX`.
 */
export function followPoint(width: number, height: number): { x: number; y: number } {
  const x = Math.max(width * FOLLOW_ANCHOR.x, Math.min(FOLLOW_MIN_X_PX, width * 0.7));
  return { x, y: height * FOLLOW_ANCHOR.y };
}

/**
 * Mapbox camera padding that puts the map centre (the vehicle) at `followPoint` — the centre
 * of the padded area is the camera's focal point, so this also moves the perspective
 * vanishing point under the vehicle. Integers; all zero for an unsized map.
 */
export function followPadding(width: number, height: number): Required<PaddingOptions> {
  if (!(width > 0 && height > 0)) return { top: 0, bottom: 0, left: 0, right: 0 };
  const { x, y } = followPoint(width, height);
  return {
    left: Math.round(Math.max(0, 2 * x - width)),
    right: Math.round(Math.max(0, width - 2 * x)),
    top: Math.round(Math.max(0, 2 * y - height)),
    bottom: Math.round(Math.max(0, height - 2 * y)),
  };
}

/** Same horizontal placement as `followPadding`, vertically centred (for the resting globe). */
export function restingPadding(width: number, height: number): Required<PaddingOptions> {
  const p = followPadding(width, height);
  return { ...p, top: 0, bottom: 0 };
}

/** Ground resolution at a latitude and zoom, metres per CSS pixel (Mapbox 512 px tiles). */
export function metersPerPixel(latDeg: number, zoom: number): number {
  return (40_075_016.686 * Math.cos((latDeg * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** Ease-in-out cubic on [0, 1] (camera starts and ends at rest). */
export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin((Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const lngFromX = (x: number) => normalizeLng(x * 360 - 180);
const latFromY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Camera state between `from` (t = 0) and `to` (t = 1): centre along a straight line in Web
 * Mercator (the short way across the antimeridian), bearing the short way round, zoom, pitch
 * and padding linearly. Bearing is returned in [0, 360).
 */
export function interpolateCamera(from: CameraState, to: CameraState, t: number): CameraState {
  const k = Math.min(1, Math.max(0, t));
  const dLng = angleDiffDeg(from.lng, to.lng); // shortest signed longitude difference
  return {
    lng: normalizeLng(from.lng + dLng * k),
    lat: latFromY(lerp(mercY(from.lat), mercY(to.lat), k)),
    zoom: lerp(from.zoom, to.zoom, k),
    bearing: lerpAngleDeg(from.bearing, to.bearing, k),
    pitch: lerp(from.pitch, to.pitch, k),
    padding: {
      top: lerp(from.padding.top, to.padding.top, k),
      bottom: lerp(from.padding.bottom, to.padding.bottom, k),
      left: lerp(from.padding.left, to.padding.left, k),
      right: lerp(from.padding.right, to.padding.right, k),
    },
  };
}

// Exported for tests only.
export const __mercator = { mercX, mercY, lngFromX, latFromY };

/**
 * `true` when moving the camera from `from` to `to` is too far for a straight blend
 * (more than `FAR_JUMP_PX` on screen at the lower of the two zooms, or a zoom change above
 * `FAR_JUMP_ZOOM`) — such moves use `flyTo` instead.
 */
export function isFarJump(from: Pick<CameraState, 'lng' | 'lat' | 'zoom'>, to: Pick<CameraState, 'lng' | 'lat' | 'zoom'>): boolean {
  if (Math.abs(to.zoom - from.zoom) > FAR_JUMP_ZOOM) return true;
  const metres = haversineM([from.lng, from.lat], [to.lng, to.lat]);
  return metres / metersPerPixel(to.lat, Math.min(from.zoom, to.zoom)) > FAR_JUMP_PX;
}

/** `true` when two camera states would render identically (within sub-pixel tolerances). */
export function sameCamera(a: CameraState, b: CameraState): boolean {
  return (
    Math.abs(a.lng - b.lng) < 1e-9 &&
    Math.abs(a.lat - b.lat) < 1e-9 &&
    Math.abs(a.zoom - b.zoom) < 1e-5 &&
    Math.abs(angleDiffDeg(a.bearing, b.bearing)) < 1e-4 &&
    Math.abs(a.pitch - b.pitch) < 1e-4 &&
    samePadding(a.padding, b.padding)
  );
}

export function samePadding(a: PaddingOptions, b: PaddingOptions): boolean {
  return (
    Math.abs((a.top ?? 0) - (b.top ?? 0)) < 0.01 &&
    Math.abs((a.bottom ?? 0) - (b.bottom ?? 0)) < 0.01 &&
    Math.abs((a.left ?? 0) - (b.left ?? 0)) < 0.01 &&
    Math.abs((a.right ?? 0) - (b.right ?? 0)) < 0.01
  );
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/** One frame's read of the `pose` Motion values. */
export interface PoseSnapshot {
  has: boolean;
  lat: number;
  lng: number;
  headingDeg: number;
  speedMps: number;
  accuracyM: number;
}

/** Camera before the first pose. Its padding is always `restingPadding` for the current size. */
export type RestingView = Omit<CameraState, 'padding'>;

export interface FollowCamera {
  /** Advance one frame. `now` is the rAF timestamp (ms), `dt` seconds since the last frame. */
  tick(now: number, dt: number, pose: PoseSnapshot): void;
  /** Re-read the map size (call after the map resized); updates the paddings. */
  resize(): void;
  /** Remove listeners. Does not touch `ui`. */
  destroy(): void;
}

interface Blend {
  from: CameraState;
  startMs: number | null; // set on the first frame, so a blend started between frames is not cut short
  durationMs: number;
}

const USER_GESTURE_EVENTS = ['movestart', 'dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const;

/** `true` when the OS asks for reduced motion (iOS Settings → Accessibility → Motion). */
function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** Set `ui.following` (no-op when unchanged). */
export function setFollowing(following: boolean): void {
  ui.set((prev) => (prev.following === following ? prev : { ...prev, following }));
}

/** Bring the camera back to the vehicle: sets `ui.following = true`; the camera animates itself. */
export function recenter(): void {
  setFollowing(true);
}

/**
 * Attach the follow camera to `map`. The map should already show `resting` (pass it to the
 * Map constructor with `restingPadding`); the camera returns there when asked to recenter
 * before any pose exists.
 */
export function createFollowCamera(map: MapboxMap, resting: RestingView): FollowCamera {
  const size = () => {
    const c = map.getContainer();
    return { w: c.clientWidth, h: c.clientHeight };
  };
  let following = ui.get().following;
  let padding = followPadding(size().w, size().h);
  let zoom = Number.NaN; // eased follow zoom; NaN until the first pose
  let heldSpeed = Number.NaN; // see stepSpeedHold
  let poseSeen = false;
  let blend: Blend | null = null;
  let flyId = 0;
  let flying = false;
  let pendingEntry: 'fly-in' | 'recenter' | null = null;
  let lastApplied: CameraState | null = null;

  const readCamera = (): CameraState => {
    const c = map.getCenter();
    const p = map.getPadding();
    return {
      lng: c.lng,
      lat: c.lat,
      zoom: map.getZoom(),
      bearing: normalizeDeg(map.getBearing()),
      pitch: map.getPitch(),
      padding: { top: p.top ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0, right: p.right ?? 0 },
    };
  };

  const followTarget = (p: PoseSnapshot): CameraState => ({
    lng: p.lng,
    lat: p.lat,
    zoom: Number.isFinite(zoom) ? zoom : zoomForSpeed(p.speedMps),
    bearing: normalizeDeg(p.headingDeg),
    pitch: FOLLOW_PITCH_DEG,
    padding,
  });

  const apply = (cam: CameraState) => {
    if (lastApplied && sameCamera(lastApplied, cam)) return;
    map.jumpTo({
      center: [cam.lng, cam.lat],
      zoom: cam.zoom,
      bearing: cam.bearing,
      pitch: cam.pitch,
      padding: cam.padding,
    });
    lastApplied = cam;
  };

  const startBlend = (durationMs: number) => {
    lastApplied = null;
    blend = prefersReducedMotion() ? null : { from: readCamera(), startMs: null, durationMs };
  };

  const fly = (target: CameraState, durationMs: number) => {
    blend = null;
    lastApplied = null;
    flying = true;
    const id = ++flyId;
    // `flyTo` may complete synchronously (reduced motion → jumpTo), so state is set first.
    map.flyTo(
      {
        center: [target.lng, target.lat],
        zoom: target.zoom,
        bearing: target.bearing,
        pitch: target.pitch,
        padding: target.padding,
        duration: durationMs,
      },
      { dashFlyId: id },
    );
  };

  /** Enter follow mode from wherever the camera is now. Needs a pose. */
  const enterFollow = (kind: 'fly-in' | 'recenter', p: PoseSnapshot) => {
    const target = followTarget(p);
    const from = readCamera();
    const far = isFarJump(from, target);
    if (kind === 'fly-in') fly(target, far ? FLY_IN_FAR_MS : FLY_IN_NEAR_MS);
    else if (far) fly(target, RECENTER_FLY_MS);
    else startBlend(RECENTER_MS);
  };

  // `dashFlyId` is the eventData passed to our `flyTo`; Mapbox copies it onto the end event.
  const onMoveEnd = (e: { type: string; dashFlyId?: number }) => {
    if (!flying || e.dashFlyId !== flyId) return;
    flying = false;
    // The vehicle kept moving during the flight: glide onto the live target.
    if (following && poseSeen) startBlend(CATCH_UP_MS);
  };

  const onUserGesture = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent && following) setFollowing(false);
  };

  const onResize = () => {
    const { w, h } = size();
    padding = followPadding(w, h);
    lastApplied = null; // the next tick re-applies the follow camera with the new padding
    if (following && !poseSeen) map.jumpTo({ padding: restingPadding(w, h) });
  };

  const unsubscribeUi = ui.subscribe((state) => {
    if (state.following === following) return;
    following = state.following;
    if (!following) {
      blend = null;
      pendingEntry = null;
      return;
    }
    if (poseSeen) {
      pendingEntry = 'recenter'; // handled on the next tick, with the freshest pose
      return;
    }
    // No vehicle yet: glide back to the resting view.
    const { w, h } = size();
    map.easeTo({
      center: [resting.lng, resting.lat],
      zoom: resting.zoom,
      bearing: resting.bearing,
      pitch: resting.pitch,
      padding: restingPadding(w, h),
      duration: RECENTER_MS,
    });
  });

  map.on('moveend', onMoveEnd);
  for (const type of USER_GESTURE_EVENTS) map.on(type, onUserGesture);

  return {
    tick(now, dt, p) {
      if (!p.has) {
        poseSeen = false;
        return;
      }

      // Kept up to date while not following too, so a recenter lands at the right zoom.
      heldSpeed = stepSpeedHold(heldSpeed, p.speedMps, dt);
      const zoomTarget = zoomForSpeed(heldSpeed);
      zoom = Number.isFinite(zoom) ? stepZoom(zoom, zoomTarget, dt) : zoomTarget;

      if (!poseSeen) {
        poseSeen = true;
        if (following) pendingEntry = 'fly-in';
      }
      if (pendingEntry) {
        const kind = pendingEntry;
        pendingEntry = null;
        if (following) enterFollow(kind, p);
      }
      if (!following || flying) return;

      const target = followTarget(p);
      if (blend) {
        if (blend.startMs === null) blend.startMs = now;
        const t = (now - blend.startMs) / blend.durationMs;
        if (t >= 1) {
          blend = null;
        } else {
          apply(interpolateCamera(blend.from, target, easeInOutCubic(t)));
          return;
        }
      }
      apply(target);
    },
    resize: onResize,
    destroy() {
      unsubscribeUi();
      map.off('moveend', onMoveEnd);
      for (const type of USER_GESTURE_EVENTS) map.off(type, onUserGesture);
    },
  };
}
