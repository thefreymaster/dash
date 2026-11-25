/**
 * T26 Destination search sheet (mockup `.w-search`): glass sheet laid out from the TOP, from
 * right of the speedometer to the right safe inset, so the field and the first results stay
 * above the iOS keyboard (≈ 200 px of a 393 px landscape screen). Its height is capped to the
 * visual viewport, which shrinks while the keyboard is up.
 *
 *   PARKED (< 3 mph)  search field + Suggestions (Search Box API, debounced, one billing
 *                     session per opening) beside Recent.
 *   MOVING            no typing: the field is locked and says why; recents only, one tap to go.
 *
 * Choosing a place sets `nav.destination`, records it in `recents` (`addRecent`) and closes
 * the sheet. Empty, loading, error, no-results and no-token states are all drawn.
 * Opened with `openDestinationSearch()`; closed by Cancel, a tap outside or Escape.
 */
import { Box, Flex, FocusTrap, Text, chakra } from '@chakra-ui/react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import {
  MIN_QUERY_LENGTH,
  normalizeQuery,
  useRetrievePlace,
  useSuggestions,
  type Suggestion,
} from '../../api/search';
import { formatDistance, haversineM } from '../../lib';
import { addRecent, nav, recents, settings, telemetry } from '../../state';
import { motionTokens } from '../../theme';
import type { LngLat, Place } from '../../types';
import { nextParked } from './format';
import { InfoGlyph, KindGlyph, LockGlyph, ParkedGlyph, RecentGlyph, SearchGlyph, Spinner, WarningGlyph, CloseGlyph } from './glyphs';
import { closeSearchSheet, searchOpen, searchSession } from './navState';
import { navToken } from './token';
import { useVisualViewport } from './useVisualViewport';

const MotionBox = motion.create(Box);
const MotionButton = motion.create(chakra.button);

/** Debounce before a keystroke becomes a request, ms. */
export const SEARCH_DEBOUNCE_MS = 250;
/** Row height (≥ 44 px touch target). */
const ROW_H = '46px';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Parked/moving with hysteresis (see `nextParked`), from `telemetry.speedMps` (~1 Hz). */
function useParked(): boolean {
  const [parked, setParked] = useState(() => nextParked(true, telemetry.get().speedMps));
  useEffect(() => telemetry.subscribe((t) => setParked((p) => nextParked(p, t.speedMps))), []);
  return parked;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Current position as `[lng, lat]` (rounded upstream for the cache key), or `null`. */
function usePosition(): LngLat | null {
  return telemetry.use((t) => (t.fix ? ([t.fix.lng, t.fix.lat] as LngLat) : null));
}

/** Choose a place: navigate there, remember it, close. */
function goTo(place: Place): void {
  nav.set((n) => ({ ...n, destination: place }));
  addRecent(place);
  closeSearchSheet();
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text h="20px" pl="8px" fontSize="13px" lineHeight="18px" fontWeight="600" letterSpacing="0.06em" textTransform="uppercase" color="text.secondary">
      {children}
    </Text>
  );
}

