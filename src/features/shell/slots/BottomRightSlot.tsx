/**
 * SLOT · bottom-right corner, bottom-aligned at the home-indicator inset.
 * TRIP pill + sheet (T25) normally; the ETA CHIP (T29) INSTEAD while navigating.
 *
 * The region is a right-aligned column; the map's `RecenterChip` sits directly ABOVE this
 * slot in the same column, so whatever renders here pushes it up and the two can never
 * overlap (the trip sheet keeps an in-flow footprint that tweens with its morph, so the
 * chip glides rather than jumps).
 *
 * Swap: `AnimatePresence` in `popLayout` mode, anchored bottom-right — the outgoing widget
 * is lifted out of the flow where it stands and plays its own exit (its `GlassWidget`), the
 * incoming one takes its place and enters. During boot the slot keeps the region's stagger
 * position; a swap later enters right after the outgoing widget starts leaving.
 */
import { Box } from '@chakra-ui/react';
import { AnimatePresence } from 'motion/react';
import { useContext, useState, type ReactNode } from 'react';
import { ui } from '../../../state';
import { EtaChip, useIsNavigating } from '../../nav';
import { TripStrip } from '../../trip';
import { HudSlotContext, type HudSlot } from '../hud';

/** Entrance timing for one swapped-in widget, fixed when it mounts. */
function Entrance({ children }: { children: ReactNode }) {
  const region = useContext(HudSlotContext);
  const [slot] = useState<HudSlot>(() =>
    ui.get().phase === 'cluster' ? { order: 0, from: region.from } : region,
  );
  return <HudSlotContext value={slot}>{children}</HudSlotContext>;
}

export function BottomRightSlot() {
  const navigating = useIsNavigating();
  return (
    <AnimatePresence mode="popLayout" anchorX="right" anchorY="bottom">
      {navigating ? (
        <Box key="eta" data-swap="eta" display="flex" justifyContent="flex-end">
          <Entrance>
            <EtaChip />
          </Entrance>
        </Box>
      ) : (
        <Box key="trip" data-swap="trip" display="flex" justifyContent="flex-end">
          <Entrance>
            <TripStrip />
          </Entrance>
        </Box>
      )}
    </AnimatePresence>
  );
}
