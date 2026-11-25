import { QueryClient } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_PREFIX, defineClientState, reviveOnto } from './clientState';

interface Prefs {
  units: 'mph' | 'kmh';
  volume: number;
  tags: string[];
  last: number | null;
}

const INITIAL: Prefs = { units: 'mph', volume: 5, tags: [], last: null };

/** Minimal in-memory Storage. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

let client: QueryClient;
let store: Storage;

beforeEach(() => {
  client = new QueryClient();
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
});

afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

describe('get / set', () => {
  it('starts with the initial value', () => {
    const s = defineClientState('prefs', INITIAL, { client });
    expect(s.get()).toBe(INITIAL);
    expect(s.queryKey).toEqual(['client', 'prefs']);
    expect(client.getQueryData(['client', 'prefs'])).toBe(INITIAL);
  });

  it('replaces the value synchronously', () => {
    const s = defineClientState('prefs', INITIAL, { client });
    s.set({ ...INITIAL, units: 'kmh' });
    expect(s.get().units).toBe('kmh');
  });

  it('supports functional updates based on the latest value', () => {
    const s = defineClientState('counter', 0, { client });
    s.set((n) => n + 1);
    s.set((n) => n + 1);
    expect(s.get()).toBe(2);
  });

  it('keeps the old reference for deep-equal values', () => {
    const s = defineClientState('prefs', INITIAL, { client });
    s.set({ ...INITIAL, tags: [] });
    expect(s.get()).toBe(INITIAL);
  });

  it('reset() returns to the initial value', () => {
    const s = defineClientState('prefs', INITIAL, { client });
    s.set({ ...INITIAL, volume: 9 });
    s.reset();
    expect(s.get()).toEqual(INITIAL);
  });

  it('re-defining a key keeps the cached value (HMR)', () => {
    const a = defineClientState('prefs', INITIAL, { client });
    a.set({ ...INITIAL, volume: 7 });
    const b = defineClientState('prefs', INITIAL, { client });
    expect(b.get().volume).toBe(7);
  });

  it('falls back to the initial value if the cache was cleared', () => {
    const s = defineClientState('prefs', INITIAL, { client });
    client.clear();
    expect(s.get()).toEqual(INITIAL);
    s.set((p) => ({ ...p, volume: 1 }));
    expect(s.get().volume).toBe(1);
  });
});

describe('subscribe', () => {
  it('notifies synchronously with the new value, and unsubscribes', () => {
    const s = defineClientState('prefs', INITIAL, { client });
    const seen: Prefs[] = [];
    const off = s.subscribe((v) => seen.push(v));
    s.set((p) => ({ ...p, volume: 6 }));
    expect(seen).toHaveLength(1);
    expect(seen[0].volume).toBe(6);
    off();
    s.set((p) => ({ ...p, volume: 7 }));
    expect(seen).toHaveLength(1);
  });

  it('does not fire for no-op sets or for other entries', () => {
    const a = defineClientState('a', INITIAL, { client });
    const b = defineClientState('b', 0, { client });
    const listener = vi.fn();
    a.subscribe(listener);
    a.set(a.get());
    a.set({ ...INITIAL }); // deep-equal → structurally shared → no change
    b.set(5);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('never fetches', () => {
  it('stays idle/success with infinite gcTime, even after a global refetch', async () => {
    const s = defineClientState('prefs', INITIAL, { client });
    s.set((p) => ({ ...p, volume: 3 }));
    const query = client.getQueryCache().find({ queryKey: s.queryKey })!;
    expect(query.options.gcTime).toBe(Infinity);
    expect(query.state.status).toBe('success');

    await client.invalidateQueries();
    await client.refetchQueries();
    expect(s.get().volume).toBe(3);
    expect(client.getQueryState(s.queryKey)?.fetchStatus).toBe('idle');
    expect(client.getQueryState(s.queryKey)?.status).toBe('success');
  });
});

describe('use() hook', () => {
  it('renders the value synchronously on the first render, with and without a selector', () => {
    const s = defineClientState('prefs', INITIAL, { client });
    s.set((p) => ({ ...p, units: 'kmh', volume: 4 }));

    function Probe() {
      const all = s.use();
      const units = s.use((p) => p.units);
      const doubled = s.use((p) => p.volume * 2);
      return (
        <i>
          {all.volume}|{units}|{doubled}
        </i>
      );
    }

    expect(renderToStaticMarkup(<Probe />)).toBe('<i>4|kmh|8</i>');
    expect(client.isFetching()).toBe(0);
  });
});

describe('persistence', () => {
  it('round-trips through localStorage under a versioned key', () => {
    const a = defineClientState('prefs', INITIAL, { client, persist: true });
    expect(a.storageKey).toBe(`${STORAGE_PREFIX}prefs`);
    expect(STORAGE_PREFIX).toBe('dash:v1:');
    a.set((p) => ({ ...p, units: 'kmh', tags: ['x'] }));
    expect(JSON.parse(store.getItem('dash:v1:prefs')!)).toEqual({ ...INITIAL, units: 'kmh', tags: ['x'] });

    // A fresh app start (new cache) loads it back.
    const b = defineClientState('prefs', INITIAL, { client: new QueryClient(), persist: true });
    expect(b.get()).toEqual({ ...INITIAL, units: 'kmh', tags: ['x'] });
  });

  it('non-persisted entries never touch storage', () => {
    const s = defineClientState('volatile', INITIAL, { client });
    s.set((p) => ({ ...p, volume: 1 }));
    expect(store.length).toBe(0);
    expect(s.storageKey).toBeNull();
  });

  it('ignores corrupt JSON', () => {
    store.setItem('dash:v1:prefs', '{"units": "kmh", oops');
    const s = defineClientState('prefs', INITIAL, { client, persist: true });
    expect(s.get()).toEqual(INITIAL);
  });

  it('ignores a stored value of the wrong kind', () => {
    store.setItem('dash:v1:prefs', '[1,2,3]');
    expect(defineClientState('prefs', INITIAL, { client, persist: true }).get()).toEqual(INITIAL);
    store.setItem('dash:v1:list', '{"a":1}');
    expect(defineClientState<string[]>('list', [], { client, persist: true }).get()).toEqual([]);
  });

  it('shallow-merges old shapes onto the initial value and resets retyped fields', () => {
    // Stored by an "older build": no `tags`, `volume` was a string, plus a removed field.
    store.setItem('dash:v1:prefs', JSON.stringify({ units: 'kmh', volume: 'loud', legacy: true, last: 42 }));
    const s = defineClientState('prefs', INITIAL, { client, persist: true });
    expect(s.get()).toMatchObject({ units: 'kmh', volume: 5, tags: [], last: 42 });
  });

  it('applies sanitize, and falls back to initial if it throws', () => {
    store.setItem('dash:v1:prefs', JSON.stringify({ ...INITIAL, units: 'furlongs' }));
    const fixed = defineClientState('prefs', INITIAL, {
      client,
      persist: true,
      sanitize: (v, init) => (['mph', 'kmh'].includes(v.units) ? v : { ...v, units: init.units }),
    });
    expect(fixed.get().units).toBe('mph');

    const thrower = defineClientState('prefs2', INITIAL, {
      client,
      persist: true,
      sanitize: () => {
        throw new Error('bad');
      },
    });
    store.setItem('dash:v1:prefs2', JSON.stringify({ ...INITIAL, volume: 1 }));
    expect(thrower.get()).toEqual(INITIAL);
  });

  it('survives storage that throws (private mode / quota)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const s = defineClientState('prefs', INITIAL, { client, persist: true });
    expect(s.get()).toEqual(INITIAL);
    s.set((p) => ({ ...p, volume: 8 }));
    expect(s.get().volume).toBe(8);
  });

  it('works when localStorage does not exist at all', () => {
    vi.stubGlobal('localStorage', undefined);
    const s = defineClientState('prefs', INITIAL, { client, persist: true });
    s.set((p) => ({ ...p, volume: 2 }));
    expect(s.get().volume).toBe(2);
  });
});

describe('reviveOnto', () => {
  it('primitives must match the initial kind', () => {
    expect(reviveOnto(3, 0)).toBe(3);
    expect(reviveOnto('3', 0)).toBe(0);
    expect(reviveOnto(null, 'x')).toBe('x');
  });
});
