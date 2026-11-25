/**
 * T17 Speedometer — the most legible thing on screen.
 *
 * Glass panel (224×200, radius 40) with a 240° round-capped gradient arc and big tabular
 * numerals, transcribed from the mockup's `.w-speed`. Everything per-frame is Motion values:
 *
 *   pose.speedMps ─┐
 *   gaugeSweep ────┼─ target (display unit, max of real speed and boot sweep)
 *   unit factor ───┘        │ useSpring (glide; also glides across a unit switch)
 *                        display ──┬─ digits (textContent, only when the rounded value changes)
 *                                  ├─ digit scale (shrinks at 3 digits, sprung)
 *                                  └─ arc fraction → stroke-dasharray + opacity
 *
 * React re-renders only when the unit setting changes. The panel has a fixed size, the
 * digits are tabular and centred, so 0 → 9 → 10 → 100 never changes its width.
 */
import { Box } from '@chakra-ui/react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'motion/react';
import { useEffect, useId } from 'react';
import { speedUnitLabel } from '../../lib';
import { pose, settings } from '../../state';
import { glassPalette, motionTokens } from '../../theme';
import { GlassWidget } from '../shell/GlassWidget';
import { ThemeCrossfade } from '../shell/ThemeCrossfade';
import {
  FULL_SCALE,
  GAUGE,
  UNIT_FACTOR,
  arcDasharray,
  arcOpacity,
  arcPath,
  digitScaleFor,
  gaugeFraction,
  speedDigits,
} from './gauge';
import { gaugeSweep } from './sweep';

/** Critically damped, settles in ~0.4 s: smooths jumps without visible lag at driving rates. */
const SPEED_SPRING = { stiffness: 170, damping: 26, mass: 1 };
const SCALE_SPRING = { stiffness: 260, damping: 30, mass: 1 };

const ARC = arcPath();

const lens = (c: string) =>
  `radial-gradient(circle at 50% 50%, ${c} 0, ${c} 34%, transparent 68%)`;

export function Speedometer() {
  const units = settings.use((s) => s.units);
  const gradientId = `speed-arc-${useId().replace(/:/g, '')}`;

  // Unit-dependent constants as Motion values, so the per-frame pipeline never re-subscribes.
  const factor = useMotionValue(UNIT_FACTOR[units]);
  const fullScale = useMotionValue(FULL_SCALE[units]);
  useEffect(() => {
    factor.set(UNIT_FACTOR[units]);
    fullScale.set(FULL_SCALE[units]);
  }, [units, factor, fullScale]);

  const target = useTransform(
    [pose.speedMps, gaugeSweep, factor, fullScale],
    ([mps, sweep, f, full]: number[]) => Math.max(Math.max(0, mps) * f, sweep * full),
  );
  const display = useSpring(target, SPEED_SPRING);
  const fullSmooth = useSpring(fullScale, SPEED_SPRING);
  const fraction = useTransform([display, fullSmooth], ([d, full]: number[]) => gaugeFraction(d, full));
  const dash = useTransform(fraction, arcDasharray);
  const valueOpacity = useTransform(fraction, arcOpacity);

  const ready = useTransform(pose.hasPose, (has): number => (has ? 1 : 0));
  const digits = useTransform([display, ready, gaugeSweep], ([d, r, sweep]: number[]) =>
    speedDigits(d, r > 0 || sweep > 0),
  );
  const digitScale = useSpring(useTransform(display, digitScaleFor), SCALE_SPRING);
  // The placeholder dash before the first fix is dimmed; it fades up when a reading arrives.
  const digitOpacity = useSpring(
    useTransform([ready, gaugeSweep], ([r, sweep]: number[]): number => (r > 0 || sweep > 0 ? 1 : 0.4)),
    SCALE_SPRING,
  );

  return (
    <GlassWidget
      strong
      role="group"
      aria-label="Speed"
      w={`${GAUGE.width}px`}
      h={`${GAUGE.height}px`}
      flexShrink={0}
      rounded="glass.xl"
      transformOrigin="0 0"
    >
      {/* Soft lens behind the digits */}
      <ThemeCrossfade
        day={lens(glassPalette.day.glassLens)}
        night={lens(glassPalette.night.glassLens)}
        rounded="inherit"
      />

      <svg
        viewBox={`0 0 ${GAUGE.width} ${GAUGE.height}`}
        width={GAUGE.width}
        height={GAUGE.height}
        aria-hidden="true"
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="28" y1="150" x2="196" y2="30">
            <stop offset="0" style={{ stopColor: 'var(--chakra-colors-accent-alt)' }} />
            <stop offset="1" style={{ stopColor: 'var(--chakra-colors-accent-solid)' }} />
          </linearGradient>
        </defs>
        <path
          d={ARC}
          fill="none"
          strokeWidth={GAUGE.stroke}
          strokeLinecap="round"
          style={{ stroke: 'var(--chakra-colors-track)' }}
        />
        <motion.path
          d={ARC}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={GAUGE.stroke}
          strokeLinecap="round"
          style={{
            strokeDasharray: dash,
            opacity: valueOpacity,
            filter: 'drop-shadow(0 0 5px var(--chakra-colors-accent-subtle))',
          }}
        />
      </svg>

      {/* Digits: 98px rounded semibold, tabular; a 3-digit reading scales to 76px. */}
      <Box
        position="absolute"
        left="0"
        right="0"
        top="50px"
        textAlign="center"
        fontFamily="display"
        fontWeight="600"
        fontSize="98px"
        lineHeight="1"
        letterSpacing="-0.035em"
        fontVariantNumeric="tabular-nums"
        color="text.primary"
        whiteSpace="nowrap"
      >
        <motion.span
          aria-live="off"
          style={{ display: 'inline-block', scale: digitScale, opacity: digitOpacity, transformOrigin: '50% 55%' }}
        >
          {digits}
        </motion.span>
      </Box>

      <Box
        position="absolute"
        left="0"
        right="0"
        top="144px"
        h="20px"
        textAlign="center"
        fontFamily="display"
        fontWeight="600"
        fontSize="15px"
        lineHeight="20px"
        letterSpacing="0.04em"
        color="text.secondary"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={units}
            style={{ display: 'inline-block' }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: motionTokens.durationFast, ease: motionTokens.easeOut }}
          >
            {speedUnitLabel(units)}
          </motion.span>
        </AnimatePresence>
      </Box>
    </GlassWidget>
  );
}
