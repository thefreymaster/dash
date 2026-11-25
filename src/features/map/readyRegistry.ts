/**
 * "Run this once the value is ready" registry behind `whenMapReady` / `getMap`.
 * Callbacks registered before `resolve` run once, in registration order, when it is called;
 * after that `when` runs the callback immediately (synchronously). A throwing callback is
 * logged and does not stop the others.
 */
export interface ReadyRegistry<T> {
  /** The resolved value, or `null` before `resolve` (and after `reset`). */
  get(): T | null;
  /** Run `cb` once the value is ready (immediately if it is). Returns an unsubscribe function. */
  when(cb: (value: T) => void): () => void;
  /** Mark ready and flush pending callbacks. */
  resolve(value: T): void;
  /** Back to "not ready" (pending callbacks are kept). */
  reset(): void;
}

export function createReadyRegistry<T>(label = 'ready'): ReadyRegistry<T> {
  let value: T | null = null;
  // Wrapped so the same function can be registered twice and unsubscribed independently.
  const pending = new Set<{ cb: (value: T) => void }>();

  const run = (cb: (value: T) => void, v: T) => {
    try {
      cb(v);
    } catch (error) {
      console.error(`[${label}] callback failed`, error);
    }
  };

  return {
    get: () => value,
    when(cb) {
      if (value !== null) {
        run(cb, value);
        return () => {};
      }
      const entry = { cb };
      pending.add(entry);
      return () => {
        pending.delete(entry);
      };
    },
    resolve(v) {
      value = v;
      const entries = [...pending];
      pending.clear();
      for (const entry of entries) run(entry.cb, v);
    },
    reset() {
      value = null;
    },
  };
}
