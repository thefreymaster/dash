/**
 * T23 Outside temperature — inline in the clock pill, after the divider (mockup `.temp`:
 * 24px glyph, `500 16px` display font, tabular figures, gap 6px).
 *
 * Renders nothing until the first weather result exists (the slot's divider hides with it),
 * then slides/fades in while the clock pill widens (`layout` on the pill). A new temperature
 * cross-fades with a small vertical slide like the clock digits; a new condition cross-fades
 * the glyph with a slight scale. Data: `useWeather` in `src/api/weather.ts`.
 */
import { VisuallyHidden, chakra } from '@chakra-ui/react';
import { AnimatePresence, motion } from 'motion/react';
import { useWeather } from '../../api/weather';
import { motionTokens, swapTransition } from '../../theme';
import { WEATHER_GLYPHS } from './glyphs';
import { formatTemperature, weatherDescription, weatherGlyph } from './weatherFormat';

const MotionSpan = motion.create(chakra.span);

const swap = swapTransition;

export function WeatherChip() {
  const weather = useWeather();
  return (
    <AnimatePresence>
      {weather && (
        <MotionSpan
          key="weather"
          layout="position"
          display="flex"
          alignItems="center"
          gap="6px"
          textStyle="numeric"
          fontWeight="500"
          fontSize="16px"
          lineHeight="1"
          letterSpacing="0"
          color="text.primary"
          whiteSpace="nowrap"
          initial={{ opacity: 0, x: -8, scale: 0.9 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -8, scale: 0.9 }}
          transition={{ duration: motionTokens.duration, ease: motionTokens.easeOut }}
        >
          <VisuallyHidden>{weatherDescription(weather)}</VisuallyHidden>
          <Swap itemKey={weatherGlyph(weather.condition, weather.isDay)} glyph />
          <Swap itemKey={formatTemperature(weather.temperature, weather.unit)} />
        </MotionSpan>
      )}
    </AnimatePresence>
  );
}

/** One cross-fading cell: the glyph (scale) or the temperature text (vertical slide). */
function Swap({ itemKey, glyph = false }: { itemKey: string; glyph?: boolean }) {
  const enter = glyph ? { opacity: 0, scale: 0.6 } : { opacity: 0, y: '-0.45em' };
  const leave = glyph ? { opacity: 0, scale: 0.6 } : { opacity: 0, y: '0.45em' };
  return (
    <span aria-hidden style={{ display: 'inline-grid', ...(glyph ? { width: 24, height: 24 } : null) }}>
      <AnimatePresence initial={false}>
        <motion.span
          key={itemKey}
          style={{ gridArea: '1 / 1', display: glyph ? 'grid' : 'block' }}
          initial={enter}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={leave}
          transition={swap}
        >
          {glyph ? WEATHER_GLYPHS[itemKey as keyof typeof WEATHER_GLYPHS] : itemKey}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
