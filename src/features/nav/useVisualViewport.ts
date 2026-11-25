/**
 * The visible part of the layout viewport (`window.visualViewport`): on iOS the on-screen
 * keyboard shrinks it (≈ 200 px of a 393 px landscape screen) and may pan it. The search sheet
 * lays itself out from the top and caps its height to what stays visible above the keyboard.
 */
import { useSyncExternalStore } from 'react';

export interface ViewportBox {
  /** Visible height, CSS px. */
  height: number;
  /** How far the visible area is panned down from the top of the layout viewport, CSS px. */
  offsetTop: number;
}

const FALLBACK: ViewportBox = { height: 393, offsetTop: 0 };
let cached: ViewportBox = FALLBACK;

function read(): ViewportBox {
  if (typeof window === 'undefined') return FALLBACK;
  const vv = window.visualViewport;
  const height = Math.round(vv ? vv.height : window.innerHeight);
  const offsetTop = Math.round(vv ? vv.offsetTop : 0);
  if (height !== cached.height || offsetTop !== cached.offsetTop) cached = { height, offsetTop };
  return cached;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const vv = window.visualViewport;
  vv?.addEventListener('resize', onChange);
  vv?.addEventListener('scroll', onChange);
  window.addEventListener('resize', onChange);
  return () => {
    vv?.removeEventListener('resize', onChange);
    vv?.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onChange);
  };
}

/** Current visual viewport box; re-renders when the keyboard opens/closes or the view pans. */
export function useVisualViewport(): ViewportBox {
  return useSyncExternalStore(subscribe, read, () => FALLBACK);
}
