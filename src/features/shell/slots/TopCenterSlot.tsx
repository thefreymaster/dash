/**
 * SLOT · top-centre, between the clock pill and the GPS/settings pill.
 *   not navigating   ROAD NAME pill (T22, `src/features/road`) — tap it to search a destination
 *   navigating       MANEUVER BANNER (T29, `src/features/nav`)
 *
 * The region is a full-width row, horizontally centred, top-aligned at the safe top inset.
 * The two surfaces swap with `AnimatePresence`: both sit in the same grid cell, so the
 * leaving one plays its exit (each is a `GlassWidget`, which animates itself) while the
 * incoming one enters in place — no layout jump, no wait. The stacking wrapper spans the
 * region (so `%` widths inside resolve against the strip) and ignores pointer events; the
 * glass surfaces themselves catch taps.
 * Mockup: `.w-road` (208×44 pill) and `.w-banner` (352×78, radius 26, `strong`). Keep clear
 * of the speedometer: it starts 52px below the strip, at the left safe inset, 224px wide.
 * The road pill is centred on the strip; the banner is taller than the strip, so it is
 * centred in the room right of the speedometer and left of the GPS pill instead (the mockup
 * offsets it the same way) and narrows to fit on small phones.
 */
import { Box } from '@chakra-ui/react';
import { AnimatePresence } from 'motion/react';
import { ManeuverBanner, searchOpen, useIsNavigating } from '../../nav';
import { RoadName } from '../../road';

/** Speedometer width (224px) + gap: the banner reaches below the strip, beside the speedometer. */
const BANNER_CLEAR_LEFT = '236px';
/** Widest GPS/settings pill ("DEMO", 144px) + gap. */
const BANNER_CLEAR_RIGHT = '156px';

export function TopCenterSlot() {
  const navigating = useIsNavigating();
  // The road pill opens the destination search; while that sheet is open the pill steps
  // aside (on narrow phones it would peek out from under the sheet) and returns on close.
  const searching = searchOpen.use();
  return (
    <Box
      data-slot="top-center"
      display="grid"
      // One track exactly as wide as the strip: the banner's clearance padding must not widen it.
      gridTemplateColumns="minmax(0, 1fr)"
      w="full"
      justifyItems="center"
      alignItems="start"
      // Inline so it beats the region's `& > * { pointer-events: auto }`.
      style={{ pointerEvents: 'none' }}
    >
      <AnimatePresence>
        {navigating ? (
          <Box
            key="banner"
            gridArea="1 / 1"
            w="full"
            display="flex"
            justifyContent="center"
            pl={BANNER_CLEAR_LEFT}
            pr={BANNER_CLEAR_RIGHT}
          >
            <ManeuverBanner />
          </Box>
        ) : searching ? null : (
          <Box key="road" gridArea="1 / 1" w="full" display="flex" justifyContent="center">
            <RoadName />
          </Box>
        )}
      </AnimatePresence>
    </Box>
  );
}
