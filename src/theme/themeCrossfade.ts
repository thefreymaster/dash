/**
 * Day ↔ night cross-fade for EVERY themed colour.
 *
 * The theme switches by swapping the semantic colour variables on `<html>` (`.dark`). A plain
 * custom property cannot be transitioned, so anything using a colour variable without a
 * transition of its own — most text, SVG strokes, the glass sheen and other gradients —
 * flipped instantly while the glass fills cross-faded. Registering the variables as `<color>`
 * properties (`CSS.registerProperty`, Safari 16.4+) makes them interpolable; `<html>` then
 * transitions them over `durations.theme`, and every use follows in step. Elements that have
 * their own colour transition keep it: it runs once from the old to the new value with the
 * same duration and easing, so nothing lags behind.
 */
import { motionTokens } from './palette';
import { THEME_COLOR_VARS } from './system';

/** The `transition` for `<html>`: every themed colour variable over `seconds`. Pure. */
export function themeCrossfadeTransition(
  vars: readonly { name: string }[] = THEME_COLOR_VARS,
  seconds: number = motionTokens.durationTheme,
): string {
  return vars.map((v) => `${v.name} ${seconds}s ease`).join(', ');
}

let enabled = false;

/**
 * Register the themed colour variables and, once the first frame has painted, let `<html>`
 * transition them. Call once at startup, before the first render. Without
 * `CSS.registerProperty` it does nothing and colours switch as they did before.
 */
export function enableThemeCrossfade(): void {
  if (enabled || typeof window === 'undefined' || typeof CSS === 'undefined') return;
  if (typeof CSS.registerProperty !== 'function') return;
  enabled = true;
  for (const { name, day } of THEME_COLOR_VARS) {
    try {
      CSS.registerProperty({ name, syntax: '<color>', inherits: true, initialValue: day });
    } catch {
      // Already registered (Vite HMR re-runs this module).
    }
  }
  // Not before the first paint: the token CSS is injected during the first render, and that
  // first value must not animate (a night start would otherwise fade in from day).
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.documentElement.style.transition = themeCrossfadeTransition();
    }),
  );
}
