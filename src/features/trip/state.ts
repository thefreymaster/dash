/**
 * Trip feature state.
 *
 *   trip      (src/state, persisted)  the real trip, recorded from GPS fixes
 *   simTrip   (here, in memory)       the demo drive's trip; the persisted one is never touched
 *                                     while `telemetry.source === 'sim'`
 *   tripSheetOpen                     whether the pill is expanded into the sheet
 *
 * The UI always shows the trip of the CURRENT source (`useTripValue`), and Reset resets that
 * one (`resetShownTrip`).
 */
import { defineClientState, initialTrip, telemetry, trip } from '../../state';
import type { Telemetry, Trip } from '../../types';

/** The demo drive's trip. Not persisted: a reload starts a new demo trip. */
export const simTrip = defineClientState<Trip>('trip.sim', initialTrip);

/** The trip sheet is expanded. Feature-local UI state, not persisted. */
export const tripSheetOpen = defineClientState<boolean>('trip.sheetOpen', false);

/** DOM ids, so focus can move between the pill and the sheet without passing refs around. */
export const TRIP_PILL_ID = 'dash-trip-pill';
export const TRIP_SHEET_ID = 'dash-trip-sheet';
export const TRIP_CLOSE_ID = 'dash-trip-close';

/** The trip entry that fixes from `source` are recorded into (and the UI shows). */
export function tripFor(source: Telemetry['source']) {
  return source === 'sim' ? simTrip : trip;
}

let moveFocus = false;

/** Expand the pill. Keyboard focus on the pill moves to the sheet's close button. */
export function openTripSheet(): void {
  moveFocus = typeof document !== 'undefined' && document.activeElement?.id === TRIP_PILL_ID;
  tripSheetOpen.set(true);
}

/** Collapse the sheet. Focus inside the sheet returns to the pill. */
export function closeTripSheet(): void {
  if (!tripSheetOpen.get()) return;
  moveFocus =
    typeof document !== 'undefined' &&
    !!document.getElementById(TRIP_SHEET_ID)?.contains(document.activeElement);
  tripSheetOpen.set(false);
}

/** `true` once after an open/close that should move keyboard focus. */
export function takeFocusMove(): boolean {
  const move = moveFocus;
  moveFocus = false;
  return move;
}

/** Reset the trip currently shown (the demo trip while driving the simulator). */
export function resetShownTrip(): void {
  tripFor(telemetry.get().source).reset();
}

/**
 * React hook: `selector` applied to the trip currently shown. Re-renders only when the
 * selected value (or the source) changes — select exactly what the element displays.
 */
export function useTripValue<S>(selector: (t: Trip) => S): S {
  const demo = telemetry.use((t) => t.source === 'sim');
  const real = trip.use(selector);
  const sim = simTrip.use(selector);
  return demo ? sim : real;
}
