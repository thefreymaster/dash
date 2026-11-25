import { describe, expect, it } from 'vitest';
import { MINUTE_SLACK_MS, msUntilNextMinute } from './clockTiming';

describe('msUntilNextMinute', () => {
  it('waits for the rest of the current minute', () => {
    expect(msUntilNextMinute(new Date(2026, 10, 25, 10, 42, 0, 0))).toBe(60_000 + MINUTE_SLACK_MS);
    expect(msUntilNextMinute(new Date(2026, 10, 25, 10, 42, 30, 0))).toBe(30_000 + MINUTE_SLACK_MS);
    expect(msUntilNextMinute(new Date(2026, 10, 25, 10, 42, 59, 999))).toBe(1 + MINUTE_SLACK_MS);
  });

  it('always lands just after a boundary', () => {
    const now = new Date(2026, 10, 25, 23, 59, 12, 345);
    const next = new Date(now.getTime() + msUntilNextMinute(now));
    expect(next.getSeconds()).toBe(0);
    expect(next.getMinutes()).toBe(0);
    expect(next.getMilliseconds()).toBe(MINUTE_SLACK_MS);
  });
});