/** A tappable result row (mockup `.res`). */
function Row({
  index,
  icon,
  tone,
  title,
  subtitle,
  trailing,
  disabled,
  onSelect,
  label,
}: {
  index: number;
  icon: ReactNode;
  tone: 'accent' | 'grey';
  title: ReactNode;
  subtitle: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <MotionButton
      type="button"
      role="option"
      aria-selected={false}
      aria-label={label}
      onClick={onSelect}
      disabled={disabled}
      display="flex"
      alignItems="center"
      gap="10px"
      w="full"
      h={ROW_H}
      flex="none"
      px="8px"
      rounded="14px"
      textAlign="left"
      cursor="pointer"
      _hover={{ bg: 'glass.control' }}
      _disabled={{ cursor: 'default' }}
      focusVisibleRing="inside"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.45, ease: motionTokens.easeOut, delay: Math.min(index, 6) * 0.06 }}
      whileTap={{ scale: 0.98 }}
    >
      <Box
        flex="none"
        w="32px"
        h="32px"
        rounded="10px"
        display="grid"
        placeItems="center"
        bg={tone === 'accent' ? 'accent.subtle' : 'glass.control'}
        color={tone === 'accent' ? 'accent.fg' : 'text.secondary'}
      >
        {icon}
      </Box>
      <Box flex="1" minW="0">
        <Text fontSize="15px" fontWeight="600" lineHeight="1.15" color="text.primary" truncate>
          {title}
        </Text>
        <Text mt="2px" fontSize="13px" fontWeight="500" lineHeight="1.2" color="text.secondary" truncate>
          {subtitle}
        </Text>
      </Box>
      {trailing !== undefined && (
        <Box flex="none" textStyle="numeric" fontSize="13px" fontWeight="600" color="text.secondary">
          {trailing}
        </Box>
      )}
    </MotionButton>
  );
}

/** Name with the typed prefix in full ink and the rest softer (mockup `.hl` / `.rest`). */
function Highlighted({ name, query }: { name: string; query: string }) {
  const q = normalizeQuery(query).toLowerCase();
  if (q && name.toLowerCase().startsWith(q)) {
    return (
      <>
        {name.slice(0, q.length)}
        <Text as="span" color="text.secondary" fontWeight="500">
          {name.slice(q.length)}
        </Text>
      </>
    );
  }
  return <>{name}</>;
}

