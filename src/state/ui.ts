/**
 * Cross-feature UI state (not persisted): which screen is showing, whether the camera
 * follows the puck, and the theme currently applied. To change the theme just set
 * `resolvedTheme`: `main.tsx` subscribes once and calls `applyTheme` for every change.
 */
import type { UiState } from '../types';
import { defineClientState } from './clientState';

export const initialUi: UiState = {
  phase: 'gate',
  following: true,
  resolvedTheme: 'day',
};

export const ui = defineClientState<UiState>('ui', initialUi);
