/**
 * The Mapbox token navigation uses: `MAPBOX_TOKEN` from `.env.local`. In development only,
 * the fixture harness (`dev/devNav.ts`) can supply a placeholder so the search and route UI
 * can be exercised against doc-shaped fixture responses without a real token. Production
 * builds never read the override (`import.meta.env.DEV` is statically false there).
 */
import { MAPBOX_TOKEN } from '../../api/client';

let devToken = '';

/** Token for Search Box / Directions requests, or '' when none is configured. */
export function navToken(): string {
  if (MAPBOX_TOKEN) return MAPBOX_TOKEN;
  return import.meta.env.DEV ? devToken : '';
}

/** DEV ONLY: pretend a token exists (fixture responses are served by the dev harness). */
export function __setDevNavToken(token: string): void {
  if (import.meta.env.DEV) devToken = token;
}
