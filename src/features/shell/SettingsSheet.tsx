/**
 * T21 Settings sheet — a glass sheet that slides in from the right, anchored under the
 * GPS/settings pill (so the gear stays visible and shows it is open), inside the safe areas.
 *
 *   Units       mph / km/h            → settings.units
 *   Appearance  Auto / Day / Night    → settings.themeMode
 *   Demo drive  on / off              → settings.demo
 *
 * Dismiss: tap outside, drag/flick it to the right, the close button, or Escape. Focus is
 * trapped while open and returns to the settings button on close. Every control is at
 * least 44px tall. Open state is the shell-local `settingsOpen` entry.
 */
import { Box, Flex, FocusTrap, SegmentGroup, Switch, Text, chakra } from '@chakra-ui/react';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { settings } from '../../state';
import { motionTokens } from '../../theme';
import type { ThemeMode, Units } from '../../types';
import { SETTINGS_BUTTON_ID, closeSettings, settingsOpen } from './settingsOpen';

const MotionBox = motion.create(Box);
const MotionButton = motion.create(chakra.button);

const UNIT_OPTIONS: { value: Units; label: string }[] = [
  { value: 'mph', label: 'mph' },
  { value: 'kmh', label: 'km/h' },
];

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: ReactNode }[] = [
  {
    value: 'auto',
    label: 'Auto',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="8" cy="8" r="5.6" />
        <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    value: 'day',
    label: 'Day',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
      </svg>
    ),
  },
  {
    value: 'night',
    label: 'Night',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
        <path d="M13.4 10.2A5.6 5.6 0 0 1 5.8 2.6a5.6 5.6 0 1 0 7.6 7.6z" />
      </svg>
    ),
  },
];

/** Glass segmented control on top of Chakra's SegmentGroup (radio semantics, animated indicator). */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  const labelId = useId();
  return (
    <Box>
      <Text
        id={labelId}
        mb="6px"
        pl="4px"
        fontSize="12px"
        fontWeight="600"
        letterSpacing="0.06em"
        textTransform="uppercase"
        color="text.secondary"
      >
        {label}
      </Text>
      <SegmentGroup.Root
        aria-labelledby={labelId}
        value={value}
        onValueChange={(d) => {
          if (d.value) onChange(d.value as T);
        }}
        size="lg"
        display="flex"
        w="full"
        p="3px"
        bg="glass.control"
        boxShadow="none"
        css={{
          '--segment-radius': '13px',
          '--segment-indicator-bg': { base: 'rgba(255, 255, 255, 0.96)', _dark: 'rgba(255, 255, 255, 0.17)' },
          '--segment-indicator-shadow': '0 2px 8px rgba(10, 20, 40, 0.14), 0 0 0 0.5px rgba(10, 20, 40, 0.06)',
          '--transition-duration': '320ms',
          '--transition-timing-function': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          // The indicator colour is a literal day/night pair (not a theme variable); it is a
          // registered <color> property (global.css), so it can cross-fade with the theme.
          transition: '--segment-indicator-bg 0.9s ease',
        }}
      >
        <SegmentGroup.Indicator />
        {options.map((o) => (
          <SegmentGroup.Item
            key={o.value}
            value={o.value}
            flex="1"
            h="44px"
            gap="6px"
            fontSize="15px"
            fontWeight="600"
            color="text.secondary"
            cursor="pointer"
            transitionProperty="color"
            transitionDuration="fast"
            _checked={{ color: 'text.primary' }}
            css={{ '&::before': { display: 'none' } }}
          >
            {o.icon}
            <SegmentGroup.ItemText>{o.label}</SegmentGroup.ItemText>
            <SegmentGroup.ItemHiddenInput />
          </SegmentGroup.Item>
        ))}
      </SegmentGroup.Root>
    </Box>
  );
}

function UnitsSetting() {
  const units = settings.use((s) => s.units);
  return (
    <Segmented
      label="Units"
      value={units}
      options={UNIT_OPTIONS}
      onChange={(next) => settings.set((p) => ({ ...p, units: next }))}
    />
  );
}

function ThemeSetting() {
  const themeMode = settings.use((s) => s.themeMode);
  return (
    <Segmented
      label="Appearance"
      value={themeMode}
      options={THEME_OPTIONS}
      onChange={(next) => settings.set((p) => ({ ...p, themeMode: next }))}
    />
  );
}

