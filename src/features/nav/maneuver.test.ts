import { describe, expect, it } from 'vitest';
import type { RouteStep } from '../../api/directions';
import { mphToMps } from '../../lib';
import type { Fix, Telemetry } from '../../types';
import { INITIAL_TYPING_LOCK, arrivalClock, formatMinutes, nextTypingLock, type TypingLock } from './format';
import { maneuverIcon, maneuverPhrase, phraseText } from './maneuver';

const step = (type: string, modifier: string | null, label = 'Elm St', exit: number | null = null): Pick<RouteStep, 'maneuver' | 'label'> => ({
  maneuver: { type, modifier, exit, location: [0, 0], bearingAfter: 0, instruction: '' },
  label,
});

describe('maneuverIcon', () => {
  it('covers straight, slight/normal/sharp both ways, U-turn, merge, roundabout and arrive', () => {
    expect(maneuverIcon('turn', 'straight')).toEqual({ shape: 'straight', mirrored: false });
    expect(maneuverIcon('turn', 'slight right')).toEqual({ shape: 'slight', mirrored: false });
    expect(maneuverIcon('turn', 'slight left')).toEqual({ shape: 'slight', mirrored: true });
    expect(maneuverIcon('turn', 'right')).toEqual({ shape: 'turn', mirrored: false });
    expect(maneuverIcon('end of road', 'left')).toEqual({ shape: 'turn', mirrored: true });
    expect(maneuverIcon('turn', 'sharp right')).toEqual({ shape: 'sharp', mirrored: false });
    expect(maneuverIcon('turn', 'sharp left')).toEqual({ shape: 'sharp', mirrored: true });
    expect(maneuverIcon('continue', 'uturn')).toEqual({ shape: 'uturn', mirrored: false });
    expect(maneuverIcon('merge', 'slight left')).toEqual({ shape: 'merge', mirrored: true });
    expect(maneuverIcon('merge', 'slight right')).toEqual({ shape: 'merge', mirrored: false });
    expect(maneuverIcon('roundabout', 'right')).toEqual({ shape: 'roundabout', mirrored: false });
    expect(maneuverIcon('rotary', null).shape).toBe('roundabout');
    expect(maneuverIcon('arrive', 'left')).toEqual({ shape: 'arrive', mirrored: false });
    expect(maneuverIcon('new name', null).shape).toBe('straight');
  });

  it('draws ramps and forks as gentle bears', () => {
    expect(maneuverIcon('off ramp', 'right')).toEqual({ shape: 'slight', mirrored: false });
    expect(maneuverIcon('fork', 'left')).toEqual({ shape: 'slight', mirrored: true });
  });
});

describe('maneuverPhrase', () => {
  it('builds short banner phrases', () => {
    expect(phraseText(maneuverPhrase(step('turn', 'right'), null))).toBe('Turn right onto Elm St');
    expect(phraseText(maneuverPhrase(step('turn', 'slight left'), null))).toBe('Bear left onto Elm St');
    expect(phraseText(maneuverPhrase(step('turn', 'sharp right'), null))).toBe('Make a sharp right onto Elm St');
    expect(phraseText(maneuverPhrase(step('continue', 'uturn'), null))).toBe('Make a U-turn onto Elm St');
    expect(phraseText(maneuverPhrase(step('merge', 'slight left', 'I-80 E'), null))).toBe('Merge onto I-80 E');
    expect(phraseText(maneuverPhrase(step('off ramp', 'slight right', 'Exit 4: Main St'), null))).toBe('Take the exit onto Exit 4: Main St');
    expect(phraseText(maneuverPhrase(step('fork', 'slight left', 'US-101 S'), null))).toBe('Keep left onto US-101 S');
    expect(phraseText(maneuverPhrase(step('roundabout', 'right', 'Elm St', 2), null))).toBe('Take the 2nd exit onto Elm St');
    expect(phraseText(maneuverPhrase(step('rotary', 'right', 'Elm St', 11), null))).toBe('Take the 11th exit onto Elm St');
    expect(phraseText(maneuverPhrase(step('new name', 'straight'), null))).toBe('Continue onto Elm St');
  });

  it('drops the joiner without a street, and names the destination on arrival', () => {
    expect(phraseText(maneuverPhrase(step('turn', 'left', ''), null))).toBe('Turn left');
    expect(maneuverPhrase(step('turn', 'left', ''), null).target).toBeNull();
    expect(phraseText(maneuverPhrase(step('arrive', 'right', ''), 'Blue Bottle'))).toBe('Arrive at Blue Bottle');
    expect(phraseText(maneuverPhrase(step('arrive', null, ''), null))).toBe('Arrive at your destination');
  });
});

