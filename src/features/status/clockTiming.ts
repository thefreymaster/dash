/** Clock timing helpers. Pure, tested in `clock.test.ts`. */

/** Extra delay after the minute boundary so the timer never fires a hair early. */
export const MINUTE_SLACK_MS = 30;

/** Milliseconds from `now` until just after the next wall-clock minute starts. */
export function msUntilNextMinute(now: Date): number {
  const into = now.getSeconds() * 1000 + now.getMilliseconds();
  return 60_000 - into + MINUTE_SLACK_MS;
}
