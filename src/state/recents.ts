/**
 * Recently chosen destinations, newest first, persisted (`dash:v1:recents`), at most
 * `MAX_RECENTS`. Add with `addRecent(place)` rather than `recents.set` so the list stays
 * de-duplicated and capped.
 */
import type { Place } from '../types';
import { defineClientState } from './clientState';

export const MAX_RECENTS = 8;

const isPlace = (p: unknown): p is Place => {
  if (typeof p !== 'object' || p === null) return false;
  const v = p as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lng) &&
    (v.address === undefined || typeof v.address === 'string')
  );
};

export const recents = defineClientState<Place[]>('recents', [], {
  persist: true,
  sanitize: (stored) => stored.filter(isPlace).slice(0, MAX_RECENTS),
});

/** Same place: same id, or same coordinates to ~1 m (ids can change between geocoder sessions). */
const samePlace = (a: Place, b: Place): boolean =>
  a.id === b.id || (Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5);

/** Put `place` at the front of recents, removing any earlier copy, capped at `MAX_RECENTS`. */
export function addRecent(place: Place): void {
  recents.set((prev) => [place, ...prev.filter((p) => !samePlace(p, place))].slice(0, MAX_RECENTS));
}
