/**
 * T29 ETA chip (mockup `.w-eta`: 58 px tall, radius 22, strong glass): arrival clock time,
 * minutes · distance remaining, destination name and a 44 px cancel button that ends
 * navigation. Values cross-fade when they change. While the route is loading or failed it
 * says so (and the cancel button is always there); on arrival it shows a short animated
 * "Arrived" — the engine then ends navigation by itself.
 * Rendered by the bottom-right slot while navigating; takes no props.
 */
import { Box, Flex, Text, chakra } from '@chakra-ui/react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { formatDistance } from '../../lib';
import { nav, settings } from '../../state';
import { motionTokens, swapTransition } from '../../theme';
import { GlassWidget } from '../shell/GlassWidget';
import { arrivalClock, formatMinutes } from './format';
import { CheckGlyph, CloseGlyph, Spinner, WarningGlyph } from './glyphs';
import { endNavigation } from './actions';
import { navView, type RouteStatus } from './navState';

const MotionBox = motion.create(Box);
const MotionButton = motion.create(chakra.button);

/**
 * Text that cross-fades (slight vertical drift) whenever `value` changes. The wrapper is a
 * `layout` node, so a value of a different width ("10 min" → "9 min") makes the chip — which
 * does not re-render itself — glide to its new width (see the LayoutGroup in `EtaChip`).
 */
function Fade({ value, children }: { value: string; children?: ReactNode }) {
  return (
    <MotionBox as="span" layout="position" transition={{ layout: swapTransition.default }} position="relative" display="inline-block">
      <AnimatePresence mode="popLayout" initial={false}>
        <MotionBox
          as="span"
          key={value}
          display="inline-block"
          whiteSpace="nowrap"
          initial={{ opacity: 0, y: 7 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -7 }}
          transition={swapTransition}
        >
          {children ?? value}
        </MotionBox>
      </AnimatePresence>
    </MotionBox>
  );
}

/** Wall-clock time, refreshed every 15 s (the arrival time has minute resolution). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <Flex
      direction="column"
      justify="center"
      gap="4px"
      minW="0"
      pl="14px"
      borderLeftWidth="1px"
      borderColor="glass.controlHover"
    >
      {children}
    </Flex>
  );
}

const Caption = ({ children }: { children: ReactNode }) => (
  <Text fontSize="13px" fontWeight="500" lineHeight="1" color="text.secondary" truncate maxW="190px">
    {children}
  </Text>
);

function ActiveValues() {
  // Off the route (frozen progress) or a new route loading: the numbers are about to change.
  const dim = navView.use((v) => v.status === 'off-route' || v.status === 'rerouting');
  const remainingS = navView.use((v) => v.progress?.remainingS ?? 0);
  const remainingM = navView.use((v) => v.progress?.remainingM ?? 0);
  const units = settings.use((s) => s.units);
  const name = nav.use((n) => n.destination?.name ?? '');
  // The clock ticks every 15 s; progress re-renders this at ~1 Hz while moving.
  const now = useMinuteClock();
  const eta = arrivalClock(now, remainingS);
  const meta = `${formatMinutes(remainingS)} · ${formatDistance(remainingM, units)}`;
  return (
    <MotionBox display="flex" alignItems="center" gap="14px" minW="0" animate={{ opacity: dim ? 0.5 : 1 }} transition={{ duration: 0.3 }}>
      <Flex direction="column" gap="3px" flex="none">
        <Text as="div" textStyle="numeric" fontWeight="600" fontSize="24px" lineHeight="1" aria-label={`Arrival at ${eta}`}>
          <Fade value={eta} />
        </Text>
        <Text fontSize="13px" fontWeight="500" lineHeight="1" color="text.secondary">
          arrival
        </Text>
      </Flex>
      <Divider>
        <Text as="div" textStyle="numeric" fontWeight="600" fontSize="16px" lineHeight="1">
          <Fade value={meta} />
        </Text>
        <Caption>{name}</Caption>
      </Divider>
    </MotionBox>
  );
}

function StatusValues() {
  const status = navView.use((v) => v.status);
  const name = nav.use((n) => n.destination?.name ?? '');
  const problem = status === 'no-route' || status === 'error' || status === 'no-token';
  const title =
    status === 'no-route'
      ? 'No route'
      : status === 'error'
        ? 'Route failed'
        : status === 'no-token'
          ? 'Can’t navigate'
          : status === 'waiting-gps'
            ? 'Waiting for GPS'
            : status === 'offline'
              ? 'Offline'
              : 'Finding route';
  return (
    <Flex align="center" gap="12px" minW="0">
      <Box flex="none" color={problem ? 'warning.fg' : 'accent.fg'} display="grid" placeItems="center" w="28px">
        {problem ? <WarningGlyph size={22} /> : <Spinner size={22} />}
      </Box>
      <Flex direction="column" gap="4px" minW="0">
        <Text fontFamily="display" fontWeight="600" fontSize="17px" lineHeight="1">
          <Fade value={title} />
        </Text>
        <Caption>{name}</Caption>
      </Flex>
    </Flex>
  );
}

/** A route is on screen and being followed (possibly off it for a moment, or a new one loading). */
const isGuiding = (status: RouteStatus) => status === 'active' || status === 'rerouting' || status === 'off-route';

