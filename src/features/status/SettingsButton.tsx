/**
 * T18 Settings button — 44×44 round icon button at the end of the GPS pill
 * (mockup `.icon-btn`). Opens the shell's settings sheet through the shell-local
 * `settingsOpen` entry (no props, no global UI state).
 */
import { chakra } from '@chakra-ui/react';
import { motion } from 'motion/react';
import { motionTokens } from '../../theme';
import { SETTINGS_BUTTON_ID, openSettings, settingsOpen } from '../shell/settingsOpen';

const MotionButton = motion.create(chakra.button);

export function SettingsButton() {
  const open = settingsOpen.use();
  return (
    <MotionButton
      id={SETTINGS_BUTTON_ID}
      // Kept in place (not stretched) while the pill glides to a new width.
      layout="position"
      type="button"
      aria-label="Settings"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={openSettings}
      w="44px"
      h="44px"
      flexShrink={0}
      display="grid"
      placeItems="center"
      rounded="full"
      color="text.primary"
      bg={open ? 'glass.control' : 'transparent'}
      cursor="pointer"
      transitionProperty="background-color, color"
      transitionDuration="fast"
      _hover={{ bg: 'glass.control' }}
      focusVisibleRing="inside"
      whileTap={{ scale: 0.92 }}
      transition={{ duration: motionTokens.durationFast, ease: motionTokens.easeOut }}
    >
      <motion.svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        animate={{ rotate: open ? 60 : 0 }}
        transition={{ duration: 0.6, ease: motionTokens.easeOut }}
      >
        <circle cx="12" cy="12" r="3.2" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </motion.svg>
    </MotionButton>
  );
}
