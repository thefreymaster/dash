/**
 * T18 GPS signal — four bars and a label (mockup `.bars` + `.gps-label`).
 *
 *   strong/good/fair/weak  4/3/2/1 lit bars (accuracy ≤10 / ≤25 / ≤50 / worse, metres)
 *   searching              bars pulse in a gentle wave (idle, requesting, stale)
 *   denied / unavailable   bars dim, a warning slash draws across, label turns warning
 *
 * Reads `telemetry` through `gpsBucket`, which returns a small string, so this re-renders
 * only when the bucket changes — not on every fix. In demo mode the label reads DEMO.
 */
import { Box, Flex } from '@chakra-ui/react';
import { AnimatePresence, motion } from 'motion/react';
import { telemetry } from '../../state';
import { motionTokens, swapTransition } from '../../theme';
import { gpsBars, gpsBlocked, gpsBucket, gpsDescription } from './gpsBucket';

const MotionBox = motion.create(Box);
const MotionFlex = motion.create(Flex);

const BAR_HEIGHTS = [6, 9, 12, 16] as const;
const DIM = 0.25;

export function GpsSignal() {
  const bucket = telemetry.use(gpsBucket);
  const source = telemetry.use((t) => t.source);
  const lit = gpsBars(bucket);
  const blocked = gpsBlocked(bucket);
  const searching = bucket === 'searching';
  const label = source === 'sim' ? 'DEMO' : 'GPS';

  return (
    // `layout="position"`: when the label changes width (GPS ↔ DEMO) this re-render makes the
    // pill (a `layout` GlassWidget in a LayoutGroup) glide to its new width.
    <MotionFlex layout="position" align="center" gap="8px" role="img" aria-label={gpsDescription(bucket, source)}>
      <Box position="relative" display="flex" alignItems="flex-end" gap="2.5px" h="16px" aria-hidden>
        {BAR_HEIGHTS.map((h, i) => (
          <MotionBox
            key={h}
            as="span"
            display="block"
            w="4px"
            h={`${h}px`}
            rounded="1.5px"
            bg="text.primary"
            initial={false}
            animate={
              searching
                ? { opacity: [DIM, 0.85, DIM] }
                : { opacity: blocked ? DIM * 0.8 : i < lit ? 1 : DIM }
            }
            transition={
              searching
                ? { duration: 1.6, ease: 'easeInOut', repeat: Infinity, delay: i * 0.16 }
                : { duration: 0.4, ease: motionTokens.easeOut }
            }
          />
        ))}
        <AnimatePresence>
          {blocked && (
            <motion.svg
              key="slash"
              viewBox="0 0 24 18"
              width="24"
              height="18"
              style={{ position: 'absolute', left: -3, top: -1, overflow: 'visible' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.path
                d="M2 17L22 1"
                fill="none"
                strokeWidth="2.4"
                strokeLinecap="round"
                style={{ stroke: 'var(--chakra-colors-warning-solid)' }}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                exit={{ pathLength: 0 }}
                transition={{ duration: 0.45, ease: motionTokens.easeOut }}
              />
            </motion.svg>
          )}
        </AnimatePresence>
      </Box>

      <Box
        position="relative"
        display="inline-grid"
        fontWeight="600"
        fontSize="13px"
        lineHeight="1"
        letterSpacing="0.06em"
        color={blocked ? 'warning.fg' : source === 'sim' ? 'accent.fg' : 'text.secondary'}
        transitionProperty="color"
        transitionDuration="normal"
        aria-hidden
      >
        <AnimatePresence initial={false}>
          <motion.span
            key={label}
            style={{ gridArea: '1 / 1' }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={swapTransition}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </Box>
    </MotionFlex>
  );
}
