/**
 * Shell — app frame and HUD layout. Next-phase features add their UI by editing ONE slot
 * file in `./slots/` and building surfaces with `GlassWidget`.
 */
export { ClusterLayout } from './ClusterLayout';
export { ErrorBoundary } from './ErrorBoundary';
export { StartGate } from './StartGate';
export { BootSequence } from './BootSequence';
export { RotatePrompt } from './RotatePrompt';
export { SettingsSheet } from './SettingsSheet';
export { MapScrim } from './MapScrim';
export { GlassWidget } from './GlassWidget';
export { HudRegion, HudBottomStrip } from './HudRegion';
export { oneSheetAtATime } from './sheets';
export type { Sheet } from './sheets';
export { HudSlotContext, widgetMotion, ENTRANCE_BASE_DELAY_S, ENTRANCE_STEP_S } from './hud';
export type { EntranceFrom, HudArea, HudSlot } from './hud';
export { settingsOpen, openSettings, closeSettings, SETTINGS_BUTTON_ID } from './settingsOpen';
export { useIsPortrait } from './useIsPortrait';
