/**
 * T09 — Screen wake lock: keep the display on while the cluster runs.
 *
 * The system drops the lock whenever the page is hidden, so it is re-requested on
 * `visibilitychange` → visible. If a request is refused (iOS may want a fresh user gesture,
 * Low Power Mode, unsupported browser) it is retried once on the next tap. Everything fails
 * silently: a missing wake lock only means the screen may dim.
 */
import { browserDocument, isVisible, onVisibilityChange, safely, type DocLike } from './env';

/** The parts of `navigator.wakeLock` used here. */
export interface WakeLockApi {
  request(type: 'screen'): Promise<SentinelLike>;
}

/** The parts of `WakeLockSentinel` used here. */
export interface SentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockDeps {
  /** Defaults to `navigator.wakeLock`; `null` simulates no support. */
  api?: WakeLockApi | null;
  /** Defaults to `document`. */
  doc?: DocLike | null;
}

interface Session {
  api: WakeLockApi | null;
  doc: DocLike | null;
  sentinel: SentinelLike | null;
  pending: boolean;
  retryArmed: boolean;
  unlisten: () => void;
}

let session: Session | null = null;

function defaultApi(): WakeLockApi | null {
  try {
    const api = typeof navigator === 'undefined' ? undefined : (navigator as { wakeLock?: WakeLockApi }).wakeLock;
    return api && typeof api.request === 'function' ? api : null;
  } catch {
    return null;
  }
}

/** Ask for the lock if we want it, are visible, and do not already hold or await one. */
function acquire(s: Session): void {
  if (session !== s || !s.api || s.pending || !isVisible(s.doc)) return;
  if (s.sentinel && !s.sentinel.released) return;
  s.pending = true;
  let request: Promise<SentinelLike>;
  try {
    // Called synchronously so the first request happens inside the Start gesture.
    request = s.api.request('screen');
  } catch {
    s.pending = false;
    armRetry(s);
    return;
  }
  request.then(
    (sentinel) => {
      s.pending = false;
      if (session !== s) {
        sentinel.release().catch(() => {});
        return;
      }
      s.sentinel = sentinel;
      safely(() =>
        sentinel.addEventListener('release', () => {
          if (s.sentinel === sentinel) s.sentinel = null;
        }),
      );
    },
    () => {
      s.pending = false;
      armRetry(s);
    },
  );
}

/** After a refusal, try again on the next tap (a user gesture) — once per refusal. */
function armRetry(s: Session): void {
  if (session !== s || !s.doc || s.retryArmed) return;
  const doc = s.doc;
  s.retryArmed = true;
  const onTap = () => {
    doc.removeEventListener('pointerup', onTap);
    s.retryArmed = false;
    acquire(s);
  };
  doc.addEventListener('pointerup', onTap);
  const previousUnlisten = s.unlisten;
  s.unlisten = () => {
    previousUnlisten();
    doc.removeEventListener('pointerup', onTap);
  };
}

/**
 * Request the screen wake lock now (call inside the Start gesture) and keep re-acquiring it
 * whenever the page becomes visible again. Idempotent; never throws.
 */
export function startWakeLock(deps: WakeLockDeps = {}): void {
  if (session) return;
  const s: Session = {
    api: deps.api === undefined ? defaultApi() : deps.api,
    doc: deps.doc === undefined ? browserDocument() : deps.doc,
    sentinel: null,
    pending: false,
    retryArmed: false,
    unlisten: () => {},
  };
  session = s;
  if (!s.api) return;
  s.unlisten = onVisibilityChange(s.doc, (visible) => {
    if (visible) acquire(s);
  });
  acquire(s);
}

/** Release the lock and stop re-acquiring. Idempotent. */
export function stopWakeLock(): void {
  const s = session;
  if (!s) return;
  session = null;
  s.unlisten();
  const sentinel = s.sentinel;
  s.sentinel = null;
  if (sentinel && !sentinel.released) sentinel.release().catch(() => {});
}

/** `true` while a wake lock sentinel is held. */
export function hasWakeLock(): boolean {
  return !!session?.sentinel && !session.sentinel.released;
}
