import { describe, expect, it } from 'vitest';
import {
  PX_PER_DEG,
  TAPE_MAX_DEG,
  TAPE_MIN_DEG,
  headingText,
  tapeMarks,
  tapeOffsetPx,
  unwrapHeading,
  visibleHalfSpanDeg,
} from './tape';

/** Tape window width in the cluster: 260px pill − 12px left inset − 64px readout. */
const WINDOW_PX = 260 - 12 - 64;

describe('tapeOffsetPx', () => {
  it('puts the heading under the pointer', () => {
    expect(tapeOffsetPx(0)).toBe(0);
    expect(tapeOffsetPx(42)).toBeCloseTo(-42 * PX_PER_DEG);
    expect(tapeOffsetPx(359.5)).toBeCloseTo(-359.5 * PX_PER_DEG);
  });

  it('normalises out-of-range headings', () => {
    expect(tapeOffsetPx(360)).toBe(0);
    expect(tapeOffsetPx(-10)).toBeCloseTo(-350 * PX_PER_DEG);
    expect(tapeOffsetPx(725)).toBeCloseTo(-5 * PX_PER_DEG);
    expect(tapeOffsetPx(Number.NaN)).toBe(0);
  });
});

describe('tapeMarks', () => {
  const marks = tapeMarks();

  it('covers the visible window for every heading', () => {
    const half = visibleHalfSpanDeg(WINDOW_PX);
    expect(half).toBeCloseTo(38.33, 1);
    // Any heading in [0, 360) plus/minus the half window stays inside the strip.
    expect(TAPE_MIN_DEG).toBeLessThanOrEqual(0 - half - 5);
    expect(TAPE_MAX_DEG).toBeGreaterThanOrEqual(360 + half + 5);
    expect(marks[0].deg).toBe(TAPE_MIN_DEG);
    expect(marks[marks.length - 1].deg).toBe(TAPE_MAX_DEG);
  });

  it('repeats every 360° so the seam is invisible', () => {
    const at = (deg: number) => marks.find((m) => m.deg === deg)!;
    for (const deg of [-180, -135, -90, -20, -15, 0, 5, 45, 90, 175]) {
      const a = at(deg);
      const b = at(deg + 360);
      expect(b.kind).toBe(a.kind);
      if (a.kind === 'label' && b.kind === 'label') expect(b.text).toBe(a.text);
      if (a.kind === 'tick' && b.kind === 'tick') expect(b.major).toBe(a.major);
      expect(b.x - a.x).toBeCloseTo(360 * PX_PER_DEG);
    }
  });

  it('labels cardinals and intercardinals', () => {
    const labels = marks.filter((m) => m.kind === 'label');
    const at = (deg: number) => labels.find((m) => m.deg === deg);
    expect(at(0)).toMatchObject({ text: 'N', cardinal: true });
    expect(at(45)).toMatchObject({ text: 'NE', cardinal: false });
    expect(at(270)).toMatchObject({ text: 'W', cardinal: true });
    expect(at(-45)).toMatchObject({ text: 'NW', cardinal: false });
    expect(at(540)).toMatchObject({ text: 'S' });
  });

  it('makes every third tick major', () => {
    const tick = (deg: number) => marks.find((m) => m.deg === deg);
    expect(tick(15)).toMatchObject({ kind: 'tick', major: true });
    expect(tick(10)).toMatchObject({ kind: 'tick', major: false });
    expect(tick(-30)).toMatchObject({ kind: 'tick', major: true });
  });
});

describe('unwrapHeading', () => {
  it('turns the short way across north', () => {
    expect(unwrapHeading(359, 1)).toBe(361);
    expect(unwrapHeading(1, 359)).toBe(-1);
    expect(unwrapHeading(721, 2)).toBe(722);
  });

  it('follows ordinary turns', () => {
    expect(unwrapHeading(90, 120)).toBe(120);
    expect(unwrapHeading(-30, 300)).toBe(-60);
  });

  it('ignores bad input', () => {
    expect(unwrapHeading(42, Number.NaN)).toBe(42);
    expect(unwrapHeading(Number.NaN, 400)).toBe(40);
  });
});

describe('headingText', () => {
  it('formats whole degrees without 360', () => {
    expect(headingText(42.2)).toBe('42°');
    expect(headingText(359.6)).toBe('0°');
    expect(headingText(-1)).toBe('359°');
    expect(headingText(722)).toBe('2°');
    expect(headingText(Number.NaN)).toBe('–°');
  });
});