/** Calm empty/error/notice block inside a column. */
function Notice({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <MotionBox
      display="flex"
      gap="10px"
      alignItems="flex-start"
      px="8px"
      py="8px"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: motionTokens.easeOut }}
    >
      <Box flex="none" mt="1px" color="text.tertiary">
        {icon}
      </Box>
      <Box minW="0">
        <Text fontSize="14px" fontWeight="600" lineHeight="1.25" color="text.primary">
          {title}
        </Text>
        {body && (
          <Text mt="2px" fontSize="13px" fontWeight="500" lineHeight="1.3" color="text.secondary">
            {body}
          </Text>
        )}
        {action}
      </Box>
    </MotionBox>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <MotionBox
          key={i}
          display="flex"
          alignItems="center"
          gap="10px"
          h={ROW_H}
          px="8px"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.35, 0.8, 0.35], transition: { duration: 1.3, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' } }}
          aria-hidden
        >
          <Box w="32px" h="32px" rounded="10px" bg="glass.controlHover" />
          <Box flex="1">
            <Box h="11px" w={`${70 - i * 12}%`} rounded="6px" bg="glass.controlHover" />
            <Box mt="7px" h="9px" w={`${46 + i * 8}%`} rounded="6px" bg="glass.control" />
          </Box>
        </MotionBox>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function RecentList({ position, columns }: { position: LngLat | null; columns: 1 | 2 }) {
  const list = recents.use();
  const units = settings.use((s) => s.units);
  if (list.length === 0) {
    return (
      <Notice
        icon={<RecentGlyph />}
        title="No recent places yet"
        body={columns === 2 ? 'Search for a destination while you’re parked — it will show up here.' : 'Places you go will show up here.'}
      />
    );
  }
  return (
    <Box
      role="listbox"
      aria-label="Recent places"
      display="grid"
      gridTemplateColumns={columns === 2 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)'}
      columnGap="8px"
    >
      <AnimatePresence initial>
        {list.map((place, i) => (
          <Row
            key={place.id}
            index={i}
            tone="grey"
            icon={<RecentGlyph />}
            title={place.name}
            subtitle={place.address ?? ' '}
            trailing={position ? formatDistance(haversineM(position, [place.lng, place.lat]), units) : undefined}
            onSelect={() => goTo(place)}
            label={`Go to ${place.name}`}
          />
        ))}
      </AnimatePresence>
    </Box>
  );
}

function SuggestionList({ query, position }: { query: string; position: LngLat | null }) {
  const token = navToken();
  const sessionToken = searchSession.use();
  const units = settings.use((s) => s.units);
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const suggestions = useSuggestions({ q: debounced, sessionToken, proximity: position }, token);
  const retrieve = useRetrievePlace();
  const typed = normalizeQuery(query).length >= MIN_QUERY_LENGTH;

  const choose = (s: Suggestion) => {
    if (retrieve.isPending) return;
    // /retrieve ends this billing session; the next opening of the sheet starts a new one
    // (renewing the token here would re-run the visible query and start a session for nothing).
    retrieve.mutate({ suggestion: s, sessionToken, token }, { onSuccess: goTo });
  };

  let state: string;
  let body: ReactNode;
  if (!token) {
    state = 'no-token';
    body = (
      <Notice
        icon={<WarningGlyph size={18} />}
        title="Search is off"
        body="This build has no Mapbox token, so search and directions are unavailable."
      />
    );
  } else if (!typed) {
    state = 'hint';
    body = <Notice icon={<SearchGlyph />} title="Where to?" body="Type a place, address or business." />;
  } else if (suggestions.isError && !suggestions.data) {
    state = 'error';
    body = (
      <Notice
        icon={<WarningGlyph size={18} />}
        title="Search isn’t reachable"
        body="Check the connection and try again."
        action={
          <MotionButton
            type="button"
            mt="8px"
            h="44px"
            px="16px"
            rounded="14px"
            bg="accent.subtle"
            color="accent.fg"
            fontWeight="600"
            fontSize="15px"
            cursor="pointer"
            whileTap={{ scale: 0.95 }}
            onClick={() => void suggestions.refetch()}
          >
            Try again
          </MotionButton>
        }
      />
    );
  } else if (!suggestions.data) {
    state = 'loading';
    body = <SkeletonRows />;
  } else if (suggestions.data.length === 0 && !suggestions.isPlaceholderData) {
    state = 'empty';
    body = <Notice icon={<SearchGlyph />} title={`No places match “${normalizeQuery(query)}”`} body="Try a shorter name or an address." />;
  } else {
    state = 'results';
    const rows = suggestions.data.map((s, i) => {
      const pending = retrieve.isPending && retrieve.variables?.suggestion.id === s.id;
      const failed = retrieve.isError && retrieve.variables?.suggestion.id === s.id;
      return (
        <Row
          key={`${s.id}`}
          index={i}
          tone="accent"
          icon={<KindGlyph kind={s.kind} />}
          title={<Highlighted name={s.name} query={debounced} />}
          subtitle={
            failed ? (
              <Text as="span" color="warning.fg">
                Couldn’t open this place — tap to retry
              </Text>
            ) : (
              s.detail || ' '
            )
          }
          trailing={pending ? <Spinner size={16} /> : s.distanceM !== null ? formatDistance(s.distanceM, units) : undefined}
          disabled={retrieve.isPending && !pending}
          onSelect={() => choose(s)}
          label={`Go to ${s.name}${s.detail ? `, ${s.detail}` : ''}`}
        />
      );
    });
    body = <AnimatePresence initial>{rows}</AnimatePresence>;
  }

  return (
    // `layout="position"`: new results re-render only this list; in the sheet's LayoutGroup that
    // makes the sheet re-measure and grow/shrink smoothly to fit them.
    <MotionBox layout="position" role="listbox" aria-label="Suggestions" aria-busy={suggestions.isFetching} opacity={suggestions.isPlaceholderData ? 0.6 : 1} transitionProperty="opacity" transitionDuration="0.25s">
      <AnimatePresence mode="wait" initial>
        <MotionBox
          key={state}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.2 }}
        >
          {body}
        </MotionBox>
      </AnimatePresence>
    </MotionBox>
  );
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

