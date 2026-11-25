/** The Dash logo: a gauge arc with an accent fill (mockup `.brand svg`). Decorative. */
import { useId } from 'react';

export function BrandMark({ size = 52 }: { size?: number }) {
  const id = `brand-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 52 52" width={size} height={size} aria-hidden="true" style={{ flex: 'none' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--chakra-colors-accent-alt)' }} />
          <stop offset="1" style={{ stopColor: 'var(--chakra-colors-accent-solid)' }} />
        </linearGradient>
      </defs>
      <path
        d="M11.4 38.6 A20 20 0 1 1 40.6 38.6"
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        style={{ stroke: 'var(--chakra-colors-track)' }}
      />
      <path d="M11.4 38.6 A20 20 0 0 1 38 11" fill="none" stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}
