/**
 * Theme controller: keeps `ui.resolvedTheme` in line with `settings.themeMode`.
 *   `day` / `night` → that theme, immediately (works on the Start gate, before any sensor).
 *   `auto`          → day/night from the sun at the latest fix; re-evaluated every minute,
 *                     when the mode changes and when the first fix of a source arrives.
 *                     Before any fix (Start gate, boot, location denied) the sun is taken
 *                     at the SAME fallback position the map uses for its light preset: the
 *                     remembered last position, else the time-zone guess
 *                     (`features/map/resting.ts`) — so the glass UI and the map agree.
 * `main.tsx` applies whatever ends up in `ui.resolvedTheme`.
 */
import { loadLastPosition, restingView } from '../features/map/resting';
import { resolveTheme } from '../lib';
import { settings, telemetry, ui } from '../state';
import type { ResolvedTheme, ThemeMode } from '../types';
import { browserTimers, type Timers } from './env';

/** Re-check the sun this often in `auto` mode, ms. */
export const THEME_RECHECK_MS = 60_000;

type Position = { lat: number; lng: number };

/** Pure: the theme for a mode, a position (or `null` when none is known) and an instant. */
export function computeTheme(
  mode: ThemeMode,
  position: Position | null,
  now: Date,
  current: ResolvedTheme,
): ResolvedTheme {
  if (mode === 'day' || mode === 'night') return mode;
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return current;
  try {
    return resolveTheme(position.lat, position.lng, now);
  } catch {
    return current;
  }
}

/**
 * Where the map rests (and takes its sun position) before the first pose: the remembered last
 * position, else the time-zone meridian guess. Same helpers as `mapInstance.ts`.
 */
export function mapFallbackPosition(nowMs: number): Position {
  const view = restingView(loadLastPosition(), new Date(nowMs).getTimezoneOffset());
  return { lat: view.lat, lng: view.lng };
}

export interface ThemeControllerDeps {
  /** Wall clock, epoch ms. Defaults to `Date.now`. */
  now?: () => number;
  timers?: Timers;
  /** Position used before any fix. Defaults to the map's resting position (`mapFallbackPosition`). */
  fallbackPosition?: (nowMs: number) => Position | null;
}

interface Controller {
  timers: Timers;
  timer: unknown;
  unsubscribe: () => void;
}

let controller: Controller | null = null;

function evaluate(now: () => number, fallback: (nowMs: number) => Position | null): void {
  const at = now();
  const position = telemetry.get().fix ?? safeFallback(fallback, at);
  const current = ui.get().resolvedTheme;
  const next = computeTheme(settings.get().themeMode, position, new Date(at), current);
  if (next !== current) ui.set((prev) => ({ ...prev, resolvedTheme: next }));
}

function safeFallback(fallback: (nowMs: number) => Position | null, nowMs: number): Position | null {
  try {
    return fallback(nowMs);
  } catch {
    return null;
  }
}

/** Start keeping `ui.resolvedTheme` up to date (evaluates immediately). Idempotent. */
export function startThemeController(deps: ThemeControllerDeps = {}): void {
  if (controller) return;
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? browserTimers;
  const fallback = deps.fallbackPosition ?? mapFallbackPosition;
  const run = () => evaluate(now, fallback);
  let lastMode = settings.get().themeMode;
  let hadFix = telemetry.get().fix !== null;

  const offSettings = settings.subscribe((s) => {
    if (s.themeMode === lastMode) return;
    lastMode = s.themeMode;
    run();
  });
  const offTelemetry = telemetry.subscribe((t) => {
    const hasFix = t.fix !== null;
    if (hasFix && !hadFix) run();
    hadFix = hasFix;
  });
  controller = {
    timers,
    timer: timers.setInterval(run, THEME_RECHECK_MS),
    unsubscribe: () => {
      offSettings();
      offTelemetry();
    },
  };
  run();
}

/** Stop the controller. Idempotent. */
export function stopThemeController(): void {
  const c = controller;
  if (!c) return;
  controller = null;
  c.unsubscribe();
  c.timers.clearInterval(c.timer);
}
