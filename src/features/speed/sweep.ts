/**
 * Boot "needle sweep": the gauge fills to full scale and back while the cluster boots.
 *
 * `gaugeSweep` is a fraction of full scale [0, 1]. The speedometer shows
 * `max(real speed, sweep × full scale)`, so a sweep started while already moving falls
 * back to the real speed rather than to zero. Only `runGaugeSweep` writes it.
 */
import { animate, motionValue, type AnimationPlaybackControls } from 'motion/react';

export const gaugeSweep = motionValue(0);

export interface SweepOptions {
  /** Seconds before the sweep starts. */
  delay?: number;
  /** Seconds for the whole up-and-back sweep. */
  duration?: number;
}

/** Run the sweep. Stop it with the returned controls (it is also safe to let it finish). */
export function runGaugeSweep({ delay = 0, duration = 1.2 }: SweepOptions = {}): AnimationPlaybackControls {
  gaugeSweep.jump(0);
  return animate(gaugeSweep, [0, 1, 0], {
    delay,
    duration,
    times: [0, 0.5, 1],
    ease: ['easeInOut', 'easeInOut'],
  });
}

/** Cancel any sweep and put the gauge back on the real speed. */
export function resetGaugeSweep(controls?: AnimationPlaybackControls): void {
  controls?.stop();
  gaugeSweep.jump(0);
}
