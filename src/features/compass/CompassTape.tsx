/**
 * T19 Compass tape — mockup `.w-compass`: a 260×44 glass pill with a ticked tape sliding
 * under a fixed accent pointer, and the numeric heading on the right.
 *
 * Per-frame and React-free: `pose.headingDeg` is unwrapped into a continuous value (so a
 * turn through north is 359 → 361, not 359 → 1), sprung, and bound to the tape's
 * translateX and the readout's text. The tape spans -180°…540°, so the jump of the
 * translation at the 0/360 seam lands on identical marks (see `tape.ts`).
 */
import { Box } from '@chakra-ui/react';
import { motion, useMotionValue, useMotionValueEvent, useSpring, useTransform } from 'motion/react';
import { pose } from '../../state';
import { GlassWidget } from '../shell/GlassWidget';
import { headingText, tapeMarks, tapeOffsetPx, unwrapHeading } from './tape';

const HEADING_SPRING = { stiffness: 120, damping: 22, mass: 1 };

/** Width of the readout on the right, px. */
const READOUT_W = 64;
/** Left inset of the tape window, px. */
const TAPE_INSET = 12;
const PILL_W = 260;
/** Pointer x: centre of the tape window. */
const POINTER_X = TAPE_INSET + (PILL_W - TAPE_INSET - READOUT_W) / 2;

// Static strip, built once.
const MARKS = tapeMarks().map((m) =>
  m.kind === 'label' ? (
    <span key={m.deg} className={m.cardinal ? 'c' : 'c minor'} style={{ left: `${m.x}px` }}>
      {m.text}
    </span>
  ) : (
    <i key={m.deg} className={m.major ? 't m' : 't'} style={{ left: `${m.x}px` }} />
  ),
);

const FADE_MASK = 'linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent)';

export function CompassTape() {
  const unwrapped = useMotionValue(pose.headingDeg.get());
  useMotionValueEvent(pose.headingDeg, 'change', (deg) => {
    unwrapped.set(unwrapHeading(unwrapped.get(), deg));
  });
  const heading = useSpring(unwrapped, HEADING_SPRING);
  const x = useTransform(heading, tapeOffsetPx);
  const readout = useTransform(heading, headingText);

  return (
    <GlassWidget
      role="group"
      aria-label="Compass heading"
      w={`${PILL_W}px`}
      h="44px"
      flexShrink={0}
      rounded="pill"
      overflow="hidden"
    >
      {/* Tape window, faded at both ends */}
      <Box
        aria-hidden
        position="absolute"
        left={`${TAPE_INSET}px`}
        right={`${READOUT_W}px`}
        top="0"
        bottom="0"
        overflow="hidden"
        css={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
      >
        <motion.div
          style={{ x, position: 'absolute', left: '50%', top: 0, height: 44, willChange: 'transform' }}
        >
          <Box
            css={{
              '& .t': {
                position: 'absolute',
                bottom: '9px',
                width: '1.5px',
                height: '6px',
                marginLeft: '-0.75px',
                borderRadius: '1px',
                bg: 'text.tertiary',
              },
              '& .t.m': { height: '10px', bg: 'text.secondary' },
              '& .c': {
                position: 'absolute',
                top: '7px',
                width: '40px',
                marginLeft: '-20px',
                textAlign: 'center',
                fontFamily: 'display',
                fontWeight: '700',
                fontSize: '14px',
                lineHeight: '16px',
                letterSpacing: '0.02em',
                color: 'text.primary',
              },
              '& .c.minor': { fontWeight: '600', fontSize: '13px', color: 'text.secondary' },
            }}
          >
            {MARKS}
          </Box>
        </motion.div>
      </Box>

      {/* Fixed pointer: caret at the top edge, short line above the ticks */}
      <Box aria-hidden position="absolute" left={`${POINTER_X}px`} top="0" w="0" h="0">
        <svg
          width="12"
          height="7"
          viewBox="0 0 12 7"
          style={{ position: 'absolute', left: -6, top: 0, display: 'block' }}
        >
          <path d="M0 0h12L6 7z" style={{ fill: 'var(--chakra-colors-accent-solid)' }} />
        </svg>
        <Box position="absolute" left="-1px" top="26px" w="2px" h="14px" rounded="1px" bg="accent.solid" />
      </Box>

      {/* Numeric heading */}
      <Box
        position="absolute"
        right="0"
        top="0"
        bottom="0"
        w={`${READOUT_W}px`}
        display="flex"
        alignItems="center"
        justifyContent="center"
        borderLeftWidth="1px"
        borderLeftStyle="solid"
        borderLeftColor="glass.controlHover"
        fontFamily="display"
        fontWeight="600"
        fontSize="16px"
        lineHeight="1"
        fontVariantNumeric="tabular-nums"
        color="text.primary"
      >
        <motion.span>{readout}</motion.span>
      </Box>
    </GlassWidget>
  );
}
