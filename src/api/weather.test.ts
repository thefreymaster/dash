import { QueryClient, skipToken } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fix } from '../types';
import { HttpError } from './client';
import {
  WEATHER_REFRESH_MS,
  WEATHER_ROOT,
  fetchWeather,
  latestWeather,
  parseWeather,
  temperatureUnitFor,
  weatherCellOf,
  weatherCondition,
  weatherQueryOptions,
  weatherUrl,
} from './weather';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Live responses captured from api.open-meteo.com for 37.8, -122.4 (2026-11-25). */
const LIVE_F = {
  latitude: 37.78929,
  longitude: -122.42199,
  generationtime_ms: 0.16760826110839844,
  utc_offset_seconds: 0,
  timezone: 'GMT',
  timezone_abbreviation: 'GMT',
  elevation: 7.0,
  current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°F', weather_code: 'wmo code', is_day: '' },
  current: { time: '2026-11-25T18:15', interval: 900, temperature_2m: 56.9, weather_code: 0, is_day: 1 },
};
const LIVE_C = {
  ...LIVE_F,
  current_units: { ...LIVE_F.current_units, temperature_2m: '°C' },
  current: { ...LIVE_F.current, temperature_2m: 13.9 },
};
/** Error shape from the Open-Meteo docs (sent with HTTP 400). */
const DOCS_ERROR = {
  error: true,
  reason: 'Cannot initialize WeatherVariable from invalid String value tempeture_2m for key hourly',
};

describe('parseWeather', () => {
  it('parses the current block in Fahrenheit and Celsius', () => {
    expect(parseWeather(LIVE_F, 'fahrenheit')).toEqual({
      temperature: 56.9,
      unit: 'F',
      code: 0,
      condition: 'clear',
      isDay: true,
    });
    expect(parseWeather(LIVE_C, 'celsius')).toMatchObject({ temperature: 13.9, unit: 'C' });
  });

  it('trusts current_units over the requested unit, and falls back to the request without it', () => {
    expect(parseWeather(LIVE_C, 'fahrenheit').unit).toBe('C');
    const { current_units: _omit, ...bare } = LIVE_F;
    expect(parseWeather(bare, 'celsius').unit).toBe('C');
    expect(parseWeather(bare, 'fahrenheit').unit).toBe('F');
  });

  it('reads night and degrades gracefully without code or is_day', () => {
    expect(parseWeather({ current: { temperature_2m: 3, weather_code: 71, is_day: 0 } }, 'celsius')).toMatchObject({
      condition: 'snow',
      isDay: false,
    });
    expect(parseWeather({ current: { temperature_2m: -2.4 } }, 'celsius')).toEqual({
      temperature: -2.4,
      unit: 'C',
      code: null,
      condition: 'cloudy',
      isDay: true,
    });
    expect(parseWeather({ current: { temperature_2m: 10, weather_code: 'x' } }, 'celsius').code).toBeNull();
  });

  it('throws without a usable temperature', () => {
    expect(() => parseWeather(DOCS_ERROR, 'celsius')).toThrow();
    expect(() => parseWeather(null, 'celsius')).toThrow();
    expect(() => parseWeather({ current: {} }, 'celsius')).toThrow();
    expect(() => parseWeather({ current: { temperature_2m: null } }, 'celsius')).toThrow();
    expect(() => parseWeather({ current: { temperature_2m: Number.NaN } }, 'celsius')).toThrow();
  });
});

describe('weatherCondition (WMO code table from the Open-Meteo docs)', () => {
  it.each([
    [0, 'clear'],
    [1, 'clear'],
    [2, 'partly-cloudy'],
    [3, 'cloudy'],
    [45, 'fog'],
    [48, 'fog'],
    [51, 'rain'],
    [53, 'rain'],
    [55, 'rain'],
    [56, 'rain'],
    [57, 'rain'],
    [61, 'rain'],
    [63, 'rain'],
    [65, 'rain'],
    [66, 'rain'],
    [67, 'rain'],
    [71, 'snow'],
    [73, 'snow'],
    [75, 'snow'],
    [77, 'snow'],
    [80, 'rain'],
    [81, 'rain'],
    [82, 'rain'],
    [85, 'snow'],
    [86, 'snow'],
    [95, 'thunder'],
    [96, 'thunder'],
    [97, 'thunder'],
    [99, 'thunder'],
  ] as const)('code %i → %s', (code, condition) => {
    expect(weatherCondition(code)).toBe(condition);
  });

  it('falls back to cloudy for unknown codes', () => {
    expect(weatherCondition(null)).toBe('cloudy');
    expect(weatherCondition(4)).toBe('cloudy');
    expect(weatherCondition(100)).toBe('cloudy');
    expect(weatherCondition(2.5)).toBe('cloudy');
  });
});

