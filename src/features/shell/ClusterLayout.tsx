/**
 * T16 Cluster layout — the HUD regions over the full-bleed map (mockup `.hud`).
 *
 *   topLeft       clock pill: Clock + TopLeftSlot (outside temperature)
 *   topCenter     TopCenterSlot (road name / maneuver banner)
 *   topRight      GPS signal + settings button
 *   left          Speedometer
 *   center        location notice when GPS is denied/unavailable
 *   bottomLeft    CompassTape
 *   bottomCenter  MapNotice ("Map off" in a build without a Mapbox token), in the free gap
 *   bottomRight   RecenterChip (map) stacked above BottomRightSlot (trip / ETA)
 *   overlay       OverlaySlot (destination search)
 *
 * Mounted for both the `boot` and `cluster` phases, so the boot stagger is the HUD's one
 * and only entrance. The root and regions ignore pointer events — empty areas pan the map.
 * Regions sit inside the `--hud-*` insets (`global.css`), which follow the safe areas on
 * all four sides, so the Dynamic Island may be on either side.
 *
 * Sheets: settings, trip and destination search each own their open state; the layout keeps
 * at most one of them open (`oneSheetAtATime`).
 */
import { Box } from '@chakra-ui/react';
import { LayoutGroup } from 'motion/react';
import { useEffect } from 'react';
import { CompassTape } from '../compass';
import { MapNotice, RecenterChip } from '../map';
import { closeDestinationSearch, searchOpen } from '../nav';
import { Speedometer } from '../speed';
import { Clock, GpsNotice, GpsSignal, SettingsButton } from '../status';
import { closeTripSheet, tripSheetOpen } from '../trip';
import { swapTransition } from '../../theme';
import { GlassWidget } from './GlassWidget';
import { HudBottomStrip, HudRegion } from './HudRegion';
import { SettingsSheet } from './SettingsSheet';
import { closeSettings, settingsOpen } from './settingsOpen';
import { oneSheetAtATime } from './sheets';
import { BottomRightSlot } from './slots/BottomRightSlot';
import { OverlaySlot } from './slots/OverlaySlot';
import { TopCenterSlot } from './slots/TopCenterSlot';
import { TopLeftSlot } from './slots/TopLeftSlot';

/**
 * A 44px glass pill whose width follows content it does not render itself (the time, the
 * temperature, the GPS label). Those children re-render without the pill; inside a
 * LayoutGroup their `layout` updates (and their AnimatePresence exits) make the pill measure
 * again, so it glides to the new width instead of snapping. The radius is a style so Motion
 * keeps it round while it scales.
 */
const PILL_LAYOUT = { layout: swapTransition.default } as const;

/** Clock pill. The temperature slot sits after a hairline divider that only exists when the slot renders. */
function ClockPill() {
  return (
    <LayoutGroup>
      <GlassWidget
        layout
        transition={PILL_LAYOUT}
        h="44px"
        style={{ borderRadius: 22 }}
        display="flex"
        alignItems="center"
        pl="18px"
        pr="16px"
        gap="10px"
      >
        <Clock />
        <Box
          data-slot="top-left"
          display="flex"
          alignItems="center"
          gap="10px"
          _before={{
            content: '""',
            w: '1px',
            h: '18px',
            bg: 'text.tertiary',
            opacity: 0.7,
            // Fades in when the slot first renders something (it was `display: none`).
            animation: `dash-fade-in ${swapTransition.default.duration}s ease-out`,
          }}
          _empty={{ display: 'none' }}
        >
          <TopLeftSlot />
        </Box>
      </GlassWidget>
    </LayoutGroup>
  );
}

/** GPS signal + settings button pill. */
function StatusPill() {
  return (
    <LayoutGroup>
      <GlassWidget
        layout
        transition={PILL_LAYOUT}
        h="44px"
        style={{ borderRadius: 22 }}
        display="flex"
        alignItems="center"
        pl="16px"
        gap="8px"
      >
        <GpsSignal />
        <SettingsButton />
      </GlassWidget>
    </LayoutGroup>
  );
}

export function ClusterLayout() {
  useEffect(
    () =>
      oneSheetAtATime([
        { open: settingsOpen, close: closeSettings },
        { open: tripSheetOpen, close: closeTripSheet },
        { open: searchOpen, close: closeDestinationSearch },
      ]),
    [],
  );

  return (
    <Box data-hud="" position="absolute" inset="0" zIndex="1" pointerEvents="none">
      <HudRegion area="topLeft" order={0} from="top">
        <ClockPill />
      </HudRegion>
      <HudRegion area="topCenter" order={1} from="top">
        <TopCenterSlot />
      </HudRegion>
      <HudRegion area="topRight" order={2} from="top">
        <StatusPill />
      </HudRegion>
      <HudRegion area="left" order={3} from="left">
        <Speedometer />
      </HudRegion>
      <HudRegion area="center" order={4} from="scale">
        <GpsNotice />
      </HudRegion>
      <HudBottomStrip>
        <HudRegion area="bottomLeft" order={5} from="bottom">
          <CompassTape />
        </HudRegion>
        <HudRegion area="bottomCenter" order={6} from="bottom">
          <MapNotice />
        </HudRegion>
        <HudRegion area="bottomRight" order={7} from="bottom">
          <RecenterChip />
          <BottomRightSlot />
        </HudRegion>
      </HudBottomStrip>
      <Box data-slot="overlay" position="absolute" inset="0" pointerEvents="none">
        <OverlaySlot />
      </Box>
      <SettingsSheet />
    </Box>
  );
}
