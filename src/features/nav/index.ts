/**
 * Navigation — public contract.
 *
 * Components take NO props. Intent lives in `nav` / `recents` from `src/state`; the route is
 * server state (`useRoute` in `src/api/directions.ts`); search uses `src/api/search.ts`.
 *
 *   ManeuverBanner          next-turn banner (arrow, distance, street) + route status / arrival.
 *                           Rendered by the top-centre slot while navigating.
 *   EtaChip                 arrival time, time and distance left, destination, cancel (44 px).
 *                           Rendered by the bottom-right slot while navigating.
 *   DestinationSearch       search sheet; rendered once in the overlay slot, shows itself when opened.
 *   NavEngine               invisible: route query, progress tracking, reroute, map line + pin,
 *                           route overview, arrival, demo hand-off. Rendered once in the overlay slot.
 *   openDestinationSearch() open the search sheet (the road-name pill calls it).
 *   closeDestinationSearch(), searchOpen   close it / whether it is open (the shell keeps one
 *                           sheet open at a time).
 *   useIsNavigating()       true while a destination is set (slots swap road ↔ banner, trip ↔ ETA).
 *   endNavigation()         clear the destination (what the ETA chip's cancel button does).
 */
import { nav } from '../../state';
import { closeSearchSheet, openSearchSheet } from './navState';

export { ManeuverBanner } from './ManeuverBanner';
export { EtaChip } from './EtaChip';
export { DestinationSearch } from './DestinationSearch';
export { NavEngine } from './NavEngine';
export { endNavigation, retryRoute } from './actions';
export { navView, searchOpen } from './navState';
export type { NavView, RouteStatus } from './navState';

/** Open the destination search sheet. Called by the road-name pill. */
export function openDestinationSearch(): void {
  openSearchSheet();
}

/** Close the destination search sheet (the shell closes it when another sheet opens). */
export function closeDestinationSearch(): void {
  closeSearchSheet();
}

/** True while a destination is set. Slots use it to swap road name ↔ banner and trip ↔ ETA. */
export function useIsNavigating(): boolean {
  return nav.use((n) => n.destination !== null);
}

// DEV ONLY: fixture harness + console hooks (`window.__dashNav`), never in production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') void import('./dev/devNav');
