/**
 * DEV ONLY. A tiny simulated drive around a few city blocks, writing the `pose`
 * Motion values the way the sensors loop would (the sensors are not started in the harness).
 */
import { bearingDeg, dampAngleDeg, destinationPoint, haversineM } from '../../../lib';
import { pose } from '../../../state';
import type { LngLat } from '../../../types';

/** Block size of the simulated loop, metres. */
const BLOCK_M = 110;

export interface SimOptions {
  center: LngLat;
  /** Constant speed in m/s, or `'vary'` for a 5 → 30 → 5 m/s cycle. */
  speed: number | 'vary';
  /** Delay before the first pose, ms. */
  delayMs: number;
  /** Accuracy radius written to the pose, metres. */
  accuracyM: number;
}

/** Start driving. Returns a stop function. */
export function startSimDrive({ center, speed, delayMs, accuracyM }: SimOptions): () => void {
  // A clockwise loop around a 4 × 3 block rectangle.
  const at = (e: number, n: number): LngLat => destinationPoint(destinationPoint(center, 90, e * BLOCK_M), 0, n * BLOCK_M);
  const route: LngLat[] = [at(0, -1), at(0, 2), at(4, 2), at(4, -1), at(0, -1)];
  const lengths = route.slice(1).map((p, i) => haversineM(route[i], p));
  const total = lengths.reduce((a, b) => a + b, 0);

  let travelled = 0;
  let heading = bearingDeg(route[0], route[1]);
  let last = 0;
  let raf = 0;
  const startedAt = performance.now();

  const pointAt = (s: number): { p: LngLat; bearing: number } => {
    let d = ((s % total) + total) % total;
    for (let i = 0; i < lengths.length; i++) {
      if (d <= lengths[i]) {
        const b = bearingDeg(route[i], route[i + 1]);
        return { p: destinationPoint(route[i], b, d), bearing: b };
      }
      d -= lengths[i];
    }
    return { p: route[0], bearing: heading };
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (now - startedAt < delayMs) return;
    const t = (now - startedAt - delayMs) / 1000;
    const v = speed === 'vary' ? 17.5 - 12.5 * Math.cos((2 * Math.PI * t) / 40) : speed;
    travelled += v * dt;
    // Look slightly ahead so corners are rounded like a real turn.
    const ahead = pointAt(travelled + 8);
    heading = dampAngleDeg(heading, ahead.bearing, 3, dt);
    const { p } = pointAt(travelled);
    pose.lng.set(p[0]);
    pose.lat.set(p[1]);
    pose.headingDeg.set(heading);
    pose.speedMps.set(v);
    pose.accuracyM.set(accuracyM);
    pose.hasPose.set(true);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
