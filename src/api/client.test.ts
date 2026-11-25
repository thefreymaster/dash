import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldRetry } from '../state/queryClient';
import { FETCH_TIMEOUT_MS, HttpError, fetchJson, isHttpError, isTimeoutError } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fetch that never answers, like iOS on a dead cellular link — it only settles when aborted. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
}

describe('fetchJson', () => {
  it('parses JSON on 2xx and forwards the abort signal', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await expect(fetchJson<{ ok: number }>('https://api.example/x', { signal: controller.signal })).resolves.toEqual({
      ok: 1,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example/x');
    // The caller's signal is combined with the timeout: aborting it aborts the request.
    const passed = fetchMock.mock.calls[0][1]?.signal;
    expect(passed).toBeInstanceOf(AbortSignal);
    expect(passed?.aborted).toBe(false);
    controller.abort();
    expect(passed?.aborted).toBe(true);
  });

  it('gives up on a hung request after the timeout (regression: a hung iOS fetch blocked rerouting ~60 s)', async () => {
    expect(FETCH_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    vi.stubGlobal('fetch', hangingFetch());
    const started = Date.now();
    const error = await fetchJson('https://api.example/hang', { timeoutMs: 40 }).catch((e: unknown) => e);
    expect(isTimeoutError(error)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('still cancels at once when the caller aborts (not reported as a timeout)', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    const pending = fetchJson('https://api.example/hang', { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    const error = await pending;
    expect((error as Error).name).toBe('AbortError');
    expect(isTimeoutError(error)).toBe(false);
  });

  it('times out with the fallback when AbortSignal.any / timeout are missing (older iOS)', async () => {
    const S = AbortSignal as unknown as Record<string, unknown>;
    const any = S.any;
    const timeout = S.timeout;
    try {
      S.any = undefined;
      S.timeout = undefined;
      vi.stubGlobal('fetch', hangingFetch());
      const error = await fetchJson('https://api.example/hang', { timeoutMs: 30 }).catch((e: unknown) => e);
      expect(isTimeoutError(error)).toBe(true);
      const controller = new AbortController();
      const pending = fetchJson('https://api.example/hang', { signal: controller.signal }).catch((e: unknown) => e);
      controller.abort();
      expect((await pending as Error).name).toBe('AbortError');
    } finally {
      S.any = any;
      S.timeout = timeout;
    }
  });

  it('throws a typed HttpError with status on non-2xx, with the token redacted', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"message":"Not Authorized"}', { status: 401, statusText: 'Unauthorized' }));
    const error = await fetchJson('https://api.mapbox.com/a?access_token=pk.secret&x=1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(isHttpError(error)).toBe(true);
    const http = error as HttpError;
    expect(http.status).toBe(401);
    expect(http.body).toContain('Not Authorized');
    expect(http.url).not.toContain('pk.secret');
    expect(http.message).not.toContain('pk.secret');
  });
});

describe('shouldRetry', () => {
  it('retries network errors and 5xx up to twice', () => {
    expect(shouldRetry(0, new TypeError('Load failed'))).toBe(true);
    expect(shouldRetry(1, new HttpError(503, '', 'u', ''))).toBe(true);
    expect(shouldRetry(2, new HttpError(503, '', 'u', ''))).toBe(false);
  });
  it('does not retry 4xx except 408 and 429', () => {
    expect(shouldRetry(0, new HttpError(401, '', 'u', ''))).toBe(false);
    expect(shouldRetry(0, new HttpError(404, '', 'u', ''))).toBe(false);
    expect(shouldRetry(0, new HttpError(429, '', 'u', ''))).toBe(true);
    expect(shouldRetry(0, new HttpError(408, '', 'u', ''))).toBe(true);
  });
});
