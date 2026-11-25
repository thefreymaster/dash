import { describe, expect, it } from 'vitest';
import type { Fix, GpsStatus } from '../../types';
import { gpsBars, gpsBlocked, gpsBucket, gpsDescription } from './gpsBucket';

const fix = (accuracyM: number): Fix => ({
  lat: 0,
  lng: 0,
  speedMps: 0,
  headingDeg: null,
  accuracyM,
  timestamp: 0,
});

const tracking = (accuracyM: number) => ({ status: 'tracking' as GpsStatus, fix: fix(accuracyM) });

describe('gpsBucket', () => {
  it('buckets accuracy while tracking (inclusive upper bounds)', () => {
    expect(gpsBucket(tracking(3))).toBe('strong');
    expect(gpsBucket(tracking(10))).toBe('strong');
    expect(gpsBucket(tracking(10.1))).toBe('good');
    expect(gpsBucket(tracking(25))).toBe('good');
    expect(gpsBucket(tracking(26))).toBe('fair');
    expect(gpsBucket(tracking(50))).toBe('fair');
    expect(gpsBucket(tracking(51))).toBe('weak');
    expect(gpsBucket(tracking(2000))).toBe('weak');
  });

  it('shows searching before tracking and when stale, regardless of the last fix', () => {
    expect(gpsBucket({ status: 'idle', fix: null })).toBe('searching');
    expect(gpsBucket({ status: 'requesting', fix: null })).toBe('searching');
    expect(gpsBucket({ status: 'stale', fix: fix(4) })).toBe('searching');
    expect(gpsBucket({ status: 'tracking', fix: null })).toBe('searching');
  });

  it('passes the blocked states through', () => {
    expect(gpsBucket({ status: 'denied', fix: null })).toBe('denied');
    expect(gpsBucket({ status: 'unavailable', fix: fix(4) })).toBe('unavailable');
  });

  it('treats a nonsense accuracy as weak', () => {
    expect(gpsBucket(tracking(Number.NaN))).toBe('weak');
    expect(gpsBucket(tracking(-1))).toBe('weak');
  });

  it('returns the same primitive for different fixes in one bucket (no re-render per fix)', () => {
    expect(gpsBucket(tracking(4))).toBe(gpsBucket(tracking(7)));
  });
});

describe('gpsBars / gpsBlocked / gpsDescription', () => {
  it('maps buckets to lit bars', () => {
    expect(gpsBars('strong')).toBe(4);
    expect(gpsBars('good')).toBe(3);
    expect(gpsBars('fair')).toBe(2);
    expect(gpsBars('weak')).toBe(1);
    expect(gpsBars('searching')).toBe(0);
    expect(gpsBars('denied')).toBe(0);
  });

  it('flags only the states that need the user', () => {
    expect(gpsBlocked('denied')).toBe(true);
    expect(gpsBlocked('unavailable')).toBe(true);
    expect(gpsBlocked('searching')).toBe(false);
    expect(gpsBlocked('weak')).toBe(false);
  });

  it('describes the state', () => {
    expect(gpsDescription('strong', 'gps')).toBe('GPS signal strong');
    expect(gpsDescription('searching', 'sim')).toBe('Demo drive: searching for signal');
    expect(gpsDescription('denied', 'gps')).toBe('Location permission denied');
  });
});
