/**
 * Shell-local UI state: whether the settings sheet is open. The settings button (status
 * feature) opens it, the sheet closes it. Not persisted; nothing outside the shell and the
 * button should read it.
 */
import { defineClientState } from '../../state';

export const settingsOpen = defineClientState<boolean>('shell.settingsOpen', false);

/** DOM id of the settings button; the sheet returns focus to it on close. */
export const SETTINGS_BUTTON_ID = 'dash-settings-button';

export const openSettings = (): void => settingsOpen.set(true);
export const closeSettings = (): void => settingsOpen.set(false);
