/**
 * Maneuver → icon and wording for the banner (pure).
 *
 * Icons: one drawing per shape; the left-hand variants are the right-hand drawings mirrored
 * (`mirrored: true`), so the set is straight, slight/normal/sharp turn, U-turn, merge,
 * roundabout, arrive.
 * Wording: a short verb phrase + an optional bold target, e.g. "Turn right onto" **Elm St**,
 * "Take exit 2 onto" **Main St**, "Arrive at" **Blue Bottle Coffee**. Kept short: the banner
 * has ~250 px of text at 15 px.
 */
import type { RouteStep } from '../../api/directions';

export type ManeuverShape = 'straight' | 'slight' | 'turn' | 'sharp' | 'uturn' | 'merge' | 'roundabout' | 'arrive';

export interface ManeuverIcon {
  shape: ManeuverShape;
  /** Draw mirrored (left-hand version of a right-hand drawing). */
  mirrored: boolean;
}

const LEFT = new Set(['left', 'slight left', 'sharp left']);

/** Icon for a Directions maneuver `type` + `modifier`. */
export function maneuverIcon(type: string, modifier: string | null): ManeuverIcon {
  const m = modifier ?? '';
  const left = LEFT.has(m);
  switch (type) {
    case 'arrive':
      return { shape: 'arrive', mirrored: false };
    case 'roundabout':
    case 'rotary':
      return { shape: 'roundabout', mirrored: false };
    case 'merge':
      return { shape: 'merge', mirrored: left };
    case 'depart':
      return { shape: 'straight', mirrored: false };
    default:
      break;
  }
  switch (m) {
    case 'uturn':
      return { shape: 'uturn', mirrored: false };
    case 'sharp right':
    case 'sharp left':
      return { shape: 'sharp', mirrored: left };
    case 'right':
    case 'left':
      // Ramps and forks are drawn as gentle bears even when Mapbox says "right".
      return { shape: type === 'fork' || type === 'on ramp' || type === 'off ramp' ? 'slight' : 'turn', mirrored: left };
    case 'slight right':
    case 'slight left':
      return { shape: 'slight', mirrored: left };
    default:
      return { shape: 'straight', mirrored: false };
  }
}

export interface ManeuverPhrase {
  /** e.g. "Turn right". */
  verb: string;
  /** Word joining the verb and the target when there is one: "onto", "at", "toward". */
  joiner: string;
  /** Bold target (street / destination), or `null` → show the verb alone. */
  target: string | null;
}

const side = (m: string) => (m.includes('left') ? 'left' : 'right');

function turnVerb(m: string): string {
  switch (m) {
    case 'uturn':
      return 'Make a U-turn';
    case 'sharp right':
    case 'sharp left':
      return `Make a sharp ${side(m)}`;
    case 'right':
    case 'left':
      return `Turn ${m}`;
    case 'slight right':
    case 'slight left':
      return `Bear ${side(m)}`;
    default:
      return 'Continue';
  }
}

const ordinal = (n: number) => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/** Wording for a step's maneuver. `destinationName` is used for the arrival. */
export function maneuverPhrase(step: Pick<RouteStep, 'maneuver' | 'label'>, destinationName: string | null): ManeuverPhrase {
  const { type, exit } = step.maneuver;
  const m = step.maneuver.modifier ?? '';
  const target = step.label.trim() || null;
  const onto = (verb: string): ManeuverPhrase => ({ verb, joiner: 'onto', target });
  switch (type) {
    case 'arrive':
      return { verb: destinationName ? 'Arrive at' : 'Arrive at your destination', joiner: '', target: destinationName };
    case 'depart':
      return onto('Head out');
    case 'merge':
      return onto('Merge');
    case 'on ramp':
      return onto(m.includes('left') ? 'Take the ramp on the left' : 'Take the ramp');
    case 'off ramp':
      return onto(m.includes('left') ? 'Take the exit on the left' : 'Take the exit');
    case 'fork':
      return onto(m.includes('left') || m.includes('right') ? `Keep ${side(m)}` : 'Keep straight');
    case 'roundabout':
    case 'rotary':
      return onto(exit ? `Take the ${ordinal(exit)} exit` : 'Enter the roundabout');
    case 'exit roundabout':
    case 'exit rotary':
      return onto('Exit the roundabout');
    case 'new name':
    case 'notification':
      return onto('Continue');
    case 'continue':
      return onto(m === 'straight' || m === '' ? 'Continue' : m.startsWith('slight') ? `Keep ${side(m)}` : turnVerb(m));
    case 'end of road':
    case 'turn':
    case 'roundabout turn':
    default:
      return onto(m === 'straight' ? 'Go straight' : turnVerb(m));
  }
}

/** One-line plain text of a phrase (accessibility label, tests). */
export function phraseText(p: ManeuverPhrase): string {
  if (!p.target) return p.verb;
  return p.joiner ? `${p.verb} ${p.joiner} ${p.target}` : `${p.verb} ${p.target}`;
}
