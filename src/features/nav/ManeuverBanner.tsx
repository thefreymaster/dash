/**
 * T29 Maneuver banner (mockup `.w-banner`, 352×78, radius 26, strong glass): the next
 * maneuver's arrow, the distance to it (counting down, in `settings.units`) and the street.
 * Each new maneuver slides in from the right while the old one leaves to the left; the arrow
 * pops. While there is no usable route it explains why (finding route, waiting for GPS,
 * offline, no route + Retry, no token) and shows the arrival moment at the end. Off the route
 * it says so ("Off route · Rerouting…", or why the reroute has not come yet) with the maneuver
 * that no longer applies dimmed. Rendered by the top-centre slot while navigating; takes no
 * props, and its parts read the nav view themselves.
 */
import { Box, Flex, Text, chakra } from '@chakra-ui/react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { formatDistanceParts } from '../../lib';
import { nav, settings } from '../../state';
import { motionTokens, swapTransition } from '../../theme';
import { GlassWidget } from '../shell/GlassWidget';
import { Roll } from '../trip/Roll';
import { maneuverIcon, maneuverPhrase, phraseText, type ManeuverIcon } from './maneuver';
import { ManeuverGlyph } from './ManeuverIcon';
import { retryRoute } from './actions';
import { navView, type RouteStatus } from './navState';
import { Spinner, WarningGlyph } from './glyphs';

const MotionBox = motion.create(Box);
const MotionFlex = motion.create(Flex);
const MotionButton = motion.create(chakra.button);

const swapIn = { opacity: 0, x: 24 };
const swapOut = { opacity: 0, x: -24 };

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
  if (!next) return <Waiting />;
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
          {/* The countdown rolls like the trip numbers (down as the turn gets closer). */}
          <Roll text={dist.value} order={next.distanceM} />
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

function Waiting() {
  const status = navView.use((v) => v.status);
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

function Problem() {
  const status = navView.use((v) => v.status);
  const message = navView.use((v) => v.message);
  const title = status === 'no-token' ? 'Directions unavailable' : status === 'no-route' ? 'No route found' : 'Route failed';
  const sub = status === 'no-token' ? 'This build has no Mapbox token' : (message ?? 'Try again in a moment');
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

/** Off the route: the next maneuver no longer applies (dimmed) while a new route comes. */
function OffRoute() {
  const next = navView.use((v) => v.progress?.next ?? null);
  const message = navView.use((v) => v.message);
  const icon: ManeuverIcon | null = next ? maneuverIcon(next.step.maneuver.type, next.step.maneuver.modifier) : null;
  return (
    <>
      <MotionBox flex="none" initial={{ opacity: 1 }} animate={{ opacity: 0.4 }} transition={{ duration: 0.6, ease: motionTokens.easeOut }}>
        <IconTile tone="quiet" swapKey={icon ? `${icon.shape}${icon.mirrored ? 'L' : 'R'}` : 'spinner'}>
          {icon ? <ManeuverGlyph icon={icon} /> : <Spinner size={30} />}
        </IconTile>
      </MotionBox>
      <SwapText swapKey={message ? 'off-route-failed' : 'off-route'}>
        <Headline>Off route</Headline>
        <Subline>{message ? `${message} · retrying…` : 'Rerouting…'}</Subline>
      </SwapText>
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

/**
 * Which of the components below `BannerContent` shows. They are different component trees, so
 * a change of kind is cross-faded as a whole (within one kind, `IconTile` / `SwapText` animate).
 */
function contentKind(status: RouteStatus, hasNext: boolean): string {
  switch (status) {
    case 'active':
    case 'rerouting':
      return hasNext ? 'active' : 'waiting';
    case 'off-route':
      return 'off-route';
    case 'arrived':
      return 'arrived';
    case 'no-token':
    case 'no-route':
    case 'error':
      return 'problem';
    default:
      return 'waiting';
  }
}

function BannerContent() {
  const status = navView.use((v) => v.status);
  switch (status) {
    case 'active':
    case 'rerouting': // back on the previous route while a new one loads: its guidance applies
      return <ActiveGuidance />;
    case 'off-route':
      return <OffRoute />;
    case 'arrived':
      return <Arrived />;
    case 'no-token':
    case 'no-route':
    case 'error':
      return <Problem />;
    case 'idle':
    case 'routing':
    case 'waiting-gps':
    case 'offline':
    default:
      return <Waiting />;
  }
}

export function ManeuverBanner() {
  const status = navView.use((v) => v.status);
  const hasNext = navView.use((v) => v.progress?.next != null);
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
      <AnimatePresence mode="popLayout" initial={false}>
        <MotionFlex
          key={contentKind(status, hasNext)}
          align="center"
          gap="14px"
          flex="1"
          minW="0"
          h="full"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={swapTransition}
        >
          <BannerContent />
        </MotionFlex>
      </AnimatePresence>
    </GlassWidget>
  );
}
