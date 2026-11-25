/**
 * Rolling text for trip numbers (presentational; the data-bound leaf decides what to show).
 *
 * Each character sits in its own cell, keyed from the right so digits stay aligned when the
 * number grows ("9.9" → "10.0"). A changed character slides out and its replacement slides
 * in — upwards when the value grows, downwards when it shrinks (a reset rolls everything
 * down) — with transform + opacity only, clipped to the line like an odometer. Cells that appear or disappear fade, are popped out
 * of the flow at once (so the pill can animate to its new width) and the rest slide over.
 * Screen readers get the plain text.
 */
import { VisuallyHidden } from '@chakra-ui/react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { motionTokens, swapTransition } from '../../theme';

/** Every changing value in the app swaps with the same timing (`swapTransition`). */
const ROLL = swapTransition;

const charVariants = {
  enter: (dir: number) => ({ opacity: 0, y: dir < 0 ? '-0.55em' : '0.55em' }),
  center: { opacity: 1, y: 0 },
  exit: (dir: number) => ({ opacity: 0, y: dir < 0 ? '0.55em' : '-0.55em' }),
};

export function Roll({ text, order }: { text: string; order: number }) {
  // Direction of the last change, derived during render from the ordering value.
  const [last, setLast] = useState({ order, dir: 1 });
  if (order !== last.order) setLast({ order, dir: order < last.order ? -1 : 1 });
  const dir = order === last.order ? last.dir : order < last.order ? -1 : 1;
  const chars = [...text];

  return (
    <span style={{ position: 'relative', display: 'inline-flex', whiteSpace: 'pre' }}>
      <VisuallyHidden>{text}</VisuallyHidden>
      <AnimatePresence initial={false} mode="popLayout" anchorX="right">
        {chars.map((ch, i) => {
          const fromRight = chars.length - 1 - i;
          return (
            <motion.span
              key={fromRight}
              aria-hidden
              layout="position"
              // Odometer window: the rolling characters are clipped to the line (with a small
              // bleed so glyphs are never cut at rest).
              style={{ display: 'inline-grid', overflow: 'hidden', paddingBlock: '0.12em', marginBlock: '-0.12em' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.16, ease: motionTokens.easeOut } }}
              transition={ROLL}
            >
              <AnimatePresence initial={false} custom={dir}>
                <motion.span
                  key={ch}
                  custom={dir}
                  variants={charVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={ROLL}
                  style={{ gridArea: '1 / 1' }}
                >
                  {ch}
                </motion.span>
              </AnimatePresence>
            </motion.span>
          );
        })}
      </AnimatePresence>
    </span>
  );
}
