/**
 * SLOT · full-screen layer above the HUD (below the settings sheet and rotate prompt).
 * Owner: navigation (T26–T29).
 *
 *   NavEngine          invisible: route query, progress, reroute, route line, overview,
 *                      arrival — mounted once here so it runs for the whole cluster session.
 *   DestinationSearch  the search sheet (mockup `.w-search`), shown by `openDestinationSearch()`.
 *
 * The layer itself ignores pointer events; the sheet turns them on for itself and its
 * tap-outside backdrop. It positions against the `--hud-l/r/t/b` CSS variables.
 */
import { DestinationSearch, NavEngine } from '../../nav';

export function OverlaySlot() {
  return (
    <>
      <NavEngine />
      <DestinationSearch />
    </>
  );
}
