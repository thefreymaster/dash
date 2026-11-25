import { describe, expect, it } from 'vitest';
import { formatTemperature, weatherDescription, weatherGlyph } from './weatherFormat';

describe('formatTemperature', () => {
  it('rounds to whole degrees with the unit', () => {
    expect(formatTemperature(71.6, 'F')).toBe('72°F');
    expect(formatTemperature(13.4, 'C')).toBe('13°C');
  });

  it('uses a true minus sign and never shows -0', () => {
    expect(formatTemperature(-3.2, 'C')).toBe('−3°C');
    expect(formatTemperature(-0.3, 'C')).toBe('0°C');
  });
});

describe('weatherGlyph', () => {
  it('picks sun or moon by daylight for clear and partly cloudy', () => {
    expect(weatherGlyph('clear', true)).toBe('clear-day');
    expect(weatherGlyph('clear', false)).toBe('clear-night');
    expect(weatherGlyph('partly-cloudy', true)).toBe('partly-cloudy-day');
    expect(weatherGlyph('partly-cloudy', false)).toBe('partly-cloudy-night');
  });

  it('uses one glyph day and night for the rest', () => {
    for (const c of ['cloudy', 'fog', 'rain', 'snow', 'thunder'] as const) {
      expect(weatherGlyph(c, true)).toBe(c);
      expect(weatherGlyph(c, false)).toBe(c);
    }
  });
});

describe('weatherDescription', () => {
  it('reads naturally', () => {
    expect(weatherDescription({ temperature: 56.9, unit: 'F', code: 0, condition: 'clear', isDay: true })).toBe(
      'Outside 57°F, clear',
    );
    expect(weatherDescription({ temperature: 9, unit: 'C', code: 95, condition: 'thunder', isDay: false })).toBe(
      'Outside 9°C, thunderstorms',
    );
  });
});
