/**
 * DEV ONLY. A minimal token-free style for the harness (`harness.html?local`), so the camera,
 * puck, recenter chip, attribution placement and `whenMapReady` can be exercised without a
 * Mapbox token.
 *
 * NOTE: Mapbox GL JS v3 clears and stops drawing its canvas when the access-token check fails
 * (`Map#_revokeAuth`, part of Mapbox's ToS-protected code), so without a token the canvas stays
 * blank — only the DOM parts (puck, chip, attribution) and the camera numbers are visible.
 * With a token, drop `local` to see the real Standard style.
 */
import type { StyleSpecification } from 'mapbox-gl';
import { glassPalette } from '../../../theme';
import type { ResolvedTheme } from '../../../types';

export function buildLocalStyle(theme: ResolvedTheme): StyleSpecification {
  return {
    version: 8,
    name: 'dash-dev-local',
    projection: { name: 'mercator' },
    sources: {},
    layers: [{ id: 'land', type: 'background', paint: { 'background-color': glassPalette[theme].mapLand } }],
  };
}
