/**
 * T18 Clock — local time on the top strip (mockup `.clock`: 600 18px rounded, tabular).
 *
 * Re-renders once a minute, on the minute (plus on returning to the foreground, because
 * iOS freezes timers in the background). Each character sits in its own cell and
 * cross-fades with a small vertical slide when it changes; cells are keyed from the
 * right so "9:59" → "10:00" keeps the minutes aligned and fades the new "1" in.
 */
import { VisuallyHidden } from '@chakra-ui/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { formatClock } from '../../lib';
import { swapTransition } from '../../theme';
import { msUntilNextMinute } from './clockTiming';

function useMinuteClock(): string {
  const [text, setText] = useState(() => formatClock(new Date()));
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      window.clearTimeout(timer);
      const now = new Date();
      setText(formatClock(now));
      timer = window.setTimeout(tick, msUntilNextMinute(now));
    };
    timer = window.setTimeout(tick, msUntilNextMinute(new Date()));
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return text;
}

const swap = swapTransition;

export function Clock() {
  const text = useMinuteClock();
  const chars = [...text];
  return (
    <motion.time
      layout="position"
      style={{
        display: 'inline-flex',
        fontFamily: 'var(--chakra-fonts-display)',
        fontWeight: 600,
        fontSize: 18,
        lineHeight: 1,
        letterSpacing: '-0.01em',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <VisuallyHidden>{text}</VisuallyHidden>
      <AnimatePresence initial={false}>
        {chars.map((ch, i) => {
          const fromRight = chars.length - 1 - i;
          return (
            <motion.span
              key={fromRight}
              aria-hidden
              style={{ display: 'inline-grid' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={swap}
            >
              <AnimatePresence initial={false}>
                <motion.span
                  key={ch}
                  style={{ gridArea: '1 / 1' }}
                  initial={{ opacity: 0, y: '-0.45em' }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: '0.45em' }}
                  transition={swap}
                >
                  {ch}
                </motion.span>
              </AnimatePresence>
            </motion.span>
          );
        })}
      </AnimatePresence>
    </motion.time>
  );
}
