import { describe, expect, it } from 'vitest';
import { glassPalette, motionTokens } from './palette';
import { DARK_CLASS, THEME_COLOR_VARS, system, themedColorTokens } from './system';
import { themeCrossfadeTransition } from './themeCrossfade';

describe('themedColorTokens', () => {
  it('lists only tokens with a _dark variant, by dot path, with the day value', () => {
    const tree = {
      page: { value: '#000' },
      glass: {
        fill: { value: { base: 'white', _dark: 'black' } },
        fillStrong: { value: { base: 'ivory', _dark: 'navy' } },
      },
      warning: { contrast: { value: '#fff' }, solid: { value: { base: 'red', _dark: 'salmon' } } },
    };
    expect(themedColorTokens(tree)).toEqual([
      { path: 'glass.fill', day: 'white' },
      { path: 'glass.fillStrong', day: 'ivory' },
      { path: 'warning.solid', day: 'red' },
    ]);
  });
});

describe('THEME_COLOR_VARS', () => {
  const css = system.getTokenCss() as Record<string, Record<string, Record<string, string>>>;
  const layer = css['@layer tokens'] ?? css;
  const dark = layer[Object.keys(layer).find((k) => k.startsWith(`.${DARK_CLASS}`))!];
  const byName = new Map(THEME_COLOR_VARS.map((v) => [v.name, v.day]));

  it('are exactly the Dash colour variables the night theme overrides', () => {
    for (const { name } of THEME_COLOR_VARS) expect(dark[name], name).toBeDefined();
    expect(THEME_COLOR_VARS.length).toBeGreaterThan(30);
  });

  it('include the glass sheen and text colours, with their day values', () => {
    expect(byName.get('--chakra-colors-glass-sheen')).toBe(glassPalette.day.glassSheen);
    expect(byName.get('--chakra-colors-glass-fill-strong')).toBe(glassPalette.day.glassFillStrong);
    expect(byName.get('--chakra-colors-text-secondary')).toBe(glassPalette.day.textSecondary);
    expect(dark['--chakra-colors-glass-sheen']).toBe(glassPalette.night.glassSheen);
  });

  it('leave out colours that do not change (page, warning.contrast)', () => {
    expect(byName.has('--chakra-colors-page')).toBe(false);
    expect(byName.has('--chakra-colors-warning-contrast')).toBe(false);
  });
});

describe('themeCrossfadeTransition', () => {
  it('transitions every variable over the theme duration', () => {
    expect(themeCrossfadeTransition([{ name: '--a' }, { name: '--b' }], 0.9)).toBe('--a 0.9s ease, --b 0.9s ease');
    const full = themeCrossfadeTransition();
    expect(full).toContain(`--chakra-colors-glass-sheen ${motionTokens.durationTheme}s ease`);
    expect(full.split(', ')).toHaveLength(THEME_COLOR_VARS.length);
  });
});
