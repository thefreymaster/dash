/**
 * Theme controller: keeps `ui.resolvedTheme` in line with `settings.themeMode`.
 *   `day` / `night` → that theme, immediately (works on the Start gate, before any sensor).
 *   `auto`          → day/night from the sun at the latest fix; re-evaluated every minute,
 *                     when the mode changes and when the first fix of a source arrives.
 *                     Before any fix the current theme is kept.
 * `main.tsx` applies whatever ends up in `ui.resolvedTheme`.
 */
import { resolveTheme } from '../lib';
import { settings, telemetry, ui } from '../state';
import type { ResolvedTheme, ThemeMode } from '../types';
import { browserTimers, type Timers } from './env';

/** Re-check the sun this often in `auto` mode, ms. */
export const THEME_RECHECK_MS = 60_000;

/** Pure: the theme for a mode, a position (or `null` before any fix) and an instant. */
export function computeTheme(
  mode: ThemeMode,
  position: { lat: number; lng: number } | null,
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

export interface ThemeControllerDeps {
  /** Wall clock, epoch ms. Defaults to `Date.now`. */
  now?: () => number;
  timers?: Timers;
}

interface Controller {
  timers: Timers;
  timer: unknown;
  unsubscribe: () => void;
}

let controller: Controller | null = null;

function evaluate(now: () => number): void {
  const fix = telemetry.get().fix;
  const current = ui.get().resolvedTheme;
  const next = computeTheme(settings.get().themeMode, fix, new Date(now()), current);
  if (next !== current) ui.set((prev) => ({ ...prev, resolvedTheme: next }));
}

/** Start keeping `ui.resolvedTheme` up to date (evaluates immediately). Idempotent. */
export function startThemeController(deps: ThemeControllerDeps = {}): void {
  if (controller) return;
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? browserTimers;
  let lastMode = settings.get().themeMode;
  let hadFix = telemetry.get().fix !== null;

  const offSettings = settings.subscribe((s) => {
    if (s.themeMode === lastMode) return;
    lastMode = s.themeMode;
    evaluate(now);
  });
  const offTelemetry = telemetry.subscribe((t) => {
    const hasFix = t.fix !== null;
    if (hasFix && !hadFix) evaluate(now);
    hadFix = hasFix;
  });
  controller = {
    timers,
    timer: timers.setInterval(() => evaluate(now), THEME_RECHECK_MS),
    unsubscribe: () => {
      offSettings();
      offTelemetry();
    },
  };
  evaluate(now);
}

/** Stop the controller. Idempotent. */
export function stopThemeController(): void {
  const c = controller;
  if (!c) return;
  controller = null;
  c.unsubscribe();
  c.timers.clearInterval(c.timer);
}
