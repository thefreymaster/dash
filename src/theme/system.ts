/**
 * Chakra UI v3 system for Dash — the "Glass" look from `mockups/glass.html`.
 *
 * DAY / NIGHT
 *   The app decides the theme, never the OS. Chakra v3's built-in `_dark` condition is
 *   the selector `.dark &, .dark .chakra-theme:not(.light) &` (see `@chakra-ui/react`
 *   preset-base), i.e. it is driven by a `dark` CLASS on an ancestor. Every semantic token
 *   below is declared as `{ base: <day>, _dark: <night> }`, so its CSS variable flips when
 *   `<html>` has `class="dark"`. Call `applyTheme('day' | 'night')` (exported here) — do not
 *   toggle the class anywhere else. No `prefers-color-scheme` media query is involved.
 *
 * TOKENS (use these names in style props; all colours switch day/night by themselves)
 *   colors   glass.{fill, fillStrong, border, edge, highlight, sheen, lens, control, controlHover}
 *            text.{primary, secondary, tertiary}
 *            accent.{solid, alt, contrast, fg, subtle, muted, emphasized, focusRing, border}
 *            warning.{solid, alt, contrast, fg, subtle, muted, emphasized, focusRing, border}
 *            track, scrim.{edge, soft, clear}, overlay, route, routeCasing, mapLand, page
 *            (`accent` / `warning` follow Chakra's palette shape, so `colorPalette="accent"` works
 *             on Chakra components such as Button.)
 *   shadows  glass            — inset highlight + hairline edge + drop shadow
 *   blurs    glass (22px), overlay (26px)
 *   gradients glass.sheen, accent, warning, scrim.top, scrim.speed
 *   radii    glass.sm 12, glass.md 18, glass.lg 26, glass.xl 40, pill
 *   fonts    body / heading (SF Text), display (SF Pro Rounded — numerals), mono
 *   spacing  edge (8px gap from safe edge), safe.top/right/bottom/left (iOS safe-area insets)
 *   durations fast .22s, normal .5s, theme .9s; easings glassOut, glassSpring
 *   layerStyles glass, glassStrong — a complete glass surface (fill, sheen, blur, border, shadow, text colour)
 *   textStyles numeric — display font with tabular figures
 */
import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';
import type { ResolvedTheme } from '../types';
import { fontStacks, glassPalette, motionTokens, type GlassPalette } from './palette';

const day = glassPalette.day;
const night = glassPalette.night;

/** Semantic token value that is `day` normally and `night` under the `.dark` class. */
const dn = (key: keyof GlassPalette) => ({ value: { base: day[key], _dark: night[key] } });

/** Box-shadow of a glass surface for one theme. */
const glassShadow = (p: GlassPalette) =>
  `inset 0 1px 0 ${p.glassHighlight}, 0 0 0 0.5px ${p.glassEdge}, ${p.glassShadow}`;

const cubic = (b: readonly number[]) => `cubic-bezier(${b.join(', ')})`;

/**
 * Day/night cross-fade of a glass surface. Its fill, border, sheen and text colours are theme
 * VARIABLES, which cross-fade on `<html>` (`themeCrossfade.ts`) — a transition of their own
 * would restart every frame and lag behind. Only the shadow token holds literal colours.
 */
const themeTransition = `box-shadow ${motionTokens.durationTheme}s`;

const glassSurface = (fill: 'glass.fill' | 'glass.fillStrong') => ({
  backgroundColor: fill,
  backgroundImage: 'glass.sheen',
  backdropFilter: 'blur(var(--chakra-blurs-glass)) saturate(180%)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'glass.border',
  boxShadow: 'glass',
  color: 'text.primary',
  transition: themeTransition,
});

/**
 * Dot paths (`glass.sheen`) and day values of the tokens in a semantic colour tree that have
 * a `_dark` variant — the ones the day/night switch changes. Pure.
 */
export function themedColorTokens(tree: object, prefix = ''): { path: string; day: string }[] {
  const out: { path: string; day: string }[] = [];
  for (const [key, node] of Object.entries(tree)) {
    if (typeof node !== 'object' || node === null) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (!('value' in node)) {
      out.push(...themedColorTokens(node, path));
      continue;
    }
    const value = (node as { value: unknown }).value;
    if (typeof value === 'object' && value !== null && '_dark' in value && 'base' in value) {
      out.push({ path, day: String((value as { base: unknown }).base) });
    }
  }
  return out;
}