function DemoSetting() {
  const demo = settings.use((s) => s.demo);
  return (
    <Switch.Root
      checked={demo}
      onCheckedChange={(d) => settings.set((p) => ({ ...p, demo: d.checked }))}
      colorPalette="accent"
      display="flex"
      w="full"
      minH="56px"
      px="12px"
      gap="12px"
      rounded="16px"
      bg="glass.control"
      cursor="pointer"
      css={{ '--switch-width': '51px', '--switch-height': '31px' }}
    >
      <Switch.HiddenInput />
      <Switch.Label flex="1" display="flex" flexDirection="column" gap="3px" lineHeight="1.2">
        <Text as="span" fontSize="16px" fontWeight="600" color="text.primary">
          Demo drive
        </Text>
        <Text as="span" fontSize="13px" fontWeight="500" color="text.secondary">
          A simulated drive instead of GPS
        </Text>
      </Switch.Label>
      <Switch.Control
        bg="glass.controlHover"
        _checked={{ bg: 'accent.solid' }}
        transitionProperty="background-color"
        transitionDuration="normal"
      >
        <Switch.Thumb
          bg="white"
          scale="0.87"
          boxShadow="0 2px 6px rgba(0, 0, 0, 0.22)"
          _checked={{ bg: 'white' }}
          transitionTimingFunction="glassOut"
          transitionDuration="0.3s"
        />
      </Switch.Control>
    </Switch.Root>
  );
}

/** Back to the settings button on close (a tap on iOS never focuses it, so "whatever had focus" would be the body). */
function returnFocusTarget(previous: HTMLElement | SVGElement): HTMLElement | SVGElement {
  return document.getElementById(SETTINGS_BUTTON_ID) ?? previous;
}

const DISMISS_OFFSET_PX = 90;
const DISMISS_VELOCITY = 500;

export function SettingsSheet() {
  const open = settingsOpen.use();
  const titleId = useId();

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > DISMISS_OFFSET_PX || info.velocity.x > DISMISS_VELOCITY) closeSettings();
  };

  return (
    <AnimatePresence>
      {open && (
        <Box key="settings" position="absolute" inset="0" zIndex="5">
          {/* Tap-outside catcher; dims the HUD a touch. Not focusable — Escape and the close button cover keyboards. */}
          <MotionBox
            aria-hidden
            position="absolute"
            inset="0"
            bg={{ base: 'rgba(10, 18, 32, 0.1)', _dark: 'rgba(0, 0, 0, 0.32)' }}
            transitionProperty="background-color"
            transitionDuration="theme"
            pointerEvents="auto"
            onClick={closeSettings}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration, ease: motionTokens.easeOut }}
          />
          <MotionBox
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            layerStyle="glassStrong"
            position="absolute"
            top="calc(var(--hud-t) + 52px)"
            bottom="var(--hud-b)"
            right="var(--hud-r)"
            w="340px"
            maxW="calc(100% - var(--hud-l) - var(--hud-r))"
            rounded="glass.lg"
            transformOrigin="100% 0"
            pointerEvents="auto"
            overflow="hidden"
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                closeSettings();
              }
            }}
            drag="x"
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.04, right: 0.9 }}
            dragSnapToOrigin
            onDragEnd={onDragEnd}
            initial={{ opacity: 0, x: 48, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 120, scale: 0.98 }}
            transition={{
              default: { type: 'spring', stiffness: 380, damping: 38, mass: 1 },
              opacity: { duration: 0.3, ease: motionTokens.easeOut },
            }}
          >
            <FocusTrap h="full" returnFocusOnDeactivate setReturnFocus={returnFocusTarget}>
              <Flex direction="column" h="full" pl="20px" pr="10px" pt="6px" pb="14px" overflowY="auto" overscrollBehavior="contain">
                {/* Grab handle on the leading edge hints that the sheet swipes away to the right. */}
                <Box
                  aria-hidden
                  position="absolute"
                  left="7px"
                  top="50%"
                  w="4px"
                  h="36px"
                  mt="-18px"
                  rounded="full"
                  bg="text.tertiary"
                  opacity={0.6}
                />
                <Flex align="center" justify="space-between" minH="44px" flexShrink={0}>
                  <Text id={titleId} as="h2" fontFamily="display" fontWeight="700" fontSize="20px" letterSpacing="-0.01em">
                    Settings
                  </Text>
                  <MotionButton
                    type="button"
                    aria-label="Close settings"
                    onClick={closeSettings}
                    w="44px"
                    h="44px"
                    display="grid"
                    placeItems="center"
                    rounded="full"
                    bg="glass.control"
                    color="text.secondary"
                    cursor="pointer"
                    focusVisibleRing="inside"
                    _hover={{ bg: 'glass.controlHover' }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                      <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
                    </svg>
                  </MotionButton>
                </Flex>
                <Flex direction="column" gap="12px" mt="2px" pr="10px">
                  <UnitsSetting />
                  <ThemeSetting />
                  <DemoSetting />
                </Flex>
              </Flex>
            </FocusTrap>
          </MotionBox>
        </Box>
      )}
    </AnimatePresence>
  );
}
