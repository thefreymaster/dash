/**
 * Frame-rate-independent smoothing for the rAF motion loop.
 *
 * `damp` is exponential decay towards a target: after `dt` seconds the remaining gap is
 * multiplied by `exp(-lambda * dt)`. Running it at 30, 60 or 120 fps gives the same curve,
 * and a long pause (tab backgrounded) simply snaps to the target.
 * `lambda` is the decay rate in 1/s: higher = snappier. Rules of thumb: 4 = relaxed,
 * 8 = responsive, 20 = nearly instant. Use `lambdaFromHalfLife` to think in seconds instead.
 */
import { angleDiffDeg, normalizeDeg } from './geo';

/** Decay rate (1/s) that halves the remaining gap every `halfLifeSeconds`. */
export function lambdaFromHalfLife(halfLifeSeconds: number): number {
  return Math.LN2 / halfLifeSeconds;
}

/**
 * Move `current` towards `target`, frame-rate independently.
 * @param lambda decay rate, 1/s (≥ 0)
 * @param dtSeconds time since the previous frame, seconds; ≤ 0 returns `current` unchanged
 */
export function damp(current: number, target: number, lambda: number, dtSeconds: number): number {
  if (!(dtSeconds > 0) || !(lambda > 0)) return current;
  if (!Number.isFinite(current)) return target;
  return target + (current - target) * Math.exp(-lambda * dtSeconds);
}

/**
 * `damp` for angles in degrees: takes the shortest way round (350° → 10° passes through 0°,
 * not 180°). Returns a value normalised to [0, 360).
 */
export function dampAngleDeg(currentDeg: number, targetDeg: number, lambda: number, dtSeconds: number): number {
  if (!(dtSeconds > 0) || !(lambda > 0)) return normalizeDeg(currentDeg);
  if (!Number.isFinite(currentDeg)) return normalizeDeg(targetDeg);
  const t = 1 - Math.exp(-lambda * dtSeconds);
  return normalizeDeg(currentDeg + angleDiffDeg(currentDeg, targetDeg) * t);
}
