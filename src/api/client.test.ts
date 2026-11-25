import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldRetry } from '../state/queryClient';
import { HttpError, fetchJson, isHttpError } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchJson', () => {
  it('parses JSON on 2xx and forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await expect(fetchJson<{ ok: number }>('https://api.example/x', { signal: controller.signal })).resolves.toEqual({
      ok: 1,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/x',
      expect.objectContaining({ signal: controller.signal }),
    );
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