function SearchField({
  parked,
  query,
  onQuery,
  onEnter,
  inputRef,
}: {
  parked: boolean;
  query: string;
  onQuery: (q: string) => void;
  onEnter: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const hasToken = navToken() !== '';
  const enabled = parked && hasToken;
  return (
    <Flex
      flex="1"
      minW="0"
      h="44px"
      rounded="14px"
      bg="glass.control"
      align="center"
      gap="8px"
      pl="12px"
      pr="6px"
      boxShadow={enabled ? 'inset 0 0 0 1.5px var(--chakra-colors-accent-solid)' : 'none'}
      transition="box-shadow 0.3s"
    >
      <Box flex="none" color="text.secondary">
        {parked ? <SearchGlyph /> : <LockGlyph />}
      </Box>
      <AnimatePresence mode="popLayout" initial={false}>
        {enabled ? (
          <MotionBox key="input" flex="1" minW="0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <chakra.input
              ref={inputRef}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onEnter();
              }}
              placeholder="Search places or addresses"
              aria-label="Search destination"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="words"
              spellCheck={false}
              enterKeyHint="search"
              inputMode="search"
              maxLength={256}
              w="full"
              h="44px"
              bg="transparent"
              outline="none"
              fontSize="17px"
              fontWeight="500"
              color="text.primary"
              _placeholder={{ color: 'text.tertiary' }}
              css={{ caretColor: 'var(--chakra-colors-accent-solid)' }}
            />
          </MotionBox>
        ) : (
          <MotionBox key="locked" flex="1" minW="0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Text fontSize="16px" fontWeight="500" color="text.tertiary" truncate aria-live="polite">
              {parked ? 'Search unavailable' : 'Search unlocks when you stop'}
            </Text>
          </MotionBox>
        )}
      </AnimatePresence>
      {enabled && query !== '' && (
        <chakra.button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onQuery('');
            inputRef.current?.focus();
          }}
          flex="none"
          w="44px"
          h="44px"
          mx="-6px"
          display="grid"
          placeItems="center"
          color="text.secondary"
          cursor="pointer"
        >
          {/* 44 px touch target around a 28 px disc. */}
          <Box as="span" w="28px" h="28px" rounded="full" display="grid" placeItems="center" bg="glass.control">
            <CloseGlyph size={12} />
          </Box>
        </chakra.button>
      )}
      <Flex
        flex="none"
        align="center"
        gap="6px"
        h="28px"
        px="10px"
        rounded="14px"
        bg={parked ? 'accent.subtle' : 'warning.subtle'}
        color={parked ? 'accent.fg' : 'warning.fg'}
        fontSize="13px"
        fontWeight="600"
        whiteSpace="nowrap"
        transition="background-color 0.3s, color 0.3s"
      >
        {parked ? <ParkedGlyph /> : <LockGlyph size={14} />}
        {parked ? 'Parked' : 'Moving'}
      </Flex>
    </Flex>
  );
}

