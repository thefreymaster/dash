/**
 * Weather glyph set (24×24, inline SVG), in the mockup's style: a warm sun, a white cloud
 * with a soft blue-grey outline. Colours are literal so the icons read the same on day and
 * night glass; fog lines use `currentColor` (the theme's ink).
 */
import type { ReactNode } from 'react';
import type { WeatherGlyphKind } from './weatherFormat';

const SUN = '#ffb21e';
const MOON = '#ffd66e';
const CLOUD = '#ffffff';
const CLOUD_BACK = '#c4cfdd';
const CLOUD_STORM = '#aab6c6';
const OUTLINE = 'rgba(60, 80, 110, 0.35)';
const RAIN = '#3d9bff';
const SNOW = '#7cc4ff';

/** Cloud from the mockup (spans x 5.6–22.1, y 9.6–20.5); shift it with `dx`/`dy`. */
function cloud(fill: string, dx = 0, dy = 0): ReactNode {
  return (
    <path
      d="M8.5 20.5h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.4 2.9 2.9 0 0 0-.8 5.8z"
      transform={dx || dy ? `translate(${dx} ${dy})` : undefined}
      fill={fill}
      stroke={OUTLINE}
      strokeWidth="1"
    />
  );
}

const svg = (children: ReactNode): ReactNode => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

/** Cloud raised to leave room for precipitation underneath (spans y 4.6–15.5). */
const highCloud = (fill: string) => cloud(fill, -1.5, -5);

export const WEATHER_GLYPHS: Record<WeatherGlyphKind, ReactNode> = {
  'clear-day': svg(
    <>
      <circle cx="12" cy="12" r="4.6" fill={SUN} />
      <path
        d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.35 5.35l1.5 1.5M17.15 17.15l1.5 1.5M5.35 18.65l1.5-1.5M17.15 6.85l1.5-1.5"
        stroke={SUN}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </>,
  ),
  'clear-night': svg(<path d="M19.6 14.8A8.2 8.2 0 0 1 9.2 4.4a8.2 8.2 0 1 0 10.4 10.4z" fill={MOON} />),
  'partly-cloudy-day': svg(
    <>
      <circle cx="9" cy="9" r="4.2" fill={SUN} />
      <path
        d="M9 1.6v1.6M9 14.8v1.2M1.6 9h1.6M3.8 3.8l1.1 1.1M14.2 3.8l-1.1 1.1M3.8 14.2l1.1-1.1"
        stroke={SUN}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {cloud(CLOUD)}
    </>,
  ),
  'partly-cloudy-night': svg(
    <>
      <path d="M14.2 10.6A6 6 0 0 1 6.6 3a6 6 0 1 0 7.6 7.6z" fill={MOON} />
      {cloud(CLOUD)}
    </>,
  ),
  cloudy: svg(
    <>
      {cloud(CLOUD_BACK, -4, -4.5)}
      {cloud(CLOUD, 0, 0)}
    </>,
  ),
  fog: svg(
    <>
      {highCloud(CLOUD)}
      <path d="M3.5 18.5h15M6 21.5h13" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.7" strokeLinecap="round" />
    </>,
  ),
  rain: svg(
    <>
      {highCloud(CLOUD)}
      <path d="M8.6 18l-1.2 3.2M12.6 18l-1.2 3.2M16.6 18l-1.2 3.2" stroke={RAIN} strokeWidth="1.8" strokeLinecap="round" />
    </>,
  ),
  snow: svg(
    <>
      {highCloud(CLOUD)}
      <g fill={SNOW}>
        <circle cx="8" cy="18.6" r="1.25" />
        <circle cx="12.5" cy="18.6" r="1.25" />
        <circle cx="17" cy="18.6" r="1.25" />
        <circle cx="10.25" cy="21.8" r="1.25" />
        <circle cx="14.75" cy="21.8" r="1.25" />
      </g>
    </>,
  ),
  thunder: svg(
    <>
      {highCloud(CLOUD_STORM)}
      <path d="M12.4 14.2l-3 4.9h2.9l-1.4 4.1 4.6-6.1h-3l1.7-2.9z" fill={SUN} />
    </>,
  ),
};
