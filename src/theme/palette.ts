/**
 * Raw Glass design values, transcribed from the approved mockup
 * (`mockups/glass.html`, `:root` = day and `[data-theme="night"]` = night).
 *
 * This file is the single source of truth for colours. It exists separately from the
 * Chakra system because some consumers cannot read CSS variables:
 *   - Mapbox GL paint properties (route line, puck halo) are drawn on a canvas and need
 *     literal colour strings: `glassPalette[resolvedTheme].route`.
 *   - Motion animations want numeric easings/durations: `motionTokens`.
 * Everything that renders through Chakra should use the semantic tokens built from this
 * table in `system.ts` (e.g. `bg="glass.fill"`), which switch day/night automatically.
 *
 * Intentionally omitted from the mockup: the speed-limit sign and every "over limit"
 * value (feature was cut), the fake SVG map colours (the real map is Mapbox Standard)
 * and the on-screen keyboard placeholder.
 */
import type { ResolvedTheme } from '../types';

export interface GlassPalette {
  /** Translucent fill of a normal glass surface (pills, strips). */
  glassFill: string;
  /** Denser fill for large or text-heavy surfaces (speed cluster, sheets, banners). */
  glassFillStrong: string;
  /** 1px border of glass surfaces (mockup `--glass-stroke`). */
  glassBorder: string;
  /** Hairline outer edge drawn as a 0.5px ring outside the border. */
  glassEdge: string;
  /** Inset 1px top highlight. */
  glassHighlight: string;
  /** Top-to-transparent sheen gradient colour. */
  glassSheen: string;
  /** Radial "lens" glow behind the speed digits. */
  glassLens: string;
  /** Fill of controls sitting on glass (icon buttons, stat tiles, chips). */
  glassControl: string;
  /** Hover/pressed fill of those controls; also used for 1px dividers on glass. */
  glassControlHover: string;
  /** Drop shadow of glass surfaces (CSS box-shadow list, no inset parts). */
  glassShadow: string;

  /** Main text/icon colour (mockup `--ink-1`). */
  textPrimary: string;
  /** Secondary labels, units (mockup `--ink-2`). */
  textSecondary: string;
  /** Tertiary hints, minor ticks, separators (mockup `--ink-3`). */
  textTertiary: string;

  /** Accent colour (mockup `--accent`). */
  accent: string;
  /** Second stop of the accent gradient (mockup `--accent-2`, a cyan). */
  accentAlt: string;
  /** Text/icon colour on a solid accent fill (mockup `--accent-ink`). */
  accentContrast: string;
  /** Low-alpha accent tint for chips and halos (mockup `--accent-soft`). */
  accentSoft: string;

  /** Warning / destructive colour (mockup `--warn`): end route, reset trip, GPS lost. */
  warning: string;
  /** Second stop of the warning gradient (mockup `--warn-2`). */
  warningAlt: string;
  /** Low-alpha warning tint (mockup `--warn-soft`). */
  warningSoft: string;

  /** Unfilled gauge track (mockup `--track`). */
  track: string;

  /** Map legibility scrim at the top edge, behind the top strip. */
  scrimEdge: string;
  /** Map legibility scrim, soft pool behind the speed cluster. */
  scrimSoft: string;
  /** Fully transparent version of the scrim hue (avoids grey fringes in gradients). */
  scrimClear: string;
  /** Full-screen frosted overlay fill (start gate, rotate prompt). */
  overlay: string;

  /** Route line colour for the Mapbox route layer. */
  route: string;
  /** Route line casing colour for the Mapbox route layer. */
  routeCasing: string;
  /** Plain land colour shown behind the map canvas before tiles load. */
  mapLand: string;
}

