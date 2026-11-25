/**
 * The one QueryClient for the whole app. Import it from here (or `state/index.ts`);
 * `main.tsx` passes it to `<QueryClientProvider>`. Non-React code (sensors, rAF loop)
 * reaches client state through the `defineClientState` entries rather than directly.
 *
 * Defaults are tuned for a phone in a moving car on a flaky cellular link:
 *   - two retries with capped exponential backoff (1 s, 2 s), then give up quietly — the
 *     next position change usually produces a new request anyway;
 *   - no retry for 4xx client errors (bad token, bad request, not found) except 408/429;
 *   - no refetch on window focus (iOS fires focus/visibility constantly when the PWA is
 *     backgrounded and resumed — that must not re-hit every API);
 *   - refetch on reconnect, because coming out of a dead zone is exactly when data is stale;
 *   - `networkMode: 'online'` (TanStack default) so queries pause instead of failing offline.
 * Keeping the previous value while a new key loads is opt-in per query: callers (road name,
 * weather, route) pass `placeholderData: keepPreviousData`.
 */
import { QueryClient } from '@tanstack/react-query';
import { isHttpError } from '../api/client';

/** Max retries after the first failed attempt. */
export const MAX_RETRIES = 2;

/** Retry delay for attempt n (0-based): 1 s, 2 s, 4 s … capped at 8 s. */
export const retryDelay = (attemptIndex: number): number => Math.min(1000 * 2 ** attemptIndex, 8000);

/** Retry policy: up to `MAX_RETRIES`, never for 4xx other than 408 (timeout) and 429 (rate limit). */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (isHttpError(error) && error.status >= 400 && error.status < 500) {
    return error.status === 408 || error.status === 429;
  }
  return true;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      retryDelay,
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
