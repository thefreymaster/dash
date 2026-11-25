/**
 * Fakes for the sensors' browser seams (test-only helpers; not imported by app code).
 */
import type { DocLike, Timers } from './env';
import type { Fix } from '../types';

/** A `document` stand-in whose visibility can be flipped, firing `visibilitychange`. */
export function fakeDoc(initial: DocumentVisibilityState = 'visible') {
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    visibilityState: initial,
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    /** Change visibility and fire `visibilitychange`. */
    setVisible(visible: boolean) {
      doc.visibilityState = visible ? 'visible' : 'hidden';
      doc.fire('visibilitychange');
    },
    fire(type: string) {
      for (const l of [...(listeners.get(type) ?? [])]) l();
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
  return doc satisfies DocLike;
}

/** Manually advanced timers + clock. `advance(ms)` runs due intervals/timeouts in order. */
export function fakeTimers(start = 1_000_000) {
  let now = start;
  let nextId = 1;
  const tasks = new Map<number, { at: number; every: number | null; fn: () => void }>();
  const timers: Timers & { now: () => number; advance: (ms: number) => void; pending: () => number } = {
    now: () => now,
    setInterval(fn, ms) {
      const id = nextId++;
      tasks.set(id, { at: now + ms, every: ms, fn });
      return id;
    },
    clearInterval(id) {
      tasks.delete(id as number);
    },
    setTimeout(fn, ms) {
      const id = nextId++;
      tasks.set(id, { at: now + ms, every: null, fn });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let dueId: number | null = null;
        let dueAt = Infinity;
        for (const [id, t] of tasks) {
          if (t.at <= end && t.at < dueAt) {
            dueAt = t.at;
            dueId = id;
          }
        }
        if (dueId === null) break;
        const task = tasks.get(dueId)!;
        now = task.at;
        if (task.every === null) tasks.delete(dueId);
        else task.at += task.every;
        task.fn();
      }
      now = end;
    },
    pending: () => tasks.size,
  };
  return timers;
}

/** A fix with sensible defaults (San Francisco, accurate, timestamp 0). */
export function makeFix(overrides: Partial<Fix> = {}): Fix {
  return {
    lat: 37.7955,
    lng: -122.3937,
    speedMps: null,
    headingDeg: null,
    accuracyM: 5,
    timestamp: 0,
    ...overrides,
  };
}