describe('weatherCellOf / weatherUrl / temperatureUnitFor', () => {
  const fix = (lat: number, lng: number): Fix => ({ lat, lng, speedMps: 0, headingDeg: null, accuracyM: 5, timestamp: 0 });

  it('rounds the fix to 0.1° (so it refetches only after real travel)', () => {
    expect(weatherCellOf({ fix: null })).toBeNull();
    expect(weatherCellOf({ fix: fix(37.7749, -122.4194) })).toEqual({ lat: 37.8, lng: -122.4 });
    expect(weatherCellOf({ fix: fix(37.75, -122.45) })).toEqual({ lat: 37.8, lng: -122.4 });
    expect(weatherCellOf({ fix: fix(37.8412, -122.3588) })).toEqual({ lat: 37.8, lng: -122.4 });
    expect(Object.is(weatherCellOf({ fix: fix(-0.04, 0.01) })?.lat, -0)).toBe(false);
    expect(weatherCellOf({ fix: fix(Number.NaN, 1) })).toBeNull();
  });

  it('builds the Open-Meteo forecast URL with the current variables and unit', () => {
    expect(weatherUrl({ lat: 37.8, lng: -122.4 }, 'fahrenheit')).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=37.8&longitude=-122.4' +
        '&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit',
    );
  });

  it('uses Fahrenheit for mph and Celsius for km/h', () => {
    expect(temperatureUnitFor('mph')).toBe('fahrenheit');
    expect(temperatureUnitFor('kmh')).toBe('celsius');
  });
});

describe('fetchWeather', () => {
  it('fetches and parses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIVE_F), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWeather({ lat: 37.8, lng: -122.4 }, 'fahrenheit')).resolves.toMatchObject({
      temperature: 56.9,
      unit: 'F',
    });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('temperature_unit=fahrenheit');
  });

  it('rejects with HttpError on the API error shape', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(DOCS_ERROR), { status: 400 }));
    const error = await fetchWeather({ lat: 37.8, lng: -122.4 }, 'celsius').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).body).toContain('reason');
  });
});

describe('weatherQueryOptions / latestWeather', () => {
  it('keys on cell + unit, refreshes every 10 minutes, waits for a fix', () => {
    const options = weatherQueryOptions({ lat: 37.8, lng: -122.4 }, 'celsius');
    expect(options.queryKey).toEqual([WEATHER_ROOT, 37.8, -122.4, 'celsius']);
    expect(options.staleTime).toBe(WEATHER_REFRESH_MS);
    expect(options.refetchInterval).toBe(WEATHER_REFRESH_MS);
    expect(WEATHER_REFRESH_MS).toBe(600_000);
    expect(options.queryFn).not.toBe(skipToken);
    expect(weatherQueryOptions(null, 'celsius').queryFn).toBe(skipToken);
  });

  it('runs the query through a QueryClient', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(LIVE_C), { status: 200 }));
    const client = new QueryClient();
    await expect(client.fetchQuery(weatherQueryOptions({ lat: 37.8, lng: -122.4 }, 'celsius'))).resolves.toMatchObject({
      temperature: 13.9,
      unit: 'C',
    });
    client.clear();
  });

  it('finds the most recent result across cells and units', () => {
    const client = new QueryClient();
    expect(latestWeather(client)).toBeUndefined();
    client.setQueryData([WEATHER_ROOT, 37.8, -122.4, 'fahrenheit'], parseWeather(LIVE_F, 'fahrenheit'), { updatedAt: 2000 });
    client.setQueryData([WEATHER_ROOT, 37.9, -122.4, 'celsius'], parseWeather(LIVE_C, 'celsius'), { updatedAt: 1000 });
    expect(latestWeather(client)?.unit).toBe('F');
    client.clear();
  });
});
