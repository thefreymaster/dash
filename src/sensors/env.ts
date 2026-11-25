/**
 * Thin seams over the browser globals the sensors use, so every driver can be handed fakes
 * in tests (vitest runs in the node environment: no `document`, `window` or `navigator`).
 * Nothing here holds state.
 */

/** The bits of `document` the sensors need: visibility and plain event listeners. */
export interface DocLike {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: () => void, options?: EventListenerOptions | boolean): void;
}

/** The real `document`, or `null` outside a browser. */
export function browserDocument(): DocLike | null {
  return typeof document === 'undefined' ? null : document;
}

/** `true` when there is no document (tests) or it is visible. */
export function isVisible(doc: DocLike | null): boolean {
  return doc === null || doc.visibilityState === 'visible';
}

/**
 * Call `onChange(visible)` on every `visibilitychange`. Returns an unsubscribe function.
 * No-op without a document.
 */
export function onVisibilityChange(doc: DocLike | null, onChange: (visible: boolean) => void): () => void {
  if (!doc) return () => {};
  const listener = () => onChange(doc.visibilityState === 'visible');
  doc.addEventListener('visibilitychange', listener);
  return () => doc.removeEventListener('visibilitychange', listener);
}

/** Timer functions, injectable for tests. */
export interface Timers {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export const browserTimers: Timers = {
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>),
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
};

/** Run `fn`, swallowing anything it throws (sensors must never break the app). */
export function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // A sensor API misbehaving must not take the cluster down.
  }
}
