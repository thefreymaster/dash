/**
 * One sheet at a time. Settings, the trip sheet and destination search each own their open
 * state (`settingsOpen`, `tripSheetOpen`, `searchOpen`); none of them knows about the
 * others. The shell links them here: when one opens, every other open one closes through its
 * own `close` (so each keeps its focus handling). No props, no new shared state.
 */
import type { ClientState } from '../../state';

export interface Sheet {
  /** The sheet's own open-state entry. */
  open: ClientState<boolean>;
  /** The sheet's own close action. */
  close: () => void;
}

/** Keep at most one of `sheets` open from now on. Returns the unsubscribe function. */
export function oneSheetAtATime(sheets: readonly Sheet[]): () => void {
  const unsubscribes = sheets.map((sheet) =>
    sheet.open.subscribe((isOpen) => {
      if (!isOpen) return;
      for (const other of sheets) {
        if (other !== sheet && other.open.get()) other.close();
      }
    }),
  );
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}
