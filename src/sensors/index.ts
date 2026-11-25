/**
 * Sensors — public contract.
 *
 * Everything here writes into shared state (`telemetry`, `ui`, `pose` from `src/state`).
 * Nothing is returned to callers and nothing is passed as props.
 *
 *   geolocation.ts    GPS watch → fix pipeline → `telemetry` (≈1 Hz), stale detection
 *   simulator.ts      demo drive feeding the same pipeline (`telemetry.source = 'sim'`)
 *   compass.ts        orientation permission + landscape-corrected heading
 *   wakeLock.ts       keep the screen on
 *   motionLoop.ts     rAF loop: fixes → smooth 60 fps `pose`
 *   themeController   `settings.themeMode` (+ sun) → `ui.resolvedTheme`; runs from module
 *                     load so a manual day/night choice applies on the Start gate too
 */
import { initialTelemetry, settings, telemetry } from '../state';
import { requestCompassPermission, startCompass, stopCompass, type CompassPermission } from './compass';
import { safely } from './env';
import { startGeolocation, startStaleWatch, stopGeolocation, stopStaleWatch } from './geolocation';
import { startMotionLoop, stopMotionLoop } from './motionLoop';
import { parseDemoParam, startSimulator, stopSimulator } from './simulator';
import { startThemeController } from './themeController';
import { startWakeLock, stopWakeLock } from './wakeLock';

/** `?demo=1` in the launch URL: demo for this session only (never written to settings). */
const urlDemo: boolean = (() => {
  try {
    return typeof location !== 'undefined' && parseDemoParam(location.search);
  } catch {
    return false;
  }
})();

interface Session {
  id: number;
  source: 'gps' | 'sim' | null;
  unsubscribe: () => void;
}

let session: Session | null = null;
let sessionPromise: Promise<void> | null = null;
let nextSessionId = 1;

/** Run GPS or the simulator, stopping the other. No-op if `want` is already running. */
function selectSource(s: Session, want: 'gps' | 'sim'): void {
  if (session !== s || s.source === want) return;
  if (want === 'sim') {
    safely(stopGeolocation);
    safely(() => startSimulator());
  } else {
    safely(stopSimulator);
    safely(() => startGeolocation());
  }
  s.source = want;
}

async function run(s: Session): Promise<void> {
  // 1. Compass permission FIRST, synchronously: iOS only shows the prompt inside the gesture.
  let permission: Promise<CompassPermission>;
  try {
    permission = requestCompassPermission();
  } catch {
    permission = Promise.resolve('denied');
  }
  // 2. Wake lock: also gesture-bound on iOS, so requested before anything is awaited.
  safely(() => startWakeLock());
  // 3. Position source, stale watch, motion loop, theme.
  selectSource(s, isDemo() ? 'sim' : 'gps');
  safely(() => startStaleWatch());
  safely(() => startMotionLoop());
  safely(() => startThemeController());
  // Swap GPS ↔ simulator live when `settings.demo` changes.
  s.unsubscribe = settings.subscribe(() => selectSource(s, isDemo() ? 'sim' : 'gps'));
  // 4. Compass events once permitted.
  let answer: CompassPermission = 'denied';
  try {
    answer = await permission;
  } catch {
    // treated as denied
  }
  if (session !== s) return; // stopped while the prompt was up
  if (answer === 'granted') safely(() => startCompass());
}

/**
 * Start everything the cluster needs. MUST be called from inside a user gesture (the
 * Start button's click handler) because iOS only grants the compass permission and the
 * wake lock from a gesture.
 *
 * Requests compass permission first (synchronously), then the wake lock, starts GPS — or
 * the simulated drive in demo mode — plus the stale watch, the per-frame motion loop and
 * the theme controller; compass events start once permission is granted. Idempotent:
 * repeated calls return the same promise. Never throws; failures show up in
 * `telemetry.status` (`denied` / `unavailable`) or simply leave `compassDeg` null.
 */
export async function startSensors(): Promise<void> {
  if (sessionPromise) return sessionPromise;
  const s: Session = { id: nextSessionId++, source: null, unsubscribe: () => {} };
  session = s;
  sessionPromise = run(s).catch(() => {});
  return sessionPromise;
}

/**
 * Stop all watchers, loops and locks started by `startSensors`, and reset `telemetry` to
 * `idle`. The theme controller keeps running (a manual theme must still apply). Idempotent.
 */
export function stopSensors(): void {
  const s = session;
  session = null;
  sessionPromise = null;
  if (s) safely(s.unsubscribe);
  safely(stopCompass);
  safely(stopGeolocation);
  safely(stopSimulator);
  safely(stopStaleWatch);
  safely(stopMotionLoop);
  safely(stopWakeLock);
  safely(() => telemetry.set(initialTelemetry));
}

/** True when the simulated drive is (or will be) the position source: `?demo=1` or `settings.demo`. */
export function isDemo(): boolean {
  return urlDemo || settings.get().demo === true;
}

/** `true` between `startSensors()` and `stopSensors()`. */
export function sensorsRunning(): boolean {
  return session !== null;
}

// Keep `ui.resolvedTheme` right from the first render (Start gate included).
if (typeof window !== 'undefined') safely(() => startThemeController());
