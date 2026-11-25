/**
 * Display text for the road pill. Pure, tested in `roadLabel.test.ts`.
 *
 * The pill shows the name the way a street sign does (mockup: "MAIN ST" — the pill
 * uppercases it with CSS): common English street types and directionals are abbreviated
 * USPS-style, but only where they are suffixes/prefixes ("Main Street North" → "Main St N",
 * "Avenue of the Americas" stays). Motorways show their route number ("I 80") when they
 * have one, because that is what drivers know them by; other roads show their name.
 */
import type { RoadMatch } from '../../api/roadName';

const STREET_TYPES: Readonly<Record<string, string>> = {
  alley: 'Aly',
  avenue: 'Ave',
  boulevard: 'Blvd',
  causeway: 'Cswy',
  circle: 'Cir',
  court: 'Ct',
  crescent: 'Cres',
  drive: 'Dr',
  expressway: 'Expy',
  freeway: 'Fwy',
  highway: 'Hwy',
  lane: 'Ln',
  parkway: 'Pkwy',
  place: 'Pl',
  road: 'Rd',
  square: 'Sq',
  street: 'St',
  terrace: 'Ter',
  trail: 'Trl',
  turnpike: 'Tpke',
};

const DIRECTIONS: Readonly<Record<string, string>> = {
  north: 'N',
  south: 'S',
  east: 'E',
  west: 'W',
  northeast: 'NE',
  northwest: 'NW',
  southeast: 'SE',
  southwest: 'SW',
};

const lookup = (table: Readonly<Record<string, string>>, word: string | undefined): string | undefined =>
  word === undefined ? undefined : table[word.toLowerCase()];

/**
 * Abbreviate street types and directionals the way US street signs do.
 *   "Main Street" → "Main St", "North Main Street" → "N Main St",
 *   "Park Avenue South" → "Park Ave S", "North Street" → "North St".
 * A word is only abbreviated in suffix/prefix position, and never when it is the whole name.
 */
export function abbreviateRoadName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words.join(' ');

  let end = words.length; // exclusive end of the "core" name
  let trailingDir: string | undefined;
  const lastDir = lookup(DIRECTIONS, words[end - 1]);
  if (lastDir && end > 2) {
    trailingDir = lastDir;
    end -= 1;
  }
  const type = lookup(STREET_TYPES, words[end - 1]);
  if (type && end >= 2) words[end - 1] = type;
  const leadDir = lookup(DIRECTIONS, words[0]);
  if (leadDir && end - 1 >= 2) words[0] = leadDir;

  const core = words.slice(0, end);
  return trailingDir ? [...core, trailingDir].join(' ') : core.join(' ');
}

/** Text for the pill, e.g. "Main St" or "I 80". */
export function roadLabel(match: RoadMatch): string {
  if (match.roadClass === 'motorway' && match.ref) return match.ref;
  if (match.name) return abbreviateRoadName(match.name);
  return match.ref ?? '';
}

/** Words for screen readers: the full name (VoiceOver reads "St" as "Saint"). */
export function roadSpokenName(match: RoadMatch): string {
  return match.name ?? match.ref ?? '';
}
