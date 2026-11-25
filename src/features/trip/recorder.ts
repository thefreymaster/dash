/**
 * T24 Trip recorder — `telemetry` fixes (≈1 Hz) → the trip entry of the fix's source.
 *
 *   source 'gps'  → `trip` (src/state, persisted to localStorage)
 *   source 'sim'  → `simTrip` (in memory); the persisted trip is left untouched
 *
 * Starts itself when this module is first imported in a browser (the trip feature's
 * `index.ts` imports it), so no other feature has to call it. A module-level subscription
 * is unaffected by React StrictMode. Hot reload cannot leave two subscriptions behind: the
 * module's previous copy is stopped through a handle on `globalThis` before a new one
 * starts, and `import.meta.hot.dispose` stops it too.
 *
 * Writes: at most one per fix, and none when the step changed nothing (parked, glitches,
 * inaccurate fixes) — `stepTrip` returns the same trip object then.
 */
import { telemetry } from '../../state';
import type { Fix, Telemetry } from '../../types';
import { stepTrip } from './accumulate';
import { tripFor } from './state';

interface Recorder {
  /** Source of the last fix seen; a change drops the anchor (no segment across sources). */
  source: Telemetry['source'] | null;
  /** Fix the next segment is measured from. */
  anchor: Fix | null;
  /** Last `telemetry.fix` reference handled (telemetry also changes for status/compass). */
  lastFix: Fix | null | undefined;
  unsubscribe: () => void;
}

const HANDLE = Symbol.for('dash.tripRecorder.stop');
type GlobalWithHandle = typeof globalThis & { [HANDLE]?: () => void };

let active: Recorder | null = null;

function handle(r: Recorder, t: Telemetry): void {
  if (t.fix === r.lastFix) return;
  r.lastFix = t.fix;
  if (t.source !== r.source) {
    r.source = t.source;
    r.anchor = null;
  }
  if (!t.fix) {
    r.anchor = null; // the source was (re)started: the next fix is a fresh start
    return;
  }
  const entry = tripFor(t.source);
  const current = entry.get();
  const step = stepTrip(current, r.anchor, t.fix);
  r.anchor = step.anchor;
  if (step.trip !== current) entry.set(step.trip);
}

/** Start recording. Idempotent; also replaces a recorder left by a previous copy of this module. */
export function startTripRecorder(): void {
  if (active) return;
  const g = globalThis as GlobalWithHandle;
  g[HANDLE]?.();
  const r: Recorder = { source: null, anchor: null, lastFix: undefined, unsubscribe: () => {} };
  active = r;
  g[HANDLE] = stopTripRecorder;
  handle(r, telemetry.get());
  r.unsubscribe = telemetry.subscribe((t) => handle(r, t));
}

/** Stop recording. Idempotent. */
export function stopTripRecorder(): void {
  const r = active;
  if (!r) return;
  active = null;
  r.unsubscribe();
  const g = globalThis as GlobalWithHandle;
  if (g[HANDLE] === stopTripRecorder) delete g[HANDLE];
}

/** `true` while this module's recorder is subscribed. */
export function isTripRecorderRunning(): boolean {
  return active !== null;
}

if (typeof window !== 'undefined') startTripRecorder();
if (import.meta.hot) import.meta.hot.dispose(() => stopTripRecorder());
