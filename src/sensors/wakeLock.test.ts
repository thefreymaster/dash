import { afterEach, describe, expect, it } from 'vitest';
import { fakeDoc } from './testUtils';
import { hasWakeLock, startWakeLock, stopWakeLock, type SentinelLike, type WakeLockApi } from './wakeLock';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeApi(mode: { reject?: boolean; throws?: boolean } = {}) {
  const sentinels: Array<SentinelLike & { fireRelease: () => void }> = [];
  let requests = 0;
  const api: WakeLockApi = {
    request() {
      requests++;
      if (mode.throws) throw new Error('NotAllowedError');
      if (mode.reject) return Promise.reject(new Error('NotAllowedError'));
      const listeners: Array<() => void> = [];
      const sentinel = {
        released: false,
        release() {
          sentinel.released = true;
          return Promise.resolve();
        },
        addEventListener(_type: 'release', l: () => void) {
          listeners.push(l);
        },
        fireRelease() {
          sentinel.released = true;
          for (const l of listeners) l();
        },
      };
      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    },
  };
  return { api, sentinels, requests: () => requests };
}

afterEach(() => stopWakeLock());

describe('wake lock', () => {
  it('requests synchronously on start and holds the sentinel', async () => {
    const fake = fakeApi();
    startWakeLock({ api: fake.api, doc: fakeDoc() });
    expect(fake.requests()).toBe(1); // same tick as the Start tap
    await flush();
    expect(hasWakeLock()).toBe(true);
    startWakeLock({ api: fake.api, doc: fakeDoc() }); // idempotent
    expect(fake.requests()).toBe(1);
  });

  it('re-acquires when the page becomes visible again', async () => {
    const fake = fakeApi();
    const doc = fakeDoc();
    startWakeLock({ api: fake.api, doc });
    await flush();
    // The system releases the lock when the page is hidden.
    doc.setVisible(false);
    fake.sentinels[0].fireRelease();
    expect(hasWakeLock()).toBe(false);
    expect(fake.requests()).toBe(1);
    doc.setVisible(true);
    expect(fake.requests()).toBe(2);
    await flush();
    expect(hasWakeLock()).toBe(true);
  });

  it('tolerates a missing API, rejections and throws, and retries on the next tap', async () => {
    expect(() => startWakeLock({ api: null, doc: fakeDoc() })).not.toThrow();
    stopWakeLock();

    const rejecting = fakeApi({ reject: true });
    const doc = fakeDoc();
    startWakeLock({ api: rejecting.api, doc });
    await flush();
    expect(hasWakeLock()).toBe(false);
    expect(doc.listenerCount('pointerup')).toBe(1);
    doc.fire('pointerup');
    expect(rejecting.requests()).toBe(2);
    await flush();
    stopWakeLock();
    expect(doc.listenerCount('pointerup')).toBe(0);

    const throwing = fakeApi({ throws: true });
    expect(() => startWakeLock({ api: throwing.api, doc: fakeDoc() })).not.toThrow();
  });

  it('releases on stop and does not re-acquire afterwards', async () => {
    const fake = fakeApi();
    const doc = fakeDoc();
    startWakeLock({ api: fake.api, doc });
    await flush();
    stopWakeLock();
    expect(fake.sentinels[0].released).toBe(true);
    doc.setVisible(false);
    doc.setVisible(true);
    expect(fake.requests()).toBe(1);
  });
});
