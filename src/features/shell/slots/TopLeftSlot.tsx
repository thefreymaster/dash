/**
 * SLOT · top-left, inside the clock pill, right of the time.
 * OUTSIDE TEMPERATURE (T23, `src/features/weather`): weather glyph + "72°F".
 *
 * Inline content only, not a new glass surface: it shares the clock's pill. The divider
 * between the time and this slot appears automatically when this renders something (the
 * chip renders nothing until weather data exists), and the pill animates its width (`layout`).
 * Mockup: `.temp` — 24px icon, `font: 500 16px display`, gap 6px, `textStyle="numeric"`.
 */
import { WeatherChip } from '../../weather';

export function TopLeftSlot() {
  return <WeatherChip />;
}
