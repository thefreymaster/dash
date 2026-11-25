import { describe, expect, it } from 'vitest';
import { glassPalette } from './palette';
import { DARK_CLASS, system } from './system';

describe('Chakra system', () => {
  const css = system.getTokenCss() as Record<string, Record<string, Record<string, string>>>;
  const layer = css['@layer tokens'] ?? css;
  const darkSelector = Object.keys(layer).find((k) => k.startsWith(`.${DARK_CLASS} `));

  it('night values hang off the `.dark` class that applyTheme toggles', () => {
    expect(darkSelector).toBeDefined();
    const vars = layer[darkSelector!];
    expect(vars['--chakra-colors-glass-fill']).toBe(glassPalette.night.glassFill);
    expect(vars['--chakra-colors-text-primary']).toBe(glassPalette.night.textPrimary);
    expect(vars['--chakra-colors-accent-solid']).toBe(glassPalette.night.accent);
  });

  it('day values are the base values', () => {
    // Chakra emits base token values under `&:where(html, .chakra-theme)` (zero specificity).
    const base = Object.entries(layer).find(([k]) => k.includes(':where(html'))?.[1];
    expect(base?.['--chakra-colors-glass-fill']).toBe(glassPalette.day.glassFill);
    expect(base?.['--chakra-colors-text-primary']).toBe(glassPalette.day.textPrimary);
  });

  it('glass layer style resolves to the Glass recipe', () => {
    const style = system.css({ layerStyle: 'glass' }) as Record<string, string>;
    expect(style.backgroundColor).toBe('var(--chakra-colors-glass-fill)');
    expect(style.boxShadow).toBe('var(--chakra-shadows-glass)');
    expect(style.backdropFilter).toContain('blur(');
  });
});
