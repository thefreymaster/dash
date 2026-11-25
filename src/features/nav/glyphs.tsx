/**
 * Small inline SVG icons for the navigation UI (all `currentColor`, `aria-hidden`).
 */
import { motion } from 'motion/react';
import type { SuggestionKind } from '../../api/search';

/** Indeterminate spinner (an arc that turns). Reduced motion keeps it still. */
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <motion.svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
    >
      <circle cx="12" cy="12" r="9" opacity="0.22" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </motion.svg>
  );
}

export function WarningGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3.5 2.8 19.5h18.4z" />
      <path d="M12 10v4.2M12 17.2h.01" />
    </svg>
  );
}

/** Check mark that draws itself. */
export function CheckGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <motion.path
        d="M5 12.5l4.5 4.5L19 7.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
      />
    </svg>
  );
}

export function CloseGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 18 18" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 4l10 10M14 4L4 14" />
    </svg>
  );
}

export function SearchGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 18 18" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="7.5" cy="7.5" r="5.5" />
      <path d="M12 12l4 4" />
    </svg>
  );
}

export function LockGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 18 18" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3.5" y="8" width="11" height="8" rx="2.2" />
      <path d="M6 8V5.8a3 3 0 0 1 6 0V8" />
    </svg>
  );
}

/** The "P" parking tile from the mockup's Parked chip. */
export function ParkedGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="12" height="12" rx="3.5" fill="currentColor" />
      <path d="M5.4 10.6V3.6h2.3a2.1 2.1 0 0 1 0 4.2H5.4" fill="none" stroke="var(--chakra-colors-accent-contrast, #fff)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function InfoGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7.2V11M8 5h.01" />
    </svg>
  );
}

export function RecentGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 18 18" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 5.5V9l2.5 1.5" />
    </svg>
  );
}

/** Icon for a search result family. */
export function KindGlyph({ kind, size = 18 }: { kind: SuggestionKind; size?: number }) {
  const common = {
    viewBox: '0 0 18 18',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  switch (kind) {
    case 'coffee':
      return (
        <svg {...common}>
          <path d="M3 7h9v4a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
          <path d="M12 8h1.5a2 2 0 0 1 0 4H12" />
          <path d="M6 2.5v2M9 2.5v2" />
        </svg>
      );
    case 'food':
      return (
        <svg {...common}>
          <path d="M5 2.5v13M3 2.5v3.5a2 2 0 0 0 4 0V2.5" />
          <path d="M13 15.5V2.5c-2 1-3 3-3 6h3" />
        </svg>
      );
    case 'fuel':
      return (
        <svg {...common}>
          <path d="M3.5 15.5V4a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 11.5 4v11.5M2.5 15.5h10" />
          <path d="M5.5 6h4M11.5 7l2.5 2v4.5a1 1 0 0 0 2 0V8L14 5.5" />
        </svg>
      );
    case 'park':
      return (
        <svg {...common}>
          <path d="M9 2l4.5 7h-3l3 4.5h-9l3-4.5h-3z" />
          <path d="M9 13.5V16" />
        </svg>
      );
    case 'parking':
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="13" height="13" rx="3.5" />
          <path d="M7 12.5v-7h2.5a2 2 0 0 1 0 4H7" />
        </svg>
      );
    case 'shop':
      return (
        <svg {...common}>
          <path d="M3.5 6.5h11l-1 9h-9z" />
          <path d="M6.5 6.5V5a2.5 2.5 0 0 1 5 0v1.5" />
        </svg>
      );
    case 'address':
      return (
        <svg {...common}>
          <path d="M2.5 8.5L9 3l6.5 5.5" />
          <path d="M4.5 7v8h9V7" />
        </svg>
      );
    case 'street':
      return (
        <svg {...common}>
          <path d="M6 2.5L4 15.5M12 2.5l2 13" />
          <path d="M9 3.5v2M9 8v2M9 12.5v2" />
        </svg>
      );
    case 'place':
      return (
        <svg {...common}>
          <path d="M2.5 15.5h13M4 15.5V8l3-2v9.5M7 6V3.5h5v12M12 9h2.5v6.5" />
        </svg>
      );
    case 'poi':
    default:
      return (
        <svg {...common}>
          <path d="M9 16s-5-4.6-5-8.5a5 5 0 0 1 10 0C14 11.4 9 16 9 16z" />
          <circle cx="9" cy="7.5" r="1.8" />
        </svg>
      );
  }
}
