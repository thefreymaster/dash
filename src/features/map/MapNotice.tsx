/**
 * "Map off" notice for a build without a Mapbox token (the land colour fills the screen
 * instead of a map). A compact, non-interactive glass pill that the shell places in the free
 * gap of the bottom strip, between the compass and the trip / ETA chip. That gap is a CSS
 * container, so the text shortens to the room it gets and the pill disappears when there is
 * none (e.g. while the trip sheet is open): it never overlaps or blocks another widget.
 * Renders nothing when the map is available. The wording is true on a dev machine and on the
 * server alike.
 */
import { Box } from '@chakra-ui/react';
import { GlassWidget } from '../shell/GlassWidget';
import { isMapEnabled } from './mapInstance';

const FULL = 'Map off — this build has no Mapbox token';

/** Which text fits, by the width of the gap: measured pill width (SF Pro Text 13/600) + 24px. */
const FITS = {
  full: 340,
  medium: 244,
  short: 124,
} as const;

const show = (variant: 'full' | 'medium' | 'short') => ({ [`& [data-variant="${variant}"]`]: { display: 'inline' } });

export function MapNotice() {
  if (isMapEnabled()) return null;
  return (
    <GlassWidget
      role="status"
      aria-label={FULL}
      h="34px"
      maxW="calc(100% - 24px)"
      pl="10px"
      pr="13px"
      display="flex"
      alignItems="center"
      gap="7px"
      whiteSpace="nowrap"
      overflow="hidden"
      // Inline so it beats the region's `& > * { pointer-events: auto }`: taps go to the map.
      style={{ borderRadius: 17, pointerEvents: 'none' }}
      css={{
        '& [data-variant]': { display: 'none' },
        [`@container (min-width: ${FITS.full}px)`]: show('full'),
        [`@container (min-width: ${FITS.medium}px) and (max-width: ${FITS.full - 0.02}px)`]: show('medium'),
        [`@container (min-width: ${FITS.short}px) and (max-width: ${FITS.medium - 0.02}px)`]: show('short'),
        [`@container (max-width: ${FITS.short - 0.02}px)`]: { display: 'none' },
      }}
    >
      <MapOffIcon />
      <Box as="span" aria-hidden fontSize="13px" fontWeight="600" lineHeight="1" color="text.secondary">
        <span data-variant="full">{FULL}</span>
        <span data-variant="medium">Map off · no Mapbox token</span>
        <span data-variant="short">Map off</span>
      </Box>
    </GlassWidget>
  );
}

function MapOffIcon() {
  return (
    <Box as="span" flex="none" color="accent.fg" display="grid" placeItems="center" aria-hidden>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
        <path d="M9 4v14M15 6v5" />
        <path d="m3 3 18 18" />
      </svg>
    </Box>
  );
}
