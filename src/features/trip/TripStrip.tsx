/**
 * T25 TripStrip — the bottom-right trip pill (distance · moving time) that expands in place
 * into the trip sheet (distance, moving time, average, max, reset): mockup `.w-trip` →
 * `.w-tripsheet`.
 *
 * ONE ELEMENT. Pill and sheet are the same `GlassWidget` with `layout`: opening only changes
 * its size, radius and content, and Motion animates the box (transform, scale-corrected
 * children, radius corrected through `style`). The pill content and the sheet content
 * cross-fade inside it; the outgoing one is popped out anchored bottom-right, so it stays
 * exactly where it was while the glass grows or shrinks around it.
 *
 * FOOTPRINT. The glass is absolutely positioned at the bottom-right of a footprint box that
 * is in the region's flow. The footprint follows the glass's size with the same tween as
 * the layout animation, so the map's RecenterChip above glides with the sheet's visible top
 * edge — it never overlaps it, and never jumps.
 *
 * DISMISS. Tap outside (a full-screen catcher under the sheet), drag/flick it down, the
 * chevron button, or Escape — as the settings sheet. Reset needs a second, deliberate tap
 * on a button that appears away from the first tap and is ignored for a moment.
 *
 * RENDERS. Every number is its own component selecting exactly the string it shows (it
 * re-renders when that string changes, and rolls the changed characters). The strip itself
 * re-renders only on open/close and when the pill's character count changes (to animate
 * its width).
 */
import { Box, Flex, Grid, Text, chakra } from '@chakra-ui/react';
import {
  AnimatePresence,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  type PanInfo,
} from 'motion/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { formatDistanceParts, formatDuration, formatSpeed, speedUnitLabel } from '../../lib';
import { settings, telemetry } from '../../state';
import { motionTokens, swapTransition } from '../../theme';
import { GlassWidget } from '../shell/GlassWidget';
import { averageSpeedMps } from './accumulate';
import { distanceOrder, durationOrder, integerOrder, pillShape, tripSubtitle } from './format';
import { Roll } from './Roll';
import {
  TRIP_CLOSE_ID,
  TRIP_PILL_ID,
  TRIP_SHEET_ID,
  closeTripSheet,
  openTripSheet,
  resetShownTrip,
  takeFocusMove,
  tripSheetOpen,
  useTripValue,
} from './state';

const MotionBox = motion.create(Box);
const MotionFlex = motion.create(Flex);
const MotionButton = motion.create(chakra.button);

/** Pill ⇄ sheet morph. The footprint uses the same tween so the two stay in step. */
const MORPH = { duration: 0.5, ease: motionTokens.easeOut };
const SHEET_W = 368;
const PILL_RADIUS = 22;
const SHEET_RADIUS = 30;
/** Stay clear of the compass strip (260px, bottom-left) with a 16px gap on narrow phones. */
const SHEET_MAX_W = 'calc(100vw - var(--hud-l) - var(--hud-r) - 276px)';
/** Leave room for the top strip and a RecenterChip above the sheet on short screens. */
const SHEET_MAX_H = 'calc(100dvh - var(--hud-t) - var(--hud-b) - 106px)';
/** Drag-down distance or speed that dismisses the sheet. */
const DISMISS_OFFSET_PX = 70;
const DISMISS_VELOCITY = 500;

const contentIn = { opacity: 1, transition: { duration: 0.28, delay: 0.14, ease: motionTokens.easeOut } };
const contentOut = { opacity: 0, transition: { duration: 0.14, ease: motionTokens.easeOut } };
const swap = { duration: 0.3, ease: motionTokens.easeOut };
/** Same timing as the digits' slide in `Roll`. */
const swapUnit = swapTransition.default;

// ---------------------------------------------------------------------------
// Numbers (each selects only what it shows)
// ---------------------------------------------------------------------------

