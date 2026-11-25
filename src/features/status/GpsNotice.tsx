/**
 * T20 Location notice — a calm glass card in the centre region when location cannot work
 * (`telemetry.status` is `denied` or `unavailable`). The rest of the HUD stays visible.
 * Explains the iOS settings path and offers a reload (a fresh Start re-asks for access).
 */
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { AnimatePresence } from 'motion/react';
import { telemetry } from '../../state';
import { GlassWidget } from '../shell/GlassWidget';

const SETTINGS_PATH = ['Settings', 'Privacy & Security', 'Location Services', 'Safari Websites'];

function blockedStatus(t: { status: string }): 'denied' | 'unavailable' | null {
  return t.status === 'denied' || t.status === 'unavailable' ? t.status : null;
}

export function GpsNotice() {
  const status = telemetry.use(blockedStatus);
  return (
    <AnimatePresence>
      {status && (
        <GlassWidget
          key="gps-notice"
          strong
          order={0}
          from="scale"
          role="status"
          aria-live="polite"
          w="full"
          maxW="400px"
          rounded="glass.lg"
          pl="16px"
          pr="20px"
          py="16px"
        >
          <Flex gap="14px" align="flex-start">
            <Box
              flexShrink={0}
              w="36px"
              h="36px"
              rounded="12px"
              display="grid"
              placeItems="center"
              bg="warning.subtle"
              color="warning.fg"
              aria-hidden
            >
              <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.5 2.5L2.5 9l6.2 1.9 1.9 6.2z" />
                <path d="M3 17L17 3" opacity=".9" />
              </svg>
            </Box>
            <Box minW="0">
              <Text fontFamily="display" fontWeight="700" fontSize="17px" lineHeight="1.2" color="text.primary">
                {status === 'denied' ? 'Location access is off' : 'Can’t find your location'}
              </Text>
              <Text mt="4px" fontSize="14px" lineHeight="1.35" color="text.secondary">
                {status === 'denied'
                  ? 'Dash needs your location for speed and heading. Allow it in:'
                  : 'Check that Location Services is on and Safari Websites is allowed in:'}
              </Text>
              <Text mt="4px" fontSize="13px" fontWeight="600" lineHeight="1.4" color="text.primary">
                {SETTINGS_PATH.join(' › ')}
                {status === 'denied' ? ' › While Using the App' : ''}
              </Text>
              <Button
                mt="10px"
                h="44px"
                px="18px"
                rounded="pill"
                bg="accent.subtle"
                color="accent.fg"
                fontWeight="600"
                fontSize="15px"
                _hover={{ bg: 'accent.subtle' }}
                onClick={() => window.location.reload()}
              >
                Reload Dash
              </Button>
            </Box>
          </Flex>
        </GlassWidget>
      )}
    </AnimatePresence>
  );
}
