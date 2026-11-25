/**
 * Shared domain types for Dash. This is the contract every feature builds on:
 * keep it small, keep units in field names (`…Mps`, `…Deg`, `…M`, `…Ms`) or comments.
 *
 * Conventions
 *   - Speeds are metres per second (`Mps`). Convert for display with `lib/units`.
 *   - Angles are degrees, clockwise from true north, normalised to [0, 360).
 *   - Distances are metres (`M`), durations milliseconds (`Ms`).
 *   - Timestamps are Unix epoch milliseconds (`Date.now()` scale).
 *   - Points are `{ lat, lng }` objects in domain types; lines/geometry use
 *     GeoJSON-order tuples `[lng, lat]` (see `LngLat`).
 */

/** Display unit system for speed and distance. */
export type Units = 'mph' | 'kmh';

/** User's theme preference. `auto` follows the sun at the current position. */
export type ThemeMode = 'auto' | 'day' | 'night';

/** The theme actually applied to the UI and map. */
export type ResolvedTheme = 'day' | 'night';

/** Mapbox Standard style `lightPreset` values. */
export type LightPreset = 'dawn' | 'day' | 'dusk' | 'night';

/**
 * Lifecycle of the location source.
 * - `idle`: not started (before the user taps Start on the gate).
 * - `requesting`: permission prompt shown / waiting for the first fix.
 * - `tracking`: fixes arriving normally.
 * - `stale`: had fixes, but none recently (tunnel, parking garage).
 * - `denied`: the user refused location permission.
 * - `unavailable`: no geolocation support or a hard position error.
 */
export type GpsStatus = 'idle' | 'requesting' | 'tracking' | 'stale' | 'denied' | 'unavailable';

/** `[longitude, latitude]` in degrees — GeoJSON coordinate order. */
export type LngLat = [lng: number, lat: number];

/** One raw position sample, as delivered by the GPS (or the simulator). */
export interface Fix {
  /** Latitude, degrees (WGS84). */
  lat: number;
  /** Longitude, degrees (WGS84). */
  lng: number;
  /** Ground speed reported by the device, m/s. `null` when the device gives none. */
  speedMps: number | null;
  /** Course over ground reported by the device, degrees [0, 360). `null` when stationary/unknown. */
  headingDeg: number | null;
  /** Horizontal accuracy radius (≈68% confidence), metres. */
  accuracyM: number;
  /** Time the fix was taken, epoch ms. */
  timestamp: number;
}

/**
 * Low-rate (≈1 Hz) sensor summary in the query cache. Good for React UI that changes
 * at human speed (status icon, numbers that are fine at 1 Hz).
 * Per-frame values (smoothed position/heading for the camera and speedo) live in
 * `state/pose.ts` as Motion values instead.
 */
export interface Telemetry {
  /** Location source lifecycle. */
  status: GpsStatus;
  /** Where fixes come from: the real device GPS or the demo simulator. */
  source: 'gps' | 'sim';
  /** Latest accepted fix, or `null` before the first one. */
  fix: Fix | null;
  /** Best current ground-speed estimate, m/s (device speed, or derived from successive fixes). 0 when unknown — check `speedKnown` before trusting it. */
  speedMps: number;
  /**
   * `false` when the current speed cannot be trusted: no usable speed from the device or from
   * positions, or the fix is stale (status not `tracking`, or the latest fix older than ~3 s).
   * When `false`, `speedMps` is a placeholder and must not be shown or used as a real speed.
   */
  speedKnown: boolean;
  /** Best current course over ground, degrees [0, 360). `null` when stationary/unknown. */
  headingDeg: number | null;
  /**
   * Device compass heading corrected for landscape orientation, degrees [0, 360), MAGNETIC
   * north. A low-rate snapshot (≤ 1 update/s, only on a ≥ 5° change) — the motion loop reads
   * the live value from the compass module instead. `null` without permission/sensor.
   */
  compassDeg: number | null;
}

/** User preferences (persisted). */
export interface Settings {
  /** Speed and distance units. Default `mph`. */
  units: Units;
  /** Theme preference. Default `auto`. */
  themeMode: ThemeMode;
  /** Drive with the simulator instead of the GPS. Default `false`. */
  demo: boolean;
}

/** Trip computer accumulators (persisted, survive reloads). Average speed = distanceM / (movingMs / 1000). */
export interface Trip {
  /** When the trip was started or last reset, epoch ms. `null` before the first movement. */
  startedAt: number | null;
  /** Distance travelled, metres. */
  distanceM: number;
  /** Time spent moving (auto-paused while stopped), ms. */
  movingMs: number;
  /** Highest speed seen, m/s. */
  maxSpeedMps: number;
  /**
   * Time of the last recorded movement, epoch ms. `null` before the first movement. Lets the
   * trip start fresh after a long stop even if the app was closed the whole time.
   */
  lastMovedAt?: number | null;
}

/** A searchable/selectable destination. */
export interface Place {
  /** Stable id from the geocoder (used for de-duplication in recents). */
  id: string;
  /** Primary label, e.g. "Blue Bottle Coffee". */
  name: string;
  /** Secondary label / full address, if known. */
  address?: string;
  /** Latitude, degrees. */
  lat: number;
  /** Longitude, degrees. */
  lng: number;
}

/** Navigation intent. The route itself is server state (a query keyed on this). */
export interface NavState {
  /** Where we are going, or `null` when not navigating. */
  destination: Place | null;
  /** Increment to force a fresh route request (e.g. after going off-route). Part of the route query key. */
  rerouteNonce: number;
}

/**
 * Top-level screen.
 * - `gate`: start screen; a user tap is needed to request sensor permissions and wake lock.
 * - `boot`: short intro animation while the first fix arrives.
 * - `cluster`: the running instrument cluster.
 */
export type Phase = 'gate' | 'boot' | 'cluster';

/** Cross-feature UI state (not persisted). */
export interface UiState {
  /** Current top-level screen. */
  phase: Phase;
  /** Map camera follows the puck. Set `false` when the user pans; the recenter button sets it back. */
  following: boolean;
  /** Theme currently applied (derived from `Settings.themeMode` and the sun). Setting it applies it: `main.tsx` calls `applyTheme` on change. */
  resolvedTheme: ResolvedTheme;
}