describe('parked-only typing', () => {
  const FIX: Fix = { lat: 37.79, lng: -122.39, speedMps: 0, headingDeg: null, accuracyM: 5, timestamp: 1 };
  type T = Pick<Telemetry, 'status' | 'fix' | 'speedMps' | 'speedKnown'>;
  const gps = (mph: number, over: Partial<T> = {}): T => ({ status: 'tracking', fix: FIX, speedMps: mphToMps(mph), speedKnown: true, ...over });
  const parked: TypingLock = { allowed: true, reason: 'parked', seenMoving: false };
  const moving: TypingLock = { allowed: false, reason: 'moving', seenMoving: true };

  it('locks at 3 mph and unlocks only below 2 mph (trusted GPS speed)', () => {
    expect(nextTypingLock(parked, gps(0)).allowed).toBe(true);
    expect(nextTypingLock(parked, gps(2.9)).allowed).toBe(true);
    expect(nextTypingLock(parked, gps(3))).toEqual({ allowed: false, reason: 'moving', seenMoving: true });
    expect(nextTypingLock(moving, gps(2.5)).allowed).toBe(false); // hysteresis
    expect(nextTypingLock(moving, gps(1.9))).toEqual({ allowed: true, reason: 'parked', seenMoving: true });
    expect(nextTypingLock(parked, gps(0))).toBe(parked); // unchanged → same object
  });

  it('never treats an unknown speed as parked (regression: NaN / placeholder 0 unlocked typing)', () => {
    // A placeholder 0 with `speedKnown: false` (no usable speed, or the fix is over 3 s old).
    expect(nextTypingLock(parked, gps(0, { speedKnown: false }))).toEqual({ allowed: false, reason: 'no-speed', seenMoving: false });
    expect(nextTypingLock(moving, { ...gps(0), speedMps: Number.NaN, speedKnown: false }).allowed).toBe(false);
    // Weak or lost GPS after having had fixes (tunnel, garage, signal drop while driving).
    expect(nextTypingLock(parked, gps(0, { status: 'stale' })).reason).toBe('no-speed');
    expect(nextTypingLock(parked, gps(0, { status: 'requesting' })).allowed).toBe(false);
  });

  it('allows typing with no GPS at all yet, unless the vehicle was seen moving this session', () => {
    const noGps: T = { status: 'requesting', fix: null, speedMps: 0, speedKnown: false };
    expect(nextTypingLock(INITIAL_TYPING_LOCK, noGps)).toEqual({ allowed: true, reason: 'no-gps', seenMoving: false });
    expect(nextTypingLock(INITIAL_TYPING_LOCK, { ...noGps, status: 'denied' }).allowed).toBe(true); // parked indoors, GPS refused
    // Driving, then the position source restarts (no fix again): locked until GPS confirms a stop.
    let lock = nextTypingLock(INITIAL_TYPING_LOCK, gps(30));
    expect(lock).toEqual({ allowed: false, reason: 'moving', seenMoving: true });
    lock = nextTypingLock(lock, noGps);
    expect(lock).toEqual({ allowed: false, reason: 'no-speed', seenMoving: true });
    lock = nextTypingLock(lock, gps(0));
    expect(lock).toEqual({ allowed: true, reason: 'parked', seenMoving: true });
  });

  it('a speed that is not trusted never marks the vehicle as moving', () => {
    expect(nextTypingLock(INITIAL_TYPING_LOCK, gps(40, { speedKnown: false })).seenMoving).toBe(false);
  });
});

describe('ETA text', () => {
  it('formats minutes', () => {
    expect(formatMinutes(0)).toBe('<1 min');
    expect(formatMinutes(29)).toBe('<1 min');
    expect(formatMinutes(31)).toBe('1 min');
    expect(formatMinutes(14 * 60)).toBe('14 min');
    expect(formatMinutes(65 * 60)).toBe('1 h 5 min');
    expect(formatMinutes(120 * 60)).toBe('2 h');
    expect(formatMinutes(Number.NaN)).toBe('<1 min');
  });

  it('gives the arrival clock time', () => {
    const now = new Date(2026, 10, 25, 10, 52, 10).getTime();
    expect(arrivalClock(now, 14 * 60, false)).toBe('11:06');
    expect(arrivalClock(now, 3 * 3600, true)).toBe('1:52');
  });
});
