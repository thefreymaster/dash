/**
 * Speedometer arc maths. Pure functions, no React — tested in `gauge.test.ts`.
 *
 * Geometry is the mockup's (`mockups/glass.html`, `.gauge`): a 224×200 panel, circle centred
 * at (112, 104) with radius 84, a 240° arc that starts bottom-left (150°, measured clockwise
 * from +x in SVG coordinates, y down) and ends bottom-right (390° ≡ 30°).
 */
import { MPS_TO_KMH, MPS_TO_MPH } from '../../lib';
import type { Units } from '../../types';

export const GAUGE = {
  /** Panel / viewBox size, px. */
  width: 224,
  height: 200,
  /** Arc centre, viewBox units. */
  cx: 112,
  cy: 104,
  /** Arc radius, viewBox units. */
  r: 84,
  /** Start angle, degrees clockwise from +x. */
  startDeg: 150,
  /** Sweep, degrees. */
  sweepDeg: 240,
  /** Stroke width of the track and value arcs. */
  stroke: 13,
} as const;

/** Length of the full arc in viewBox units (r × sweep in radians ≈ 351.86). */
export const ARC_LENGTH = GAUGE.r * ((GAUGE.sweepDeg * Math.PI) / 180);

/** Full-scale reading of the arc in the display unit: 0–100 mph or 0–160 km/h. */
export const FULL_SCALE: Readonly<Record<Units, number>> = { mph: 100, kmh: 160 };

/** m/s → display unit factor. */
export const UNIT_FACTOR: Readonly<Record<Units, number>> = { mph: MPS_TO_MPH, kmh: MPS_TO_KMH };

/** Scale applied to the digits once the reading reaches three digits (mockup: 98px → 76px). */
export const THREE_DIGIT_SCALE = 76 / 98;

/** Point on the gauge circle at `angleDeg` (clockwise from +x, SVG coordinates). */
export function gaugePoint(angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: GAUGE.cx + GAUGE.r * Math.cos(a), y: GAUGE.cy + GAUGE.r * Math.sin(a) };
}

/** SVG path of the whole arc, start → end (`M39.25 146 A84 84 0 1 1 184.75 146`). */
export function arcPath(): string {
  const s = gaugePoint(GAUGE.startDeg);
  const e = gaugePoint(GAUGE.startDeg + GAUGE.sweepDeg);
  const large = GAUGE.sweepDeg > 180 ? 1 : 0;
  const f = (n: number) => String(Math.round(n * 100) / 100);
  return `M${f(s.x)} ${f(s.y)} A${GAUGE.r} ${GAUGE.r} 0 ${large} 1 ${f(e.x)} ${f(e.y)}`;
}

/** Reading → filled fraction of the arc, clamped to [0, 1]. Non-finite input → 0. */
export function gaugeFraction(value: number, fullScale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(fullScale) || fullScale <= 0) return 0;
  return Math.min(1, Math.max(0, value / fullScale));
}

/** `stroke-dasharray` that draws `fraction` of the arc. The gap is longer than the arc. */
export function arcDasharray(fraction: number): string {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return `${(f * ARC_LENGTH).toFixed(2)} ${Math.ceil(ARC_LENGTH) + 10}`;
}

/**
 * Opacity of the value arc. A round line cap draws a dot even for a zero-length dash, so
 * the arc fades out below ~0.4 % of full scale (the mockup hides it under 0.4 mph).
 */
export function arcOpacity(fraction: number): number {
  const lo = 0.002;
  const hi = 0.008;
  if (!(fraction > lo)) return 0;
  if (fraction >= hi) return 1;
  return (fraction - lo) / (hi - lo);
}

/**
 * The speed is live — fit to show as a number — only when a pose exists AND the speed is
 * known (`pose.speedKnown`: a fresh fix with a usable speed). Otherwise the readout is the
 * dimmed "–" and the arc is empty: never a remembered number, never a made-up 0.
 */
export function speedIsLive(hasPose: boolean, speedKnown: boolean): boolean {
  return hasPose && speedKnown;
}

/** The digits show a number (not the dimmed "–") while the speed is live or the boot sweep runs. */
export function readoutLive(speedLive: boolean, sweep: number): boolean {
  return speedLive || sweep > 0;
}

/**
 * Value the gauge heads for, in the display unit: the real speed only while it is live
 * (an unknown speed eases the arc to empty, it is never shown as a remembered number),
 * and never below the boot sweep (`sweep` × full scale).
 */
export function gaugeTarget(speedMps: number, live: boolean, sweep: number, factor: number, fullScale: number): number {
  const real = live && Number.isFinite(speedMps) ? Math.max(0, speedMps) * factor : 0;
  const boot = Number.isFinite(sweep) ? sweep * fullScale : 0;
  return Math.max(real, boot);
}

/** Digits shown on the speedometer: rounded reading, or an en dash while there is no live speed. */
export function speedDigits(value: number, ready: boolean): string {
  if (!ready) return '–';
  if (!Number.isFinite(value) || value <= 0) return '0';
  return String(Math.round(value));
}

/** Digit scale for a reading: shrink once the rounded value has three digits. */
export function digitScaleFor(value: number): number {
  return Number.isFinite(value) && Math.round(value) >= 100 ? THREE_DIGIT_SCALE : 1;
}