function SearchSheet() {
  const titleId = useId();
  const parked = useParked();
  const position = usePosition();
  const viewport = useVisualViewport();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Started moving: drop the keyboard at once.
  useEffect(() => {
    if (!parked) inputRef.current?.blur();
  }, [parked]);

  const onEnter = () => {
    // Enter picks the first suggestion: the button handles retrieve + navigation.
    const first = document.querySelector<HTMLButtonElement>('[data-search-sheet] [aria-label="Suggestions"] button[role="option"]');
    first?.click();
  };

  return (
    <LayoutGroup>
    <Box position="absolute" inset="0" zIndex="4">
      <MotionBox
        aria-hidden
        position="absolute"
        inset="0"
        bg={{ base: 'rgba(10, 18, 32, 0.12)', _dark: 'rgba(0, 0, 0, 0.34)' }}
        transitionProperty="background-color"
        transitionDuration="theme"
        pointerEvents="auto"
        onClick={closeSearchSheet}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: motionTokens.duration, ease: motionTokens.easeOut }}
      />
      <MotionBox
        data-search-sheet=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        layerStyle="glassStrong"
        position="absolute"
        top={`calc(var(--hud-t) + ${viewport.offsetTop}px)`}
        left="calc(var(--hud-l) + 240px)"
        right="var(--hud-r)"
        // Above the keyboard, and never down over the bottom strip (compass, trip / ETA chip).
        maxH={`min(calc(${viewport.height}px - var(--hud-t) - 8px), calc(100dvh - var(--hud-t) - var(--hud-b) - 52px))`}
        display="flex"
        flexDirection="column"
        overflow="hidden"
        pointerEvents="auto"
        transformOrigin="50% 0"
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            closeSearchSheet();
          }
        }}
        initial={{ opacity: 0, y: -24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -18, scale: 0.98, transition: { duration: 0.3, ease: motionTokens.easeOut } }}
        // `layout`: the glass grows/shrinks smoothly as results arrive or the keyboard opens
        // (the radius is a style so Motion keeps it round while scaling; the content wrapper
        // below is `layout="position"` so it is never stretched, only revealed).
        layout
        style={{ borderRadius: 28 }}
        transition={{
          default: { type: 'spring', stiffness: 420, damping: 38 },
          opacity: { duration: 0.3 },
          layout: { duration: motionTokens.duration, ease: motionTokens.easeOut },
        }}
      >
        <MotionBox layout="position" display="flex" flexDirection="column" minH="0">
        <FocusTrap display="flex" flexDirection="column" minH="0" p="8px" returnFocusOnDeactivate>
          <Text id={titleId} srOnly>
            Search destinations
          </Text>
          <Flex gap="6px" align="center" flex="none">
            <SearchField parked={parked} query={query} onQuery={setQuery} onEnter={onEnter} inputRef={inputRef} />
            <MotionButton
              type="button"
              onClick={closeSearchSheet}
              flex="none"
              h="44px"
              px="10px"
              rounded="14px"
              fontSize="16px"
              fontWeight="600"
              color="accent.fg"
              cursor="pointer"
              focusVisibleRing="inside"
              _active={{ bg: 'glass.control' }}
              whileTap={{ scale: 0.95 }}
            >
              Cancel
            </MotionButton>
          </Flex>

          <Box flex="1" minH="0" mt="6px" overflowY="auto" overscrollBehavior="contain">
            <AnimatePresence mode="wait" initial={false}>
              {parked ? (
                <MotionBox
                  key="parked"
                  display="grid"
                  gridTemplateColumns="minmax(0, 1.15fr) minmax(0, 1fr)"
                  gap="8px"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <Box minW="0">
                    <SectionTitle>Suggestions</SectionTitle>
                    <SuggestionList query={query} position={position} />
                  </Box>
                  <Box minW="0">
                    <SectionTitle>Recent</SectionTitle>
                    <RecentList position={position} columns={1} />
                  </Box>
                </MotionBox>
              ) : (
                <MotionBox key="moving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                  <SectionTitle>Recent</SectionTitle>
                  <RecentList position={position} columns={2} />
                </MotionBox>
              )}
            </AnimatePresence>
          </Box>

          <AnimatePresence initial={false}>
            {!parked && (
              <MotionBox
                key="note"
                flex="none"
                display="flex"
                gap="8px"
                alignItems="center"
                mx="8px"
                mt="8px"
                mb="2px"
                fontSize="13px"
                fontWeight="500"
                lineHeight="1.35"
                color="text.secondary"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.35, delay: 0.1 }}
                role="note"
              >
                <Box flex="none" color="accent.fg">
                  <InfoGlyph />
                </Box>
                Typing works only while parked. Tap a recent place to go.
              </MotionBox>
            )}
          </AnimatePresence>
        </FocusTrap>
        </MotionBox>
      </MotionBox>
    </Box>
    </LayoutGroup>
  );
}

/** Destination search sheet. Rendered once in the overlay slot; shows itself when opened. */
export function DestinationSearch() {
  const open = searchOpen.use();
  return <AnimatePresence>{open && <SearchSheet key="search" />}</AnimatePresence>;
}
