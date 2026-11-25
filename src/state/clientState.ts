/**
 * Client state that lives in the TanStack Query cache.
 *
 * Dash has no state library besides TanStack Query, so app-wide client state (settings,
 * telemetry, trip, nav, UI) is stored as query data under `['client', key]` and is never
 * fetched. `defineClientState` wraps the cache in a tiny typed API that works both inside
 * React (`use`) and outside it (`get` / `set` / `subscribe` — sensors, timers, the rAF loop):
 *
 *   export const settings = defineClientState<Settings>('settings', initial, { persist: true });
 *   settings.use();                       // hook → whole value, always defined
 *   settings.use((s) => s.units);         // hook + selector → re-renders only when the selection changes
 *   settings.get();                       // read anywhere
 *   settings.set({ ...next });            // replace
 *   settings.set((prev) => ({ ...prev, units: 'kmh' }));  // functional update
 *   settings.subscribe((value) => {});    // non-React listener; returns unsubscribe
 *   settings.reset();                     // back to the initial value
 *
 * Guarantees
 *   - `use()` never fetches and never shows a loading state: the entry is seeded when it is
 *     defined, queries are `enabled: false` with `staleTime: 'static'` (so even a global
 *     `invalidateQueries()` / `refetchQueries()` skips them) and `gcTime: Infinity`.
 *   - `set()` is synchronous: `get()` returns the new value immediately and `subscribe`
 *     listeners run before `set()` returns. React components re-render on the next tick
 *     (TanStack batches observer notifications).
 *   - Values are compared by reference and structurally shared (TanStack's
 *     `replaceEqualDeep`): setting a deep-equal value keeps the old reference, notifies
 *     nobody and does not re-render. Selectors may return new objects/arrays — deep-equal
 *     results keep their previous reference.
 *   - Values must be plain JSON data (no functions, Maps, class instances, `undefined` at
 *     the top level). Treat them as immutable: always produce a new object in `set`.
 *   - Always write through the entry's `set`. Writing the cache directly with
 *     `queryClient.setQueryData(entry.queryKey, …)` works for readers but skips persistence.
 *
 * Persistence (`persist: true`)
 *   The value is read from `localStorage` once, when the entry is defined, and written back
 *   on every `set` (no persister packages — this is a deliberate decision). Keys are
 *   `dash:v<STORAGE_VERSION>:<key>`. Every storage access is wrapped in try/catch (private
 *   mode, quota, disabled storage). Corrupt JSON falls back to the initial value. For object
 *   values the stored object is shallow-merged onto the initial value, and any field whose
 *   type no longer matches the initial value's field is reset — so adding/removing/retyping
 *   fields between releases is safe. Pass `sanitize` for deeper validation (e.g. enum values).
 *   Bump `STORAGE_VERSION` only to deliberately discard all stored data.
 *
 * Per-frame values (60 Hz position/heading/speed for the camera and speedo) must NOT go
 * through here — use the Motion values in `state/pose.ts`.
 */
import { hashKey, useQuery, type QueryClient } from '@tanstack/react-query';
import { queryClient as defaultClient } from './queryClient';

/** Version segment of every persisted key. Bump to discard all previously stored client state. */
export const STORAGE_VERSION = 1;

/** Namespace for persisted keys. */
export const STORAGE_PREFIX = `dash:v${STORAGE_VERSION}:`;

/** Root of every client-state query key: `['client', key]`. */
export const CLIENT_STATE_ROOT = 'client';

export type ClientStateKey = readonly [typeof CLIENT_STATE_ROOT, string];

/** A new value, or a function from the previous value to the new one. */
export type ClientStateUpdate<T> = T | ((prev: T) => T);

export interface ClientStateOptions<T> {
  /** Load from and save to `localStorage`. Default `false`. */
  persist?: boolean;
  /**
   * Extra validation for a value read from storage, after the shallow merge. Return the
   * value to use (fix up or fall back to `initial`). Only called for persisted entries.
   */
  sanitize?: (stored: T, initial: T) => T;
  /** QueryClient to store into. Defaults to the app's singleton; tests pass a fresh one. */
  client?: QueryClient;
}

export interface ClientState<T> {
  /** The key passed to `defineClientState`. */
  readonly key: string;
  /** Full query key, `['client', key]` — for devtools or `useIsFetching`-style filters. */
  readonly queryKey: ClientStateKey;
  /** The initial value (before persistence was applied). */
  readonly initial: T;
  /** `localStorage` key when persisted, otherwise `null`. */
  readonly storageKey: string | null;

  /** React hook: the whole value. Always defined, never loading. */
  use(): T;
  /**
   * React hook with a selector: returns `selector(value)` and re-renders only when that
   * result changes (deep-equal results count as unchanged). Keep selectors pure and cheap.
   */
  use<S>(selector: (value: T) => S): S;
  /** Current value, synchronously. Safe outside React. */
  get(): T;
  /** Replace the value, or update it from the previous one. Persists if enabled. */
  set(update: ClientStateUpdate<T>): void;
  /** Set back to `initial` (and persist that). */
  reset(): void;
  /** Listen for changes outside React. Called synchronously after each effective `set`. Returns unsubscribe. */
  subscribe(listener: (value: T) => void): () => void;
}

