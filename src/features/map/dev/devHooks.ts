/**
 * DEV-only console / automation hook (loaded by MapView only when `import.meta.env.DEV`).
 * Lets you drive the map without the sensors layer, e.g. from the browser console:
 *
 *   __dashMap.setPose({ lat: 37.7749, lng: -122.4194, headingDeg: 90, speedMps: 12 })
 *   __dashMap.ui.set((s) => ({ ...s, following: true }))
 *   __dashMap.settings.set((s) => ({ ...s, themeMode: 'night' }))
 */
import { pose, settings, telemetry, ui } from '../../../state';
import { getMap } from '../mapInstance';

export interface DevPose {
  lat: number;
  lng: number;
  headingDeg?: number;
  speedMps?: number;
  accuracyM?: number;
}

/** Write the pose Motion values (dev only — in the app only the sensors loop writes them). */
export function setPose(p: DevPose): void {
  pose.lat.set(p.lat);
  pose.lng.set(p.lng);
  if (p.headingDeg !== undefined) pose.headingDeg.set(p.headingDeg);
  if (p.speedMps !== undefined) pose.speedMps.set(p.speedMps);
  if (p.accuracyM !== undefined) pose.accuracyM.set(p.accuracyM);
  pose.hasPose.set(true);
}

const hook = { pose, ui, settings, telemetry, getMap, setPose };

declare global {
  interface Window {
    __dashMap?: typeof hook;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') window.__dashMap = hook;
