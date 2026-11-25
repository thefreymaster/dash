/**
 * T22 Road name pill — top centre (mockup `.w-road`: 44px glass pill, `700 16px` UI font,
 * letter-spacing .09em, uppercase, min 208px wide).
 *
 *   - Shows the road the vehicle is on (`useRoadName`), e.g. "MAIN ST".
 *   - With no name yet (no Mapbox token, no fix, nothing named nearby, first lookup failed)
 *     it shows a "Where to?" prompt instead of an empty pill.
 *   - The whole pill is a button that opens the destination search; a small search glyph
 *     says so.
 *   - A new name slides up and cross-fades in while the old one slides out (mockup
 *     `.road-name.enter/.leave`); the pill animates its width (`layout`), and long names
 *     end in an ellipsis inside a capped width instead of pushing into the side pills.
 */
import { chakra } from '@chakra-ui/react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useRoadName } from '../../api/roadName';
import { motionTokens, swapTransition } from '../../theme';
import { openDestinationSearch } from '../nav';
import { GlassWidget } from '../shell/GlassWidget';
import { roadLabel, roadSpokenName } from './roadLabel';

const MotionSpan = motion.create(chakra.span);

/** Key of the prompt in the label AnimatePresence (cannot collide with a road label). */
const PROMPT_KEY = '\u0000where-to';

/**
 * Width cap: the region spans the strip between the safe insets and the pill is centred in
 * it, so leaving ~196px per side keeps it clear of the clock/temperature and GPS pills.
 */
const MAX_WIDTH = 'calc(100% - 392px)';

const swap = swapTransition;

export function RoadName() {
  const match = useRoadName();
  const label = match ? roadLabel(match) : '';
  const hasName = label.length > 0;
  const spoken = match && hasName ? roadSpokenName(match) : '';

  return (
    // The pill shrinks when the old label's exit finishes, which re-renders only the
    // AnimatePresence. Inside a LayoutGroup, AnimatePresence calls its `forceRender` then,
    // so the pill re-measures and animates the shrink instead of snapping.
    <LayoutGroup>
      <GlassWidget
        as="button"
        onClick={openDestinationSearch}
        aria-label={hasName ? `${spoken}. Search for a destination` : 'Where to? Search for a destination'}
        layout
        h="44px"
        minW="208px"
        maxW={MAX_WIDTH}
        px="18px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        gap="8px"
        rounded="pill"
        overflow="hidden"
        cursor="pointer"
        color="text.primary"
        focusVisibleRing="inside"
        // Set as a style so Motion can correct the radius while `layout` scales the pill.
        style={{ borderRadius: 22 }}
        whileTap={{ scale: 0.96, transition: { out: true, duration: motionTokens.durationFast, ease: motionTokens.easeOut } }}
        transition={{ layout: swapTransition.default }}
      >
        <MotionSpan layout="position" aria-hidden flexShrink={0} display="grid" color="text.secondary">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.6" />
            <path d="M10.4 10.4L14 14" />
          </svg>
        </MotionSpan>

        <MotionSpan layout="position" aria-hidden display="grid" gridTemplateColumns="minmax(0, 1fr)" minW="0" alignItems="center">
          <AnimatePresence initial={false}>
            <MotionSpan
              key={hasName ? label : PROMPT_KEY}
              gridArea="1 / 1"
              display="block"
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              lineHeight="1.25"
              fontSize="16px"
              {...(hasName
                ? { fontWeight: '700', letterSpacing: '0.09em', textTransform: 'uppercase', color: 'text.primary' }
                : { fontWeight: '600', letterSpacing: '0.01em', color: 'text.secondary' })}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={swap}
            >
              {hasName ? label : 'Where to?'}
            </MotionSpan>
          </AnimatePresence>
        </MotionSpan>
      </GlassWidget>
    </LayoutGroup>
  );
}