/**
 * Define one piece of client state. Call at module top level, once per key
 * (one `src/state/<name>.ts` file per entry). Re-defining an existing key (e.g. on Vite HMR)
 * keeps the value already in the cache.
 */
export function defineClientState<T>(
  key: string,
  initial: T,
  options: ClientStateOptions<T> = {},
): ClientState<T> {
  const client = options.client ?? defaultClient;
  const persist = options.persist === true;
  const queryKey: ClientStateKey = [CLIENT_STATE_ROOT, key];
  const queryHash = hashKey(queryKey);
  const storageKey = persist ? STORAGE_PREFIX + key : null;

  /** Value to use when the cache has no entry: stored value (if persisted) or `initial`. */
  const fallback = (): T => (storageKey ? loadStored(storageKey, initial, options.sanitize) : initial);

  // Defaults must be registered BEFORE seeding: `setQueryData` creates the query with them,
  // and without `gcTime: Infinity` an entry nobody renders would be garbage-collected.
  client.setQueryDefaults(queryKey, {
    queryFn: () => get(),
    staleTime: 'static',
    gcTime: Infinity,
    retry: false,
    networkMode: 'always',
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (client.getQueryData(queryKey) === undefined) {
    client.setQueryData(queryKey, fallback());
  }

  function get(): T {
    const value = client.getQueryData<T>(queryKey);
    return value === undefined ? fallback() : value;
  }

  function set(update: ClientStateUpdate<T>): void {
    const prev = get();
    const next = typeof update === 'function' ? (update as (prev: T) => T)(prev) : update;
    if (next === undefined || Object.is(next, prev)) return;
    client.setQueryData(queryKey, next);
    if (storageKey) {
      // Store what is actually in the cache (structural sharing may have kept `prev`).
      writeStored(storageKey, client.getQueryData<T>(queryKey));
    }
  }

  function reset(): void {
    set(initial);
  }

  function subscribe(listener: (value: T) => void): () => void {
    let last = client.getQueryData<T>(queryKey);
    return client.getQueryCache().subscribe((event) => {
      if (event.query.queryHash !== queryHash) return;
      if (event.type !== 'updated' && event.type !== 'added') return;
      const value = event.query.state.data as T | undefined;
      if (value === undefined || Object.is(value, last)) return;
      last = value;
      listener(value);
    });
  }

  // Named `use…` so the rules-of-hooks lint treats it as a hook.
  function useClientState<S>(selector?: (value: T) => S): S | T {
    const result = useQuery(
      {
        queryKey,
        queryFn: () => get(),
        initialData: fallback,
        enabled: false,
        staleTime: 'static',
        gcTime: Infinity,
        select: selector,
      },
      client,
    );
    // Always defined at runtime: the entry is seeded and `initialData` re-seeds it if the
    // cache was cleared. (TS cannot prove `T` is non-undefined for a generic `T`.)
    return result.data as S | T;
  }

  return {
    key,
    queryKey,
    initial,
    storageKey,
    use: useClientState as ClientState<T>['use'],
    get,
    set,
    reset,
    subscribe,
  };
}

// ---------------------------------------------------------------------------
// localStorage helpers (exported for tests)
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null; // SecurityError when storage is blocked
  }
}

/** Read and revive a stored value; any failure yields `initial`. */
export function loadStored<T>(
  storageKey: string,
  initial: T,
  sanitize?: (stored: T, initial: T) => T,
): T {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(storageKey) ?? null;
  } catch {
    return initial;
  }
  if (raw === null) return initial;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return initial;
  }
  const revived = reviveOnto(parsed, initial);
  if (!sanitize) return revived;
  try {
    return sanitize(revived, initial);
  } catch {
    return initial;
  }
}

/** Write a value; failures (quota, private mode) are ignored. */
export function writeStored(storageKey: string, value: unknown): void {
  try {
    storage()?.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — the in-memory value is still correct.
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `stored` and `reference` have the same JSON kind (null/undefined reference accepts anything). */
function sameKind(stored: unknown, reference: unknown): boolean {
  if (reference === null || reference === undefined) return true;
  if (Array.isArray(reference)) return Array.isArray(stored);
  if (isPlainObject(reference)) return isPlainObject(stored);
  return typeof stored === typeof reference;
}

/**
 * Make a parsed storage value fit the shape of `initial`:
 * objects are shallow-merged onto `initial` with mismatched fields reset; other kinds must
 * match `initial`'s kind or `initial` is returned.
 */
export function reviveOnto<T>(stored: unknown, initial: T): T {
  if (stored === null || stored === undefined) return initial;
  if (isPlainObject(initial)) {
    if (!isPlainObject(stored)) return initial;
    const merged: Record<string, unknown> = { ...initial, ...stored };
    for (const [field, reference] of Object.entries(initial)) {
      if (!sameKind(merged[field], reference)) merged[field] = reference;
    }
    return merged as T;
  }
  return sameKind(stored, initial) ? (stored as T) : initial;
}
