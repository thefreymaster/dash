/**
 * User preferences, persisted to localStorage (`dash:v1:settings`).
 * Defaults: mph, auto theme, demo off.
 */
import type { Settings, ThemeMode, Units } from '../types';
import { defineClientState } from './clientState';

export const UNITS: readonly Units[] = ['mph', 'kmh'];
export const THEME_MODES: readonly ThemeMode[] = ['auto', 'day', 'night'];

export const initialSettings: Settings = {
  units: 'mph',
  themeMode: 'auto',
  demo: false,
};

export const settings = defineClientState<Settings>('settings', initialSettings, {
  persist: true,
  // Reject enum values a newer/older build may have stored.
  sanitize: (stored, initial) => ({
    ...stored,
    units: UNITS.includes(stored.units) ? stored.units : initial.units,
    themeMode: THEME_MODES.includes(stored.themeMode) ? stored.themeMode : initial.themeMode,
  }),
});
