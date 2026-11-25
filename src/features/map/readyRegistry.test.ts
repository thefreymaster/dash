import { describe, expect, it, vi } from 'vitest';
import { createReadyRegistry } from './readyRegistry';

describe('createReadyRegistry', () => {
  it('queues callbacks until resolved, then runs them once in order', () => {
    const r = createReadyRegistry<string>();
    const calls: string[] = [];
    r.when((v) => calls.push(`a:${v}`));
    r.when((v) => calls.push(`b:${v}`));
    expect(r.get()).toBeNull();
    expect(calls).toEqual([]);
    r.resolve('map');
    expect(calls).toEqual(['a:map', 'b:map']);
    r.resolve('map'); // a second resolve (e.g. `load` after `style.load`) re-runs nothing
    expect(calls).toHaveLength(2);
    expect(r.get()).toBe('map');
  });

  it('runs immediately once ready', () => {
    const r = createReadyRegistry<number>();
    r.resolve(7);
    const cb = vi.fn();
    r.when(cb);
    expect(cb).toHaveBeenCalledWith(7);
  });

  it('unsubscribe removes only that registration', () => {
    const r = createReadyRegistry<number>();
    const cb = vi.fn();
    const off = r.when(cb);
    r.when(cb);
    off();
    r.resolve(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a throwing callback does not stop the others', () => {
    const r = createReadyRegistry<number>();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    r.when(() => {
      throw new Error('boom');
    });
    r.when(after);
    r.resolve(1);
    expect(after).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('reset makes it pending again', () => {
    const r = createReadyRegistry<number>();
    r.resolve(1);
    r.reset();
    const cb = vi.fn();
    r.when(cb);
    expect(cb).not.toHaveBeenCalled();
    r.resolve(2);
    expect(cb).toHaveBeenCalledWith(2);
  });
});
