/**
 * Full-bleed map (T12). Fills its positioned parent (absolute, inset 0) and is its own stacking
 * context at z-index 0 — layer the HUD above it.
 *
 * With a Mapbox token it hosts the app's single `mapboxgl.Map` (see `mapInstance.ts`).
 * Without one (`hasMapboxToken` false) no map is constructed: the themed land colour fills the
 * screen (the HUD shows `MapNotice`); the rest of the app keeps working.
 */
import 'mapbox-gl/dist/mapbox-gl.css';
import './map.css';
import { Box } from '@chakra-ui/react';
import { useEffect, useRef } from 'react';
import { isMapEnabled, mountMap } from './mapInstance';

if (import.meta.env.DEV) void import('./dev/devHooks');

export function MapView() {
  return isMapEnabled() ? <LiveMap /> : <NoTokenMap />;
}

function LiveMap() {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    return mountMap(host);
  }, []);
  return <Box ref={hostRef} className="dash-map" bg="mapLand" />;
}

function NoTokenMap() {
  // The "Map off" notice is part of the HUD (`MapNotice`, placed in the bottom strip).
  return <Box className="dash-map" bg="mapLand" />;
}
