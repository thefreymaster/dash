/**
 * T20 Boot sequence — runs while `ui.phase === 'boot'` (≈1.5 s): the gauge sweeps to full
 * scale and back while the HUD widgets stagger in (their own entrance, see `hud.ts`), then
 * the phase moves to `cluster`. Renders nothing.
 *
 * Reduced motion: no sweep, just a short pause for the fades.
 */
import { useReducedMotion } from 'motion/react';
import { useEffect } from 'react';
import { ui } from '../../state';
import { resetGaugeSweep, runGaugeSweep } from '../speed';

/** Sweep timing, seconds: starts as the speedometer fades in. */
const BOOT_SWEEP_DELAY_S = 0.35;
const BOOT_SWEEP_DURATION_S = 1.15;
const REDUCED_BOOT_MS = 600;

function finishBoot() {
  ui.set((prev) => (prev.phase === 'boot' ? { ...prev, phase: 'cluster' } : prev));
}

export function BootSequence() {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      const timer = window.setTimeout(finishBoot, REDUCED_BOOT_MS);
      return () => window.clearTimeout(timer);
    }
    const controls = runGaugeSweep({ delay: BOOT_SWEEP_DELAY_S, duration: BOOT_SWEEP_DURATION_S });
    // A timer rather than the animation promise: a stopped animation (StrictMode remount)
    // must not end the boot early, and a backgrounded tab must still reach the cluster.
    const timer = window.setTimeout(finishBoot, (BOOT_SWEEP_DELAY_S + BOOT_SWEEP_DURATION_S) * 1000 + 60);
    return () => {
      window.clearTimeout(timer);
      resetGaugeSweep(controls);
    };
  }, [reduced]);

  return null;
}
