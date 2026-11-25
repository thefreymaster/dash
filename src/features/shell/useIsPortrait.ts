/**
 * `true` while the viewport is taller than wide. iOS cannot lock orientation for web
 * apps (the manifest `orientation` is ignored in Safari), so the shell covers the screen
 * with a rotate prompt instead.
 */
import { useSyncExternalStore } from 'react';

const QUERY = '(orientation: portrait)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  // iOS sometimes reports the media change late after a rotation; resize is a backstop.
  window.addEventListener('resize', onChange);
  return () => {
    mq.removeEventListener('change', onChange);
    window.removeEventListener('resize', onChange);
  };
}

function getSnapshot(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;
}

export function useIsPortrait(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
