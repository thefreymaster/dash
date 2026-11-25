/** Weather display helpers. Pure, tested in `weatherFormat.test.ts`. */
import type { WeatherCondition, WeatherNow } from '../../api/weather';

/** Icon in the weather glyph set. */
export type WeatherGlyphKind =
  | 'clear-day'
  | 'clear-night'
  | 'partly-cloudy-day'
  | 'partly-cloudy-night'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'thunder';

/** Glyph for a condition; clear and partly cloudy have a sun by day and a moon by night. */
export function weatherGlyph(condition: WeatherCondition, isDay: boolean): WeatherGlyphKind {
  if (condition === 'clear') return isDay ? 'clear-day' : 'clear-night';
  if (condition === 'partly-cloudy') return isDay ? 'partly-cloudy-day' : 'partly-cloudy-night';
  return condition;
}

/** Whole-degree temperature with unit, as on the mockup: "72°F", "−3°C" (true minus sign, never "-0"). */
export function formatTemperature(temperature: number, unit: WeatherNow['unit']): string {
  const rounded = Math.round(temperature) + 0; // `+ 0` turns -0 into 0
  const digits = rounded < 0 ? `−${Math.abs(rounded)}` : String(rounded);
  return `${digits}°${unit}`;
}

const CONDITION_WORDS: Record<WeatherCondition, string> = {
  clear: 'clear',
  'partly-cloudy': 'partly cloudy',
  cloudy: 'cloudy',
  fog: 'fog',
  rain: 'rain',
  snow: 'snow',
  thunder: 'thunderstorms',
};

/** Screen-reader text, e.g. "Outside 72°F, clear". */
export function weatherDescription(weather: WeatherNow): string {
  return `Outside ${formatTemperature(weather.temperature, weather.unit)}, ${CONDITION_WORDS[weather.condition]}`;
}