export const glassPalette: Record<ResolvedTheme, GlassPalette> = {
  day: {
    glassFill: 'rgba(250, 251, 253, 0.60)',
    glassFillStrong: 'rgba(250, 251, 253, 0.78)',
    glassBorder: 'rgba(255, 255, 255, 0.80)',
    glassEdge: 'rgba(20, 30, 50, 0.10)',
    glassHighlight: 'rgba(255, 255, 255, 0.95)',
    glassSheen: 'rgba(255, 255, 255, 0.55)',
    glassLens: 'rgba(255, 255, 255, 0.70)',
    glassControl: 'rgba(20, 30, 50, 0.06)',
    glassControlHover: 'rgba(20, 30, 50, 0.10)',
    glassShadow: '0 12px 32px rgba(20, 40, 80, 0.16), 0 2px 6px rgba(20, 40, 80, 0.08)',

    textPrimary: '#0a1220',
    textSecondary: 'rgba(10, 18, 32, 0.64)',
    textTertiary: 'rgba(10, 18, 32, 0.40)',

    accent: '#0a84ff',
    accentAlt: '#20c4d4',
    accentContrast: '#ffffff',
    accentSoft: 'rgba(10, 132, 255, 0.13)',

    warning: '#d92318',
    warningAlt: '#ff7a2f',
    warningSoft: 'rgba(217, 35, 24, 0.16)',

    track: 'rgba(10, 18, 32, 0.09)',

    scrimEdge: 'rgba(222, 232, 242, 0.88)',
    scrimSoft: 'rgba(240, 242, 238, 0.55)',
    scrimClear: 'rgba(226, 234, 240, 0)',
    overlay: 'rgba(240, 243, 248, 0.42)',

    route: '#0a84ff',
    routeCasing: '#ffffff',
    mapLand: '#e8eae5',
  },
  night: {
    glassFill: 'rgba(14, 18, 26, 0.58)',
    glassFillStrong: 'rgba(14, 18, 26, 0.74)',
    glassBorder: 'rgba(255, 255, 255, 0.13)',
    glassEdge: 'rgba(0, 0, 0, 0.45)',
    glassHighlight: 'rgba(255, 255, 255, 0.12)',
    glassSheen: 'rgba(255, 255, 255, 0.06)',
    glassLens: 'rgba(4, 6, 10, 0.45)',
    glassControl: 'rgba(255, 255, 255, 0.08)',
    glassControlHover: 'rgba(255, 255, 255, 0.14)',
    glassShadow: '0 12px 32px rgba(0, 0, 0, 0.50), 0 2px 6px rgba(0, 0, 0, 0.30)',

    textPrimary: '#f3f6fb',
    textSecondary: 'rgba(232, 238, 248, 0.68)',
    textTertiary: 'rgba(232, 238, 248, 0.40)',

    accent: '#4db2ff',
    accentAlt: '#5ce1e6',
    accentContrast: '#04121f',
    accentSoft: 'rgba(77, 178, 255, 0.18)',

    warning: '#ff6257',
    warningAlt: '#ffa05a',
    warningSoft: 'rgba(255, 98, 87, 0.22)',

    track: 'rgba(255, 255, 255, 0.11)',

    scrimEdge: 'rgba(9, 12, 20, 0.90)',
    scrimSoft: 'rgba(8, 11, 18, 0.55)',
    scrimClear: 'rgba(10, 14, 22, 0)',
    overlay: 'rgba(8, 10, 16, 0.46)',

    route: '#4db2ff',
    routeCasing: '#0a2340',
    mapLand: '#111621',
  },
};

/** Font stacks. System fonts only — no web fonts are loaded. */
export const fontStacks = {
  /** UI text: San Francisco Text on iOS. */
  ui: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif',
  /** Numerals and display text: SF Pro Rounded via `ui-rounded`. Pair with tabular-nums. */
  display:
    'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
} as const;

/**
 * Motion timings from the mockup, in the units Motion (`motion/react`) expects:
 * cubic-bezier control points as tuples and durations in seconds.
 * The same values exist as Chakra tokens (`easings.glassOut`, `durations.theme`, …) for CSS.
 */
export const motionTokens = {
  /** Default deceleration curve for entrances and moves. */
  easeOut: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
  /** Slight overshoot, for pops and needle-like settles. */
  easeSpring: [0.3, 1.35, 0.4, 1] as [number, number, number, number],
  /** Seconds. Small UI feedback (press, hover). */
  durationFast: 0.22,
  /** Seconds. Standard widget show/hide. */
  duration: 0.5,
  /** Seconds. Day/night cross-fade of colours. */
  durationTheme: 0.9,
  /** Seconds. Fade of a value that changes in place (clock digit, temperature, road name, ETA). */
  durationSwap: 0.45,
  /** Seconds. The small slide that goes with that fade (mockup `.road-name` / `.man-swap`). */
  durationSwapMove: 0.55,
  /** Seconds. A widget leaving (exit fades are quicker than entrances). */
  durationExit: 0.35,
} as const;

/**
 * Motion `transition` for a value that changes in place: the old value slides/fades out while
 * the new one slides/fades in (`initial`/`exit` with a small `x`/`y` offset). One timing for
 * every feature, from the mockup's road-name and maneuver swaps; also used for the `layout`
 * glide of whatever moves aside.
 */
export const swapTransition = {
  default: { duration: motionTokens.durationSwapMove, ease: motionTokens.easeOut },
  opacity: { duration: motionTokens.durationSwap, ease: motionTokens.easeOut },
} as const;
