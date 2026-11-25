/**
 * T23 Weather — current outside temperature and conditions from Open-Meteo (free, no key).
 *
 *   GET https://api.open-meteo.com/v1/forecast?latitude=37.8&longitude=-122.4
 *       &current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit
 *   → { …, current_units: { temperature_2m: "°F", weather_code: "wmo code", is_day: "" },
 *       current: { time: "2026-11-25T18:15", interval: 900, temperature_2m: 56.9, weather_code: 0, is_day: 1 } }
 *   Errors are HTTP 400 with `{ "error": true, "reason": "…" }` (surfaced by `fetchJson` as `HttpError`).
 *
 * Fahrenheit when `settings.units` is `mph`, Celsius when `kmh` (Open-Meteo converts).
 * The query key is the position rounded to `WEATHER_CELL_DEG` (≈11 km) plus the unit, so it
 * refetches only after real travel; otherwise every `WEATHER_REFRESH_MS`. The selector on
 * `telemetry` returns a deep-equal cell between fixes, so `useWeather` re-renders only when
 * the cell changes. Open-Meteo's own model resolution is a few km, so the rounding costs nothing.
 */
import { keepPreviousData, queryOptions, skipToken, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { settings, telemetry } from '../state';
import type { Telemetry, Units } from '../types';
import { fetchJson } from './client';

/** Position rounding of the query key, degrees (≈11 km of latitude). */
export const WEATHER_CELL_DEG = 0.1;
/** Stale time and refetch interval, ms. */
export const WEATHER_REFRESH_MS = 10 * 60_000;
/** Cache lifetime of a result nobody observes any more (the fallback while a new cell fails). */
export const WEATHER_GC_MS = 60 * 60_000;
/** Root of every weather query key. */
export const WEATHER_ROOT = 'weather';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/** Open-Meteo `temperature_unit` values used by Dash. */
export type TemperatureUnit = 'fahrenheit' | 'celsius';

/** Icon-level condition derived from the WMO weather code. */
export type WeatherCondition = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunder';

/** Current conditions (query data). JSON-safe. */
export interface WeatherNow {
  /** Air temperature at 2 m, in `unit`. */
  temperature: number;
  /** `F` or `C`. */
  unit: 'F' | 'C';
  /** WMO weather interpretation code, `null` if the response had none. */
  code: number | null;
  /** Condition for the icon. */
  condition: WeatherCondition;
  /** Daylight at the location (Open-Meteo `is_day`). */
  isDay: boolean;
}

/** Rounded position used as the query key. */
export interface WeatherCell {
  lat: number;
  lng: number;
}

/** Temperature unit for the user's speed units: mph → °F, km/h → °C. */
export function temperatureUnitFor(units: Units): TemperatureUnit {
  return units === 'mph' ? 'fahrenheit' : 'celsius';
}

/** Cells per degree (an integer, so rounding stays exact: 37.75 → 37.8, not 37.7). */
const CELLS_PER_DEG = Math.round(1 / WEATHER_CELL_DEG);
const roundToCell = (deg: number): number => Math.round(deg * CELLS_PER_DEG) / CELLS_PER_DEG + 0;

/** `telemetry.use` selector: the fix rounded to the weather cell, or `null` before the first fix. */
export function weatherCellOf(t: Pick<Telemetry, 'fix'>): WeatherCell | null {
  const fix = t.fix;
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;
  return { lat: roundToCell(fix.lat), lng: roundToCell(fix.lng) };
}

/** Open-Meteo request URL. */
export function weatherUrl(cell: WeatherCell, unit: TemperatureUnit): string {
  return (
    `${ENDPOINT}?latitude=${cell.lat}&longitude=${cell.lng}` +
    `&current=temperature_2m,weather_code,is_day&temperature_unit=${unit}`
  );
}

/**
 * WMO weather interpretation code (Open-Meteo docs table) → icon condition.
 *   0, 1 clear · 2 partly cloudy · 3 overcast → cloudy · 45, 48 fog
 *   51–57 drizzle, 61–67 rain, 80–82 showers → rain · 71–77, 85, 86 snow · 95–99 thunder
 * Unknown codes fall back to `cloudy` (neutral).
 */
export function weatherCondition(code: number | null): WeatherCondition {
  if (code === null || !Number.isInteger(code)) return 'cloudy';
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunder';
  return 'cloudy';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Current conditions from an Open-Meteo response. Throws if there is no usable temperature
 * (so the query errors and the previous value stays); a missing code or `is_day` degrades
 * to `cloudy` / day. The unit comes from `current_units` when present, else the request.
 */
export function parseWeather(json: unknown, requested: TemperatureUnit): WeatherNow {
  if (!isRecord(json) || !isRecord(json.current)) throw new Error('Open-Meteo: no `current` block');
  const current = json.current;
  const temperature = current.temperature_2m;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
    throw new Error('Open-Meteo: no current temperature');
  }
  const rawCode = current.weather_code;
  const code = typeof rawCode === 'number' && Number.isInteger(rawCode) && rawCode >= 0 ? rawCode : null;
  const unitLabel = isRecord(json.current_units) ? json.current_units.temperature_2m : undefined;
  const unit: 'F' | 'C' =
    unitLabel === '°F' ? 'F' : unitLabel === '°C' ? 'C' : requested === 'fahrenheit' ? 'F' : 'C';
  return {
    temperature,
    unit,
    code,
    condition: weatherCondition(code),
    isDay: current.is_day !== 0,
  };
}

/** Fetch current conditions for a cell. */
export async function fetchWeather(
  cell: WeatherCell,
  unit: TemperatureUnit,
  options: { signal?: AbortSignal } = {},
): Promise<WeatherNow> {
  const json = await fetchJson<unknown>(weatherUrl(cell, unit), { signal: options.signal });
  return parseWeather(json, unit);
}

/** Query options for a cell + unit. Disabled (skipToken) before the first fix. */
export function weatherQueryOptions(cell: WeatherCell | null, unit: TemperatureUnit) {
  return queryOptions({
    queryKey: [WEATHER_ROOT, cell?.lat ?? null, cell?.lng ?? null, unit] as const,
    queryFn: cell ? ({ signal }) => fetchWeather(cell, unit, { signal }) : skipToken,
    staleTime: WEATHER_REFRESH_MS,
    refetchInterval: WEATHER_REFRESH_MS,
    gcTime: WEATHER_GC_MS,
  });
}

/** Most recently fetched weather still in the cache (any cell or unit), if any. */
export function latestWeather(client: QueryClient): WeatherNow | undefined {
  let latestAt = -1;
  let latest: WeatherNow | undefined;
  for (const query of client.getQueryCache().findAll({ queryKey: [WEATHER_ROOT] })) {
    const { data, dataUpdatedAt } = query.state;
    if (data !== undefined && dataUpdatedAt > latestAt) {
      latestAt = dataUpdatedAt;
      latest = data as WeatherNow;
    }
  }
  return latest;
}

/**
 * Current outside conditions, or `undefined` until the first successful fetch. Keeps the
 * previous value while a new cell/unit loads and when a request fails.
 */
export function useWeather(): WeatherNow | undefined {
  const client = useQueryClient();
  const cell = telemetry.use(weatherCellOf);
  const unit = settings.use((s) => temperatureUnitFor(s.units));
  const query = useQuery({ ...weatherQueryOptions(cell, unit), placeholderData: keepPreviousData });
  return query.data ?? latestWeather(client);
}
