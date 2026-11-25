/**
 * T29 Maneuver banner (mockup `.w-banner`, 352×78, radius 26, strong glass): the next
 * maneuver's arrow, the distance to it (counting down, in `settings.units`) and the street.
 * Each new maneuver slides in from the right while the old one leaves to the left; the arrow
 * pops. While there is no usable route it explains why (finding route, waiting for GPS,
 * offline, no route + Retry, no token) and shows the arrival moment at the end.
 * Rendered by the top-centre slot while navigating; takes no props.
 */
import { Box, Flex, Text, chakra } from '@chakra-ui/react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { formatDistanceParts } from '../../lib';
import { nav, settings } from '../../state';
import { motionTokens } from '../../theme';
import { GlassWidget } from '../shell/GlassWidget';
import { maneuverIcon, maneuverPhrase, phraseText, type ManeuverIcon } from './maneuver';
import { ManeuverGlyph } from './ManeuverIcon';
import { retryRoute } from './actions';
import { navView, type RouteStatus } from './navState';
import { Spinner, WarningGlyph } from './glyphs';

const MotionBox = motion.create(Box);
const MotionButton = motion.create(chakra.button);

const swapIn = { opacity: 0, x: 24 };
const swapOut = { opacity: 0, x: -24 };
const swapTransition = {
  x: { duration: 0.55, ease: motionTokens.easeOut },
  opacity: { duration: 0.45, ease: motionTokens.easeOut },
};

/** Icon tile: accent gradient for guidance, warning gradient for problems. */
function IconTile({ tone, swapKey, children }: { tone: 'accent' | 'warning' | 'quiet'; swapKey: string; children: ReactNode }) {
  return (
    <Box
      flex="none"
      position="relative"
      w="54px"
      h="54px"
      rounded="16px"
      display="grid"
      placeItems="center"
      overflow="hidden"
      bgImage={tone === 'warning' ? 'warning' : tone === 'accent' ? 'accent' : undefined}
      bg={tone === 'quiet' ? 'glass.control' : undefined}
      color={tone === 'quiet' ? 'accent.fg' : 'white'}
      boxShadow={tone === 'quiet' ? 'none' : 'inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 6px 16px var(--chakra-colors-accent-subtle)'}
      // Tone changes (spinner → arrow → warning) fade; theme colours follow `<html>` by themselves.
      transition="background-color 0.5s, box-shadow 0.5s"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <MotionBox
          key={swapKey}
          display="grid"
          placeItems="center"
          initial={{ opacity: 0, scale: 0.5, rotate: -12 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2 } }}
          transition={{ duration: 0.5, ease: motionTokens.easeSpring }}
        >
          {children}
        </MotionBox>
      </AnimatePresence>
    </Box>
  );
}

