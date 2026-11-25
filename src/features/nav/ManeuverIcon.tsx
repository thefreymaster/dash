/**
 * Maneuver arrows (inline SVG, 34×34, `currentColor`, 4 px rounded strokes like the mockup's
 * `.man-icon`). Right-hand drawings; left-hand variants are mirrored by `maneuverIcon`.
 */
import type { ReactNode } from 'react';
import type { ManeuverIcon as Icon } from './maneuver';

const PATHS: Record<Icon['shape'], ReactNode> = {
  straight: (
    <>
      <path d="M17 30V6" />
      <path d="M9.5 13.5L17 6l7.5 7.5" />
    </>
  ),
  slight: (
    <>
      <path d="M12 30V20.5a6 6 0 0 1 1.8-4.3L24.5 6" />
      <path d="M15 6h9.5v9.5" />
    </>
  ),
  // Mockup `.man-icon` turn-right arrow.
  turn: (
    <>
      <path d="M10 30V18a6 6 0 0 1 6-6h12" />
      <path d="M22 6l6 6-6 6" />
    </>
  ),
  sharp: (
    <>
      <path d="M10 30V11a4 4 0 0 1 6.8-2.8L27 18.5" />
      <path d="M27.5 9.5v9.5H18" />
    </>
  ),
  // U-turn to the left (right-hand traffic).
  uturn: (
    <>
      <path d="M23 30V14a7 7 0 0 0-14 0v13" />
      <path d="M3.5 21.5L9 27l5.5-5.5" />
    </>
  ),
  merge: (
    <>
      <path d="M20 30V6" />
      <path d="M12.5 13.5L20 6l7.5 7.5" />
      <path d="M8 30c0-6 12-8 12-15" opacity="0.55" />
    </>
  ),
  roundabout: (
    <>
      <circle cx="17" cy="15" r="6" />
      <path d="M17 30v-9" />
      <path d="M21.3 10.7L27 5" />
      <path d="M20.5 5H27v6.5" />
    </>
  ),
  arrive: (
    <>
      <path d="M10 31V5" />
      <path d="M10 6h15l-3.5 5.5L25 17H10" fill="currentColor" strokeWidth="3" />
    </>
  ),
};

export function ManeuverGlyph({ icon, size = 34 }: { icon: Icon; size?: number }) {
  return (
    <svg
      viewBox="0 0 34 34"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={icon.mirrored ? { transform: 'scaleX(-1)' } : undefined}
    >
      {PATHS[icon.shape]}
    </svg>
  );
}
