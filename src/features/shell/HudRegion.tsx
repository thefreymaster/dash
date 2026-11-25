/**
 * One positioned region of the cluster. Regions never animate and never catch pointer
 * events themselves (taps on empty areas reach the map); their direct children do.
 *
 * Geometry, using the safe-area-aware insets from `global.css`
 * (`--hud-l/r/t/b`: notch / Dynamic Island on either side, home indicator at the bottom):
 *
 *   ┌ topLeft ───────────── topCenter ───────────── topRight ┐  44px strip
 *   │ left (speedometer)        center (notices)              │
 *   │                                                         │
 *   └ bottomLeft ──────── bottomCenter ──────── bottomRight ┘  44px strip (`HudBottomStrip`)
 *
 * The bottom three sit in one flex row: `bottomCenter` takes exactly the room left between
 * the compass and the chip column (it is a CSS container, so its content can size itself to
 * that room), which is how a notice there can never overlap either side.
 */
import { Box, type SystemStyleObject } from '@chakra-ui/react';
import { useMemo, type ReactNode } from 'react';
import { HudSlotContext, type EntranceFrom, type HudArea } from './hud';

/** Height of the top and bottom strips plus the gap below/above them. */
const STRIP = '52px';
/** Speedometer width plus the gap to its right. */
const SPEEDO = '240px';

const AREAS: Record<HudArea, SystemStyleObject> = {
  topLeft: { top: 'var(--hud-t)', left: 'var(--hud-l)', alignItems: 'flex-start' },
  topCenter: {
    top: 'var(--hud-t)',
    left: 'var(--hud-l)',
    right: 'var(--hud-r)',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  topRight: { top: 'var(--hud-t)', right: 'var(--hud-r)', alignItems: 'flex-start' },
  left: { top: `calc(var(--hud-t) + ${STRIP})`, left: 'var(--hud-l)' },
  center: {
    top: `calc(var(--hud-t) + ${STRIP})`,
    bottom: `calc(var(--hud-b) + ${STRIP})`,
    left: `calc(var(--hud-l) + ${SPEEDO})`,
    right: 'var(--hud-r)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // In the bottom strip's flex row (see `HudBottomStrip`), not positioned themselves.
  bottomLeft: { position: 'relative', flex: 'none', alignItems: 'flex-end' },
  bottomCenter: {
    position: 'relative',
    flex: '1 1 0',
    minW: '0',
    h: '44px',
    alignSelf: 'flex-end',
    alignItems: 'center',
    justifyContent: 'center',
    containerType: 'inline-size',
  },
  bottomRight: {
    position: 'relative',
    flex: 'none',
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: '8px',
  },
};

/** The bottom strip: one row at the home-indicator inset holding the three `bottom*` regions. */
export function HudBottomStrip({ children }: { children?: ReactNode }) {
  return (
    <Box
      data-hud-strip="bottom"
      position="absolute"
      left="var(--hud-l)"
      right="var(--hud-r)"
      bottom="var(--hud-b)"
      display="flex"
      alignItems="flex-end"
      pointerEvents="none"
    >
      {children}
    </Box>
  );
}

export function HudRegion({
  area,
  order,
  from,
  children,
}: {
  area: HudArea;
  order: number;
  from: EntranceFrom;
  children?: ReactNode;
}) {
  const slot = useMemo(() => ({ order, from }), [order, from]);
  return (
    <HudSlotContext value={slot}>
      <Box
        data-hud-region={area}
        position="absolute"
        display="flex"
        pointerEvents="none"
        css={{ '& > *': { pointerEvents: 'auto' } }}
        {...AREAS[area]}
      >
        {children}
      </Box>
    </HudSlotContext>
  );
}
