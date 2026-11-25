/**
 * T20 Rotate prompt — covers everything while the phone is upright (mockup `#rotOv`).
 * iOS cannot lock a web app's orientation, so this is the only guard. A phone outline
 * turns to landscape and back on a loop; content staggers in.
 */
import { Box, Flex, Text } from '@chakra-ui/react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { motionTokens } from '../../theme';
import { useIsPortrait } from './useIsPortrait';

const MotionFlex = motion.create(Flex);
const MotionBox = motion.create(Box);

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: motionTokens.easeOut, delay: 0.1 + i * 0.09 },
  }),
};

export function RotatePrompt() {
  const portrait = useIsPortrait();
  return (
    <AnimatePresence>
      {portrait && (
        <MotionFlex
          key="rotate"
          role="alertdialog"
          aria-modal="true"
          aria-label="Rotate your iPhone"
          position="fixed"
          inset="0"
          zIndex="10"
          align="center"
          justify="center"
          bg="overlay"
          backdropFilter="blur(var(--chakra-blurs-overlay)) saturate(170%)"
          css={{ WebkitBackdropFilter: 'blur(var(--chakra-blurs-overlay)) saturate(170%)' }}
          pt="var(--sat)"
          pb="var(--sab)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: motionTokens.easeOut }}
        >
          <MotionFlex direction="column" align="center" textAlign="center" px="40px" initial="hidden" animate="shown">
            <MotionBox variants={item} custom={0} position="relative" w="140px" h="140px" display="grid" placeItems="center">
              <Box position="absolute" inset="0" color="accent.fg" aria-hidden>
                <svg viewBox="0 0 140 140" width="140" height="140" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <path d="M112 46a50 50 0 0 0-60-20" opacity=".9" />
                  <path d="M50 18l2 8.5-8.5 2" strokeLinejoin="round" />
                </svg>
              </Box>
              <MotionBox
                aria-hidden
                position="relative"
                w="54px"
                h="96px"
                rounded="14px"
                borderWidth="3px"
                borderStyle="solid"
                borderColor="text.primary"
                _after={{
                  content: '""',
                  position: 'absolute',
                  left: '50%',
                  top: '6px',
                  w: '16px',
                  h: '5px',
                  ml: '-8px',
                  rounded: '3px',
                  bg: 'text.primary',
                }}
                animate={{ rotate: [0, 0, -90, -90, 0] }}
                transition={{
                  duration: 3.2,
                  times: [0, 0.18, 0.48, 0.78, 1],
                  ease: motionTokens.easeOut,
                  repeat: Infinity,
                }}
              />
            </MotionBox>
            <MotionBox variants={item} custom={1}>
              <Text as="h2" mt="18px" fontFamily="display" fontWeight="700" fontSize="26px" lineHeight="1.15" letterSpacing="-0.01em" color="text.primary">
                Rotate your iPhone
              </Text>
            </MotionBox>
            <MotionBox variants={item} custom={2}>
              <Text mt="10px" maxW="260px" fontSize="16px" fontWeight="500" lineHeight="1.4" color="text.secondary">
                Dash is a landscape cluster. Turn your phone sideways and mount it to drive.
              </Text>
            </MotionBox>
          </MotionFlex>
        </MotionFlex>
      )}
    </AnimatePresence>
  );
}