function NumberWithUnit({ text, order, unit, size }: { text: string; order: number; unit?: string; size: 'pill' | 'sheet' }) {
  const pill = size === 'pill';
  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="baseline"
      fontFamily="display"
      fontWeight="600"
      fontSize={pill ? '17px' : '26px'}
      lineHeight="1"
      letterSpacing={pill ? undefined : '-0.01em'}
      fontVariantNumeric="tabular-nums"
      whiteSpace="nowrap"
    >
      <Roll text={text} order={order} />
      {unit !== undefined && (
        // Slides along when the number gets wider or narrower.
        <MotionBox as="span" layout="position" transition={{ layout: swapUnit }} fontSize={pill ? '14px' : '15px'} color="text.secondary" ml={pill ? '2px' : '3px'} letterSpacing="0">
          <Roll text={unit} order={0} />
        </MotionBox>
      )}
    </Box>
  );
}

function PillDistance() {
  const units = settings.use((s) => s.units);
  const d = useTripValue((t) => formatDistanceParts(t.distanceM, units));
  return <NumberWithUnit size="pill" text={d.value} order={distanceOrder(d)} unit={d.unit} />;
}

function PillTime() {
  const text = useTripValue((t) => formatDuration(t.movingMs));
  return <NumberWithUnit size="pill" text={text} order={durationOrder(text)} />;
}

function SheetDistance() {
  const units = settings.use((s) => s.units);
  const d = useTripValue((t) => formatDistanceParts(t.distanceM, units));
  return <NumberWithUnit size="sheet" text={d.value} order={distanceOrder(d)} unit={d.unit} />;
}

function SheetMovingTime() {
  const text = useTripValue((t) => formatDuration(t.movingMs));
  return <NumberWithUnit size="sheet" text={text} order={durationOrder(text)} />;
}

function SheetAverage() {
  const units = settings.use((s) => s.units);
  const text = useTripValue((t) => formatSpeed(averageSpeedMps(t), units));
  return <NumberWithUnit size="sheet" text={text} order={integerOrder(text)} unit={speedUnitLabel(units)} />;
}

function SheetMax() {
  const units = settings.use((s) => s.units);
  const text = useTripValue((t) => formatSpeed(t.maxSpeedMps, units));
  return <NumberWithUnit size="sheet" text={text} order={integerOrder(text)} unit={speedUnitLabel(units)} />;
}

function TripSubtitle() {
  const demo = telemetry.use((t) => t.source === 'sim');
  const startedAt = useTripValue((t) => t.startedAt);
  // "Today" is decided when the sheet opens (it mounts on every open).
  const [openedAt] = useState(Date.now);
  const text = tripSubtitle(startedAt, demo, openedAt);
  return (
    <Box position="relative" mt="5px" h="14px" overflow="hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={text}
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 500,
            lineHeight: '14px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: 'var(--chakra-colors-text-secondary)',
          }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={swapTransition}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </Box>
  );
}

function StatTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box
      bg="glass.control"
      rounded="16px"
      px="14px"
      py="8px"
      h="58px"
      minW="0"
      display="flex"
      flexDirection="column"
      gap="6px"
    >
      <Text fontSize="13px" fontWeight="600" lineHeight="1" letterSpacing="0.02em" color="text.secondary">
        {label}
      </Text>
      {children}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Reset with a confirm step
// ---------------------------------------------------------------------------

type ResetPhase = 'idle' | 'confirm' | 'done';
/** The confirm row goes away by itself after this long, ms. */
const CONFIRM_TIMEOUT_MS = 5_000;
/** "Trip reset" feedback shows this long, ms. */
const DONE_MS = 1_800;
/** Taps on Reset this soon after the confirm row appeared are ignored (a double tap), ms. */
const ARM_MS = 450;

const ResetIcon = () => (
  <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9a6 6 0 1 0 1.8-4.3" />
    <path d="M3 3v3.5h3.5" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 9.5l3.5 3.5 7.5-8" />
  </svg>
);

