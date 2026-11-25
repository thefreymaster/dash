/**
 * Trip computer — public contract.
 *
 *   TripStrip   trip pill (distance · moving time) that expands in place into the trip sheet
 *               (distance, moving time, average, max, reset). Takes NO props; rendered by the
 *               bottom-right slot when not navigating.
 *
 * Importing this module starts the trip recorder (`recorder.ts`): GPS fixes accumulate into
 * the persisted `trip` entry from `src/state`; demo-drive fixes into an in-memory trip that
 * the UI shows instead while the simulator is the source. Nobody has to start it.
 */
import './recorder';

export { TripStrip } from './TripStrip';
export { useTripValue, resetShownTrip, tripSheetOpen, closeTripSheet } from './state';
export { averageSpeedMps } from './accumulate';
