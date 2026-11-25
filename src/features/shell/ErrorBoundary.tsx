/**
 * Top-level safety net (`main.tsx` wraps the app in it): a render error while driving shows a
 * calm glass card on the black page instead of a white screen. Reload starts Dash again.
 */
import { Box, Button, Text } from '@chakra-ui/react';
import { motion } from 'motion/react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { motionTokens } from '../../theme';

const MotionBox = motion.create(Box);

export class ErrorBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Dash stopped rendering', error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? <CrashCard /> : this.props.children;
  }
}

function CrashCard() {
  return (
    // Night palette (`dark` class) whatever the theme: a dark card is the calm one on black.
    <Box className="dark" position="fixed" inset="0" bg="page" color="text.primary" display="grid" placeItems="center" pl="var(--hud-l)" pr="var(--hud-r)">
      <MotionBox
        role="alertdialog"
        aria-labelledby="dash-crash-title"
        layerStyle="glassStrong"
        rounded="glass.lg"
        w="full"
        maxW="380px"
        px="24px"
        py="22px"
        textAlign="center"
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: motionTokens.duration, ease: motionTokens.easeOut }}
      >
        <Text id="dash-crash-title" as="h1" fontFamily="display" fontWeight="700" fontSize="22px" lineHeight="1.2">
          Something went wrong
        </Text>
        <Text mt="6px" fontSize="15px" lineHeight="1.4" color="text.secondary">
          Dash stopped drawing the cluster. Reload to start again.
        </Text>
        <Button
          mt="16px"
          h="48px"
          px="28px"
          rounded="pill"
          bg="accent.subtle"
          color="accent.fg"
          fontWeight="600"
          fontSize="16px"
          _hover={{ bg: 'accent.subtle' }}
          onClick={() => window.location.reload()}
        >
          Reload Dash
        </Button>
      </MotionBox>
    </Box>
  );
}