/** Semantic colours. `dn(...)` entries switch day/night (see `THEME_COLOR_VARS`). */
const semanticColors = {
  page: { value: '#000000' },
  glass: {
    fill: dn('glassFill'),
    fillStrong: dn('glassFillStrong'),
    border: dn('glassBorder'),
    edge: dn('glassEdge'),
    highlight: dn('glassHighlight'),
    sheen: dn('glassSheen'),
    lens: dn('glassLens'),
    control: dn('glassControl'),
    controlHover: dn('glassControlHover'),
  },
  text: {
    primary: dn('textPrimary'),
    secondary: dn('textSecondary'),
    tertiary: dn('textTertiary'),
  },
  accent: {
    solid: dn('accent'),
    alt: dn('accentAlt'),
    contrast: dn('accentContrast'),
    fg: dn('accent'),
    subtle: dn('accentSoft'),
    muted: dn('accentSoft'),
    emphasized: dn('accentAlt'),
    focusRing: dn('accent'),
    border: dn('accent'),
  },
  warning: {
    solid: dn('warning'),
    alt: dn('warningAlt'),
    contrast: { value: '#ffffff' },
    fg: dn('warning'),
    subtle: dn('warningSoft'),
    muted: dn('warningSoft'),
    emphasized: dn('warningAlt'),
    focusRing: dn('warning'),
    border: dn('warning'),
  },
  track: dn('track'),
  scrim: {
    edge: dn('scrimEdge'),
    soft: dn('scrimSoft'),
    clear: dn('scrimClear'),
  },
  overlay: dn('overlay'),
  route: dn('route'),
  routeCasing: dn('routeCasing'),
  mapLand: dn('mapLand'),
};

const config = defineConfig({
  globalCss: {
    // Chakra's default paints <html> with its own `bg`/`fg`; Dash is black behind everything
    // and inherits the Glass ink colour. The rest of the iOS PWA reset lives in `global.css`.
    html: {
      bg: 'page',
      color: 'text.primary',
      colorPalette: 'accent',
    },
  },
  theme: {
    tokens: {
      fonts: {
        body: { value: fontStacks.ui },
        heading: { value: fontStacks.ui },
        display: { value: fontStacks.display },
        mono: { value: fontStacks.mono },
      },
      radii: {
        glass: {
          sm: { value: '12px' },
          md: { value: '18px' },
          lg: { value: '26px' },
          xl: { value: '40px' },
        },
        pill: { value: '999px' },
      },
      blurs: {
        glass: { value: '22px' },
        overlay: { value: '26px' },
      },
      spacing: {
        edge: { value: '8px' },
        safe: {
          top: { value: 'var(--sat)' },
          right: { value: 'var(--sar)' },
          bottom: { value: 'var(--sab)' },
          left: { value: 'var(--sal)' },
        },
      },
      durations: {
        fast: { value: `${motionTokens.durationFast}s` },
        normal: { value: `${motionTokens.duration}s` },
        theme: { value: `${motionTokens.durationTheme}s` },
      },
      easings: {
        glassOut: { value: cubic(motionTokens.easeOut) },
        glassSpring: { value: cubic(motionTokens.easeSpring) },
      },
      gradients: {
        glass: {
          // Soft top sheen of every glass surface (mockup `.glass::before`, folded into a background layer).
          sheen: { value: 'linear-gradient(180deg, {colors.glass.sheen}, transparent 48%)' },
        },
        accent: { value: 'linear-gradient(160deg, {colors.accent.alt}, {colors.accent.solid})' },
        warning: { value: 'linear-gradient(160deg, {colors.warning.alt}, {colors.warning.solid})' },
        scrim: {
          // Map legibility fade from the top edge (behind the top strip).
          top: {
            value: 'linear-gradient(180deg, {colors.scrim.edge} 0, {colors.scrim.edge} 40%, {colors.scrim.clear} 100%)',
          },
          // Soft pool behind the speed cluster; size/position it with the element.
          speed: {
            value: 'radial-gradient(closest-side, {colors.scrim.soft}, {colors.scrim.clear})',
          },
        },
      },
    },
    semanticTokens: {
      colors: semanticColors,
      shadows: {
        glass: { value: { base: glassShadow(day), _dark: glassShadow(night) } },
      },
    },
    layerStyles: {
      glass: { value: glassSurface('glass.fill') },
      glassStrong: { value: glassSurface('glass.fillStrong') },
    },
    textStyles: {
      numeric: {
        value: {
          fontFamily: 'display',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.01em',
        },
      },
    },
  },
});

/** The Chakra system. Pass to `<ChakraProvider value={system}>` (done once in `main.tsx`). */
export const system = createSystem(defaultConfig, config);

/**
 * Every semantic colour that switches day/night, as its CSS variable and day value
 * (`--chakra-colors-glass-sheen`, `rgba(255, 255, 255, 0.55)`, …). `themeCrossfade.ts`
 * registers these so the switch cross-fades everywhere they are used.
 */
export const THEME_COLOR_VARS: readonly { name: string; day: string }[] = themedColorTokens(semanticColors).map(
  ({ path, day }) => ({ name: system.token.var(`colors.${path}`).replace(/^var\((--[\w-]+)\)$/, '$1'), day }),
);

/** Class Chakra's `_dark` condition looks for (verified against `@chakra-ui/react` preset-base). */
export const DARK_CLASS = 'dark';

/**
 * Apply the resolved theme to the document. Toggles the `dark` class on `<html>` (what Chakra's
 * `_dark` condition and every semantic token key off), sets `color-scheme` so native controls
 * match, and mirrors the value as `data-theme="day|night"` for plain CSS selectors.
 * Idempotent and cheap; safe to call on every change.
 */
export function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const night = theme === 'night';
  root.classList.toggle(DARK_CLASS, night);
  root.classList.toggle('light', !night);
  root.style.colorScheme = night ? 'dark' : 'light';
  root.dataset.theme = theme;
}