function ResetControl() {
  const [phase, setPhase] = useState<ResetPhase>('idle');
  const [askedAt, setAskedAt] = useState(0);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusCancel = useRef(false);

  useEffect(() => {
    if (phase === 'idle') return;
    if (phase === 'confirm' && focusCancel.current) cancelRef.current?.focus({ preventScroll: true });
    focusCancel.current = false;
    const timer = window.setTimeout(() => setPhase('idle'), phase === 'confirm' ? CONFIRM_TIMEOUT_MS : DONE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const ask = (e: MouseEvent) => {
    focusCancel.current = e.detail === 0; // keyboard activation
    setAskedAt(e.timeStamp);
    setPhase('confirm');
  };
  const confirm = (e: MouseEvent) => {
    if (e.timeStamp - askedAt < ARM_MS) return;
    resetShownTrip();
    setPhase('done');
  };

  const button = {
    type: 'button' as const,
    h: '44px',
    rounded: '14px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    focusVisibleRing: 'inside' as const,
    whileTap: { scale: 0.96 },
  };

  return (
    <Box position="relative" h="44px" mt="8px" flexShrink={0}>
      <AnimatePresence initial={false} mode="popLayout">
        {phase === 'confirm' ? (
          <MotionFlex
            key="confirm"
            role="group"
            aria-label="Reset this trip?"
            h="44px"
            gap="8px"
            align="center"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={swap}
          >
            <MotionButton {...button} ref={cancelRef} px="16px" bg="glass.control" color="text.primary" onClick={() => setPhase('idle')}>
              Cancel
            </MotionButton>
            <Text flex="1" textAlign="center" fontSize="15px" fontWeight="600" color="text.secondary" whiteSpace="nowrap" aria-hidden>
              Reset trip?
            </Text>
            <MotionButton {...button} px="18px" bg="warning.solid" color="warning.contrast" onClick={confirm}>
              Reset
            </MotionButton>
          </MotionFlex>
        ) : (
          <MotionButton
            key="idle"
            {...button}
            w="full"
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap="8px"
            bg="warning.subtle"
            color="warning.fg"
            overflow="hidden"
            onClick={ask}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={swap}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={phase === 'done' ? 'done' : 'idle'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { ...swap, delay: 0.08 } }}
                exit={{ opacity: 0, y: -10, transition: { duration: 0.14, ease: motionTokens.easeOut } }}
              >
                {phase === 'done' ? <CheckIcon /> : <ResetIcon />}
                {phase === 'done' ? 'Trip reset' : 'Reset trip'}
              </motion.span>
            </AnimatePresence>
          </MotionButton>
        )}
      </AnimatePresence>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------

/** Keeps the in-flow footprint the size of the glass, tweening like the layout animation. */
function useFootprint(reduce: boolean) {
  const glassRef = useRef<HTMLDivElement>(null);
  const width = useMotionValue(0);
  const height = useMotionValue(0);
  useLayoutEffect(() => {
    const el = glassRef.current;
    if (!el) return;
    let first = true;
    const sync = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (first || reduce) {
        width.jump(w);
        height.jump(h);
        first = false;
        return;
      }
      if (w !== width.get()) animate(width, w, MORPH);
      if (h !== height.get()) animate(height, h, MORPH);
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height, reduce]);
  return { glassRef, width, height };
}

export function TripStrip() {
  const present = useIsPresent();
  const open = tripSheetOpen.use() && present;
  const units = settings.use((s) => s.units);
  // Re-render (so the glass animates to its new width) only when the shown pill's shape changes.
  useTripValue((t) => (open ? '' : pillShape(t.distanceM, t.movingMs, units)));
  const reduce = useReducedMotion() === true;
  const { glassRef, width, height } = useFootprint(reduce);

  // Leaving (navigation took the slot) or unmounting closes the sheet.
  useEffect(() => {
    if (!present) closeTripSheet();
  }, [present]);
  useEffect(() => () => closeTripSheet(), []);

  // Keyboard focus follows the open/close.
  useEffect(() => {
    if (!takeFocusMove()) return;
    document.getElementById(open ? TRIP_CLOSE_ID : TRIP_PILL_ID)?.focus({ preventScroll: true });
  }, [open]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_OFFSET_PX || info.velocity.y > DISMISS_VELOCITY) closeTripSheet();
  };

  return (
    <MotionBox position="relative" flexShrink={0} style={{ width, height }}>
      <AnimatePresence>
        {open && (
          // Tap-outside catcher; dims the HUD a touch like the settings sheet. Not focusable —
          // Escape and the close button cover keyboards.
          <MotionBox
            key="catcher"
            aria-hidden
            position="fixed"
            inset="0"
            bg={{ base: 'rgba(10, 18, 32, 0.1)', _dark: 'rgba(0, 0, 0, 0.32)' }}
            transitionProperty="background-color"
            transitionDuration="theme"
            onClick={closeTripSheet}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration, ease: motionTokens.easeOut }}
          />
        )}
      </AnimatePresence>

      <GlassWidget
        ref={glassRef}
        id={TRIP_SHEET_ID}
        layout
        strong={open}
        role={open ? 'dialog' : undefined}
        aria-label={open ? 'Trip' : undefined}
        position="absolute"
        right="0"
        bottom="0"
        w={open ? `${SHEET_W}px` : 'max-content'}
        maxW={SHEET_MAX_W}
        overflow="hidden"
        style={{ borderRadius: open ? SHEET_RADIUS : PILL_RADIUS }}
        transition={{ layout: MORPH }}
        drag={open ? 'y' : false}
        dragDirectionLock
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.8 }}
        dragSnapToOrigin
        onDragEnd={onDragEnd}
        onKeyDown={(e: KeyboardEvent) => {
          if (open && e.key === 'Escape') {
            e.stopPropagation();
            closeTripSheet();
          }
        }}
      >
        <AnimatePresence initial={false} mode="popLayout" anchorX="right" anchorY="bottom">
          {open ? (
            <MotionBox
              key="sheet"
              layout
              display="flex"
              flexDirection="column"
              w="full"
              maxH={SHEET_MAX_H}
              overflowY="auto"
              overscrollBehavior="contain"
              px="16px"
              pt="8px"
              pb="8px"
              initial={{ opacity: 0 }}
              animate={contentIn}
              exit={contentOut}
            >
              <Flex align="center" justify="space-between" h="44px" flexShrink={0} mr="-8px">
                <Box minW="0">
                  <Text as="h2" fontFamily="display" fontWeight="700" fontSize="20px" lineHeight="1" letterSpacing="-0.01em">
                    Trip
                  </Text>
                  <TripSubtitle />
                </Box>
                <MotionButton
                  id={TRIP_CLOSE_ID}
                  type="button"
                  aria-label="Close trip"
                  onClick={closeTripSheet}
                  w="44px"
                  h="44px"
                  flexShrink={0}
                  display="grid"
                  placeItems="center"
                  rounded="full"
                  color="text.primary"
                  cursor="pointer"
                  _hover={{ bg: 'glass.control' }}
                  focusVisibleRing="inside"
                  whileTap={{ scale: 0.92 }}
                >
                  <svg viewBox="0 0 22 22" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l5 5 5-5" />
                  </svg>
                </MotionButton>
              </Flex>
              <Grid templateColumns="1fr 1fr" gap="8px" mt="6px" flexShrink={0}>
                <StatTile label="Distance">
                  <SheetDistance />
                </StatTile>
                <StatTile label="Moving time">
                  <SheetMovingTime />
                </StatTile>
                <StatTile label="Average">
                  <SheetAverage />
                </StatTile>
                <StatTile label="Max">
                  <SheetMax />
                </StatTile>
              </Grid>
              <ResetControl />
            </MotionBox>
          ) : (
            <MotionButton
              key="pill"
              id={TRIP_PILL_ID}
              type="button"
              layout
              onClick={openTripSheet}
              aria-haspopup="dialog"
              aria-expanded={false}
              display="flex"
              alignItems="center"
              gap="10px"
              h="42px"
              pl="16px"
              pr="7px"
              whiteSpace="nowrap"
              color="text.primary"
              cursor="pointer"
              rounded={`${PILL_RADIUS}px`}
              focusVisibleRing="inside"
              initial={{ opacity: 0 }}
              animate={contentIn}
              exit={contentOut}
            >
              <Text as="span" fontSize="13px" fontWeight="600" lineHeight="1" letterSpacing="0.08em" color="text.secondary">
                TRIP
              </Text>
              <PillDistance />
              <Box as="span" aria-hidden w="4px" h="4px" flexShrink={0} rounded="2px" bg="text.tertiary" />
              <PillTime />
              <Box
                as="span"
                aria-hidden
                w="28px"
                h="28px"
                flexShrink={0}
                display="grid"
                placeItems="center"
                rounded="full"
                bg="glass.control"
                color="text.secondary"
              >
                <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8.5L7 5l3.5 3.5" />
                </svg>
              </Box>
              <Box as="span" srOnly>
                moving time. Show trip details
              </Box>
            </MotionButton>
          )}
        </AnimatePresence>
      </GlassWidget>
    </MotionBox>
  );
}
