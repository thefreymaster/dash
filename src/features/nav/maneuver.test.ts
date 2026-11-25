import { describe, expect, it } from 'vitest';
import type { RouteStep } from '../../api/directions';
import { mphToMps } from '../../lib';
import { arrivalClock, formatMinutes, nextParked } from './format';
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
  it('locks at 3 mph and unlocks only below 2 mph', () => {
    expect(nextParked(true, 0)).toBe(true);
    expect(nextParked(true, mphToMps(2.9))).toBe(true);
    expect(nextParked(true, mphToMps(3))).toBe(false);
    expect(nextParked(false, mphToMps(2.5))).toBe(false); // hysteresis
    expect(nextParked(false, mphToMps(1.9))).toBe(true);
    expect(nextParked(false, Number.NaN)).toBe(true);
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
