/**
 * Compass tape maths. Pure, tested in `tape.test.ts`.
 *
 * The tape is a strip of marks from -180° to 540° laid out at `PX_PER_DEG`, positioned so
 * that degree 0 sits under the pointer at translateX(0). Translating by
 * `tapeOffsetPx(heading)` (heading normalised to [0, 360)) puts `heading` under the
 * pointer. Because the strip repeats every 360° and extends 180° past both ends of
 * [0, 360), the window around the pointer is always covered, and the jump of the
 * translation at the 0/360 seam is invisible.
 */
import { angleDiffDeg, normalizeDeg } from '../../lib';

/** Horizontal pixels per degree of heading (mockup: 2.4). */
export const PX_PER_DEG = 2.4;
/** First and last degree rendered on the strip. */
export const TAPE_MIN_DEG = -180;
export const TAPE_MAX_DEG = 540;
/** Spacing of the small ticks, degrees. */
export const TICK_STEP_DEG = 5;

const LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export type TapeMark =
  | { deg: number; x: number; kind: 'label'; text: (typeof LABELS)[number]; cardinal: boolean }
  | { deg: number; x: number; kind: 'tick'; major: boolean };

/** All marks on the strip: a letter every 45°, a tick every 5° (taller every 15°). */
export function tapeMarks(): TapeMark[] {
  const marks: TapeMark[] = [];
  for (let deg = TAPE_MIN_DEG; deg <= TAPE_MAX_DEG; deg += TICK_STEP_DEG) {
    const x = deg * PX_PER_DEG;
    if (deg % 45 === 0) {
      const text = LABELS[normalizeDeg(deg) / 45];
      marks.push({ deg, x, kind: 'label', text, cardinal: text.length === 1 });
    } else {
      marks.push({ deg, x, kind: 'tick', major: deg % 15 === 0 });
    }
  }
  return marks;
}

/** translateX of the strip that puts `headingDeg` under the pointer. Seam-safe for any input. */
export function tapeOffsetPx(headingDeg: number): number {
  if (!Number.isFinite(headingDeg)) return 0;
  return -normalizeDeg(headingDeg) * PX_PER_DEG + 0; // `+ 0` avoids -0
}

/** Degrees either side of the pointer that a tape window of `widthPx` shows. */
export function visibleHalfSpanDeg(widthPx: number): number {
  return widthPx / 2 / PX_PER_DEG;
}

/**
 * Continue an unwrapped (continuous) heading towards a new raw heading by the shortest
 * turn, so a spring on the result turns 359° → 1° through north instead of all the way
 * round.
 */
export function unwrapHeading(prevUnwrapped: number, nextRawDeg: number): number {
  if (!Number.isFinite(nextRawDeg)) return prevUnwrapped;
  if (!Number.isFinite(prevUnwrapped)) return normalizeDeg(nextRawDeg);
  return prevUnwrapped + angleDiffDeg(normalizeDeg(prevUnwrapped), nextRawDeg);
}

/** Heading readout, `"0°"` … `"359°"` (359.6 rounds to `"0°"`, never `"360°"`). */
export function headingText(headingDeg: number): string {
  if (!Number.isFinite(headingDeg)) return '–°';
  return `${Math.round(normalizeDeg(headingDeg)) % 360}°`;
}
