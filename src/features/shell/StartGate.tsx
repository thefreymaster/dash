/**
 * T20 Start gate — the first screen (mockup `#startOv`): a frosted overlay over the live
 * map with the wordmark, a Start button and what Dash will ask for.
 *
 * iOS grants motion/compass permission and the wake lock only inside a user gesture, so
 * the click handler calls `startSensors()` synchronously — nothing is awaited before it —
 * and only then moves to the `boot` phase.
 */
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { motion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { isDemo, startSensors } from '../../sensors';
import { settings, ui } from '../../state';
import { motionTokens } from '../../theme';
import { BrandMark } from './BrandMark';

const MotionFlex = motion.create(Flex);
const MotionBox = motion.create(Box);
const MotionButton = motion.create(Button);

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      opacity: { duration: 0.6, ease: motionTokens.easeOut, delay: 0.15 + i * 0.09 },
      y: { duration: 0.7, ease: motionTokens.easeOut, delay: 0.15 + i * 0.09 },
    },
  }),
  gone: { opacity: 0, y: -10, transition: { duration: 0.35, ease: motionTokens.easeOut } },
};

function start() {
  if (ui.get().phase !== 'gate') return; // a second tap during the exit fade
  void startSensors(); // synchronously inside the gesture — see the file comment
  ui.set((prev) => ({ ...prev, phase: 'boot' }));
}

function Perm({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Flex
      as="li"
      align="center"
      gap="7px"
      h="32px"
      pl="8px"
      pr="12px"
      rounded="16px"
      bg="glass.control"
      color="text.primary"
      fontSize="13px"
      fontWeight="600"
      lineHeight="1"
    >
      <Box color="accent.fg" display="grid" aria-hidden>
        {icon}
      </Box>
      {children}
    </Flex>
  );
}

export function StartGate() {
  // Re-render if the demo setting changes; `isDemo()` is the sensors layer's answer.
  const demoSetting = settings.use((s) => s.demo);
  const demo = isDemo() || demoSetting;

  return (
    <MotionFlex
      role="dialog"
      aria-label="Start Dash"
      position="absolute"
      inset="0"
      zIndex="3"
      align="center"
      justify="center"
      bg="overlay"
      backdropFilter="blur(var(--chakra-blurs-overlay)) saturate(170%)"
      css={{ WebkitBackdropFilter: 'blur(var(--chakra-blurs-overlay)) saturate(170%)' }}
      pl="var(--hud-l)"
      pr="var(--hud-r)"
      pt="var(--sat)"
      pb="var(--sab)"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.7, ease: motionTokens.easeOut }}
    >
      <MotionFlex direction="column" align="center" textAlign="center" initial="hidden" animate="shown" exit="gone">
        <MotionFlex align="center" gap="12px" variants={item} custom={0}>
          <BrandMark />
          <Text
            as="h1"
            m="0"
            fontFamily="display"
            fontWeight="700"
            fontSize="60px"
            lineHeight="1"
            letterSpacing="-0.035em"
            color="text.primary"
          >
            Dash
          </Text>
        </MotionFlex>

        <MotionBox variants={item} custom={1}>
          <Text mt="12px" fontSize="17px" fontWeight="500" lineHeight="1.3" color="text.secondary">
            A calm instrument cluster for the road.
          </Text>
        </MotionBox>

        <MotionBox variants={item} custom={2} mt="26px">
          <MotionButton
            onClick={start}
            h="56px"
            minW="210px"
            px="34px"
            rounded="28px"
            bgImage="accent"
            bgColor="accent.solid"
            color="white"
            fontFamily="display"
            fontWeight="700"
            fontSize="19px"
            letterSpacing="0.01em"
            gap="10px"
            boxShadow="0 10px 26px rgba(10, 132, 255, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.35)"
            _hover={{ bgColor: 'accent.solid' }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: motionTokens.durationFast, ease: motionTokens.easeOut }}
          >
            Start driving
            <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9h10M10 5l4 4-4 4" />
            </svg>
          </MotionButton>
        </MotionBox>

        <MotionFlex as="ul" variants={item} custom={3} mt="22px" p="0" gap="8px" listStyleType="none" aria-label="Dash will ask for">
          <Perm
            icon={
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M14.5 1.5L1.5 7.2l5.6 1.7 1.7 5.6z" />
              </svg>
            }
          >
            Location
          </Perm>
          <Perm
            icon={
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M2.5 11.5a5.5 5.5 0 1 1 11 0" />
                <path d="M8 11.5l3-4" />
              </svg>
            }
          >
            Motion
          </Perm>
          <Perm
            icon={
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="8" cy="8" r="3" />
                <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
              </svg>
            }
          >
            Keep screen awake
          </Perm>
        </MotionFlex>

        <MotionBox variants={item} custom={4}>
          <Text mt="10px" fontSize="13px" fontWeight="500" lineHeight="1.35" color="text.secondary">
            {demo
              ? 'Demo drive is on: Dash will drive a simulated route instead of using GPS.'
              : 'Dash will ask for these once. Nothing leaves your phone.'}
          </Text>
        </MotionBox>
      </MotionFlex>
    </MotionFlex>
  );
}