/** Two-line text block that slides when `swapKey` changes. */
function SwapText({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  return (
    <Box position="relative" flex="1" minW="0" h="56px">
      <AnimatePresence initial={false}>
        <MotionBox
          key={swapKey}
          position="absolute"
          inset="0"
          display="flex"
          flexDirection="column"
          justifyContent="center"
          gap="3px"
          initial={swapIn}
          animate={{ opacity: 1, x: 0 }}
          exit={swapOut}
          transition={swapTransition}
        >
          {children}
        </MotionBox>
      </AnimatePresence>
    </Box>
  );
}

const Headline = ({ children }: { children: ReactNode }) => (
  <Text fontFamily="display" fontWeight="600" fontSize="22px" lineHeight="1.1" letterSpacing="-0.01em" truncate>
    {children}
  </Text>
);

const Subline = ({ children }: { children: ReactNode }) => (
  <Text fontSize="15px" fontWeight="500" lineHeight="1.2" color="text.secondary" truncate>
    {children}
  </Text>
);

function ActiveGuidance() {
  const next = navView.use((v) => v.progress?.next ?? null);
  const units = settings.use((s) => s.units);
  const destinationName = nav.use((n) => n.destination?.name ?? null);
  if (!next) return <Waiting status="routing" />;
  const icon: ManeuverIcon = maneuverIcon(next.step.maneuver.type, next.step.maneuver.modifier);
  const phrase = maneuverPhrase(next.step, destinationName);
  const dist = formatDistanceParts(next.distanceM, units);
  // Keyed by what the maneuver IS (not its index), so a route refresh does not replay the swap.
  const key = `${next.step.maneuver.type}:${next.step.maneuver.modifier}:${next.step.maneuver.location.map((n) => n.toFixed(5)).join(',')}`;
  return (
    <>
      <IconTile tone="accent" swapKey={`${icon.shape}${icon.mirrored ? 'L' : 'R'}`}>
        <ManeuverGlyph icon={icon} />
      </IconTile>
      <SwapText swapKey={key}>
        <Text
          as="div"
          textStyle="numeric"
          fontWeight="600"
          fontSize="27px"
          lineHeight="1"
          letterSpacing="-0.01em"
          aria-label={`In ${dist.value} ${dist.unit}, ${phraseText(phrase)}`}
        >
          {dist.value}
          <Text as="small" fontSize="16px" fontWeight="600" color="text.secondary" ml="3px">
            {dist.unit}
          </Text>
        </Text>
        <Text fontSize="15px" fontWeight="500" lineHeight="1.2" color="text.secondary" truncate>
          {phrase.target ? (
            <>
              {phrase.verb}
              {phrase.joiner ? ` ${phrase.joiner} ` : ' '}
              <Text as="b" fontWeight="700" color="text.primary">
                {phrase.target}
              </Text>
            </>
          ) : (
            <Text as="b" fontWeight="700" color="text.primary">
              {phrase.verb}
            </Text>
          )}
        </Text>
      </SwapText>
    </>
  );
}

const WAITING_COPY: Partial<Record<RouteStatus, { title: string; sub: (dest: string) => string }>> = {
  routing: { title: 'Finding route…', sub: (d) => `To ${d}` },
  rerouting: { title: 'Rerouting…', sub: (d) => `New way to ${d}` },
  'waiting-gps': { title: 'Waiting for GPS…', sub: () => 'Guidance starts once you’re located' },
  offline: { title: 'Waiting for connection…', sub: () => 'The route loads when you’re back online' },
};

function Waiting({ status }: { status: RouteStatus }) {
  const destinationName = nav.use((n) => n.destination?.name ?? 'destination');
  const copy = WAITING_COPY[status] ?? WAITING_COPY.routing!;
  return (
    <>
      <IconTile tone="quiet" swapKey="spinner">
        <Spinner size={30} />
      </IconTile>
      <SwapText swapKey={status}>
        <Headline>{copy.title}</Headline>
        <Subline>{copy.sub(destinationName)}</Subline>
      </SwapText>
    </>
  );
}

function Problem({ status }: { status: RouteStatus }) {
  const message = navView.use((v) => v.message);
  const title = status === 'no-token' ? 'Directions unavailable' : status === 'no-route' ? 'No route found' : 'Route failed';
  const sub = status === 'no-token' ? 'Add a Mapbox token to navigate' : (message ?? 'Try again in a moment');
  return (
    <>
      <IconTile tone="warning" swapKey="warning">
        <WarningGlyph size={30} />
      </IconTile>
      <SwapText swapKey={status}>
        <Headline>{title}</Headline>
        <Subline>{sub}</Subline>
      </SwapText>
      {status !== 'no-token' && (
        <MotionButton
          type="button"
          onClick={retryRoute}
          flex="none"
          h="44px"
          px="14px"
          rounded="14px"
          bg="accent.subtle"
          color="accent.fg"
          fontWeight="600"
          fontSize="16px"
          cursor="pointer"
          focusVisibleRing="inside"
          whileTap={{ scale: 0.94 }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          Retry
        </MotionButton>
      )}
    </>
  );
}

function Arrived() {
  const name = nav.use((n) => n.destination?.name ?? 'your destination');
  return (
    <>
      <IconTile tone="accent" swapKey="arrive">
        <MotionBox
          display="grid"
          placeItems="center"
          initial={{ y: -10 }}
          animate={{ y: [-10, 0, -4, 0] }}
          transition={{ duration: 0.9, ease: motionTokens.easeOut }}
        >
          <ManeuverGlyph icon={{ shape: 'arrive', mirrored: false }} />
        </MotionBox>
      </IconTile>
      <SwapText swapKey="arrived">
        <Headline>You’ve arrived</Headline>
        <Text fontSize="15px" fontWeight="700" lineHeight="1.2" color="text.primary" truncate>
          {name}
        </Text>
      </SwapText>
    </>
  );
}

function BannerContent({ status }: { status: RouteStatus }) {
  switch (status) {
    case 'active':
      return <ActiveGuidance />;
    case 'arrived':
      return <Arrived />;
    case 'no-token':
    case 'no-route':
    case 'error':
      return <Problem status={status} />;
    case 'idle':
    case 'routing':
    case 'rerouting':
    case 'waiting-gps':
    case 'offline':
    default:
      return <Waiting status={status} />;
  }
}

export function ManeuverBanner() {
  const status = navView.use((v) => v.status);
  return (
    <GlassWidget
      strong
      role="region"
      aria-label="Next maneuver"
      w="352px"
      maxW="100%"
      h="78px"
      rounded="glass.lg"
      display="flex"
      alignItems="center"
      gap="14px"
      pl="12px"
      pr={status === 'no-route' || status === 'error' ? '12px' : '18px'}
      overflow="hidden"
    >
      <Flex align="center" gap="14px" flex="1" minW="0" h="full">
        <BannerContent status={status} />
      </Flex>
    </GlassWidget>
  );
}
