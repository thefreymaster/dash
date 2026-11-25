/**
 * Shared HTTP plumbing for the API modules (`api/roadName.ts`, `api/weather.ts`,
 * `api/search.ts`, `api/directions.ts` — added by feature tasks). Each of those exports a
 * plain async fetcher built on `fetchJson` plus a `use…` hook built on `useQuery`.
 * Retry/backoff policy lives in `state/queryClient.ts`, not here.
 */

/** Mapbox public token from `.env.local` (`VITE_MAPBOX_TOKEN`). Empty string when not configured. */
export const MAPBOX_TOKEN: string = (import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim();

/** `true` when a Mapbox token is configured. Map/search/directions must render a friendly state otherwise. */
export const hasMapboxToken: boolean = MAPBOX_TOKEN.length > 0;

/** Thrown by `fetchJson` for any non-2xx response. */
export class HttpError extends Error {
  /** HTTP status code (e.g. 401, 429, 503). */
  readonly status: number;
  /** HTTP status text, if the server sent one. */
  readonly statusText: string;
  /** Request URL with any `access_token` query value redacted. */
  readonly url: string;
  /** Response body text (first 500 chars), useful for API error messages. */
  readonly body: string;

  constructor(status: number, statusText: string, url: string, body: string) {
    const safeUrl = redactToken(url);
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ''} for ${safeUrl}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.url = safeUrl;
    this.body = body;
  }
}

/** Type guard for `HttpError` (works across module duplicates, unlike a bare `instanceof`). */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError || (error instanceof Error && error.name === 'HttpError' && 'status' in error);
}

/**
 * Longest a request may take, headers and body, ms. iOS Safari lets a fetch on a dead cellular
 * link hang for about a minute; a route or search answer that late is useless in a moving car,
 * and a hung request blocks the next one (TanStack runs one fetch per query at a time).
 */
export const FETCH_TIMEOUT_MS = 10_000;

export interface FetchJsonOptions {
  /** Abort signal — pass the one TanStack Query gives the `queryFn` so stale requests are cancelled. */
  signal?: AbortSignal;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Give up after this long with a `TimeoutError` (default `FETCH_TIMEOUT_MS`). */
  timeoutMs?: number;
}

/** `true` for the error a request rejects with when `fetchJson` timed it out. */
export function isTimeoutError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'TimeoutError';
}

const timeoutReason = () => new DOMException('The request timed out.', 'TimeoutError');

/**
 * The caller's signal combined with a timeout. Uses `AbortSignal.any` / `AbortSignal.timeout`
 * where they exist (iOS 17.4+) and a plain controller + timer elsewhere; `dispose` clears the timer.
 */
function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; dispose: () => void } {
  const S = AbortSignal as typeof AbortSignal & Partial<Pick<typeof AbortSignal, 'any' | 'timeout'>>;
  if (typeof S.any === 'function' && typeof S.timeout === 'function') {
    const timeout = S.timeout(ms);
    return { signal: signal ? S.any([signal, timeout]) : timeout, dispose: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutReason()), ms);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * GET a URL and parse JSON. Throws `HttpError` on non-2xx, lets `AbortError`/network
 * `TypeError` propagate (TanStack Query treats aborts as cancellation, not failure).
 * Every request times out after `FETCH_TIMEOUT_MS` (a `TimeoutError` DOMException, which
 * the retry policy treats like a network error).
 * The result is NOT validated: `T` is what you promise the API returns — narrow it in the
 * calling fetcher if a malformed response could crash rendering.
 *
 * @example
 *   queryFn: ({ signal }) => fetchJson<WeatherResponse>(url, { signal })
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { signal, dispose } = withTimeout(options.signal, options.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json', ...options.headers },
    });
    if (!response.ok) {
      let body = '';
      try {
        body = (await response.text()).slice(0, 500);
      } catch {
        // body unreadable — status is enough
      }
      throw new HttpError(response.status, response.statusText, url, body);
    }
    return (await response.json()) as T;
  } finally {
    dispose();
  }
}

/** Hide `access_token=…` values so tokens never end up in logs or error UI. */
function redactToken(url: string): string {
  return url.replace(/(access_token=)[^&#]*/gi, '$1…');
}