function ArrivedValues() {
  const name = nav.use((n) => n.destination?.name ?? '');
  return (
    <Flex align="center" gap="12px" minW="0">
      <MotionBox
        flex="none"
        w="34px"
        h="34px"
        rounded="full"
        display="grid"
        placeItems="center"
        bgImage="accent"
        color="white"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.55, ease: motionTokens.easeSpring }}
      >
        <CheckGlyph size={20} />
      </MotionBox>
      <Flex direction="column" gap="4px" minW="0">
        <Text fontFamily="display" fontWeight="600" fontSize="18px" lineHeight="1">
          Arrived
        </Text>
        <Caption>{name}</Caption>
      </Flex>
    </Flex>
  );
}

export function EtaChip() {
  const status = navView.use((v) => v.status);
  const hasProgress = navView.use((v) => v.progress !== null);
  const view = status === 'arrived' ? 'arrived' : isGuiding(status) && hasProgress ? 'active' : 'status';
  return (
    // The chip re-renders only when its view changes; the LayoutGroup lets the values inside
    // (`Fade`) make it re-measure when their width changes.
    <LayoutGroup>
    <GlassWidget
      strong
      role="region"
      aria-label="Trip to destination"
      h="58px"
      display="flex"
      alignItems="center"
      gap="14px"
      pl="18px"
      pr="7px"
      maxW="calc(100vw - var(--hud-l) - var(--hud-r) - 280px)"
      layout
      // Radius as a style so Motion keeps it while the chip scales to a new width.
      style={{ borderRadius: 22 }}
      transition={{ layout: swapTransition.default }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <MotionBox
          key={view}
          minW="0"
          layout="position"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, ease: motionTokens.easeOut }}
        >
          {view === 'active' ? (
            <ActiveValues />
          ) : view === 'arrived' ? (
            <ArrivedValues />
          ) : (
            <StatusValues />
          )}
        </MotionBox>
      </AnimatePresence>
      <MotionButton
        type="button"
        layout="position"
        aria-label="End route"
        onClick={endNavigation}
        flex="none"
        w="44px"
        h="44px"
        rounded="16px"
        display="grid"
        placeItems="center"
        bg="warning.subtle"
        color="warning.fg"
        cursor="pointer"
        focusVisibleRing="inside"
        whileTap={{ scale: 0.92 }}
      >
        <CloseGlyph size={18} />
      </MotionButton>
    </GlassWidget>
    </LayoutGroup>
  );
}
