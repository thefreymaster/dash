/**
 * Legibility scrims between the map and the HUD (mockup `.atmo`): a fade from the top
 * edge behind the top strip, and a soft pool behind the speedometer. Day and night
 * versions cross-fade with the theme. Never catches pointer events.
 */
import { Box } from '@chakra-ui/react';
import { glassPalette, type GlassPalette } from '../../theme';
import { ThemeCrossfade } from './ThemeCrossfade';

const top = (p: GlassPalette) =>
  `linear-gradient(180deg, ${p.scrimEdge} 0, ${p.scrimEdge} 28px, ${p.scrimClear} 130px)`;

// Centred on the speedometer (left inset + 112px, top strip + 100px).
const pool = (p: GlassPalette) =>
  `radial-gradient(ellipse 340px 260px at calc(var(--hud-l) + 100px) calc(var(--hud-t) + 160px), ${p.scrimSoft}, ${p.scrimClear} 70%)`;

export function MapScrim() {
  return (
    <Box aria-hidden position="absolute" inset="0" pointerEvents="none">
      <ThemeCrossfade day={pool(glassPalette.day)} night={pool(glassPalette.night)} />
      <ThemeCrossfade
        day={top(glassPalette.day)}
        night={top(glassPalette.night)}
        bottom="auto"
        h="calc(var(--sat) + 130px)"
      />
    </Box>
  );
}
