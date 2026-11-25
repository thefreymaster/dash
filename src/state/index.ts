/**
 * Shared state public API. Feature code imports from `src/state` only.
 *
 *   Client state (TanStack Query cache, see `clientState.ts`):
 *     telemetry, settings, trip, nav, recents (+ addRecent), ui
 *   Per-frame Motion values (see `pose.ts`):
 *     pose.{lat, lng, speedMps, headingDeg, accuracyM, hasPose, speedKnown}
 *   The QueryClient singleton and its retry policy:
 *     queryClient, shouldRetry, retryDelay, MAX_RETRIES
 */
export { queryClient, shouldRetry, retryDelay, MAX_RETRIES } from './queryClient';
export {
  defineClientState,
  loadStored,
  writeStored,
  reviveOnto,
  STORAGE_VERSION,
  STORAGE_PREFIX,
  CLIENT_STATE_ROOT,
} from './clientState';
export type {
  ClientState,
  ClientStateKey,
  ClientStateOptions,
  ClientStateUpdate,
} from './clientState';

export { telemetry, initialTelemetry } from './telemetry';
export { settings, initialSettings, UNITS, THEME_MODES } from './settings';
export { trip, initialTrip } from './trip';
export { nav, initialNav } from './nav';
export { recents, addRecent, MAX_RECENTS } from './recents';
export { ui, initialUi } from './ui';
export { pose, lat, lng, speedMps, headingDeg, accuracyM, hasPose, speedKnown } from './pose';
export type { Pose } from './pose';
