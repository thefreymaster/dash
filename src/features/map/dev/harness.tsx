/**
 * DEV ONLY entry for `harness.html` — see the comment there for the URL parameters.
 * Mirrors `src/main.tsx`, then skips the start gate (no sensors are started) and, with `sim`,
 * drives the pose itself.
 */
import '../../../global.css';
import { Box, ChakraProvider } from '@chakra-ui/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../../App';
import { queryClient, ui } from '../../../state';
import { applyTheme, system } from '../../../theme';
import type { LngLat } from '../../../types';
import { MapView, RecenterChip } from '../index';
import { __useDevStyle } from '../mapInstance';
import './devHooks';
import { buildLocalStyle } from './localStyle';
import { startSimDrive } from './simDrive';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'night' ? 'night' : 'day';
const CENTER: LngLat = [-122.4194, 37.7749];

ui.set((s) => ({ ...s, phase: 'cluster', resolvedTheme: theme }));
applyTheme(theme);
ui.subscribe((s) => applyTheme(s.resolvedTheme));

if (params.has('local')) __useDevStyle(buildLocalStyle(theme));
if (params.has('sim')) {
  const speedParam = params.get('speed');
  startSimDrive({
    center: CENTER,
    speed: speedParam === 'vary' ? 'vary' : Number(speedParam ?? 13),
    delayMs: Number(params.get('delay') ?? 1500),
    accuracyM: Number(params.get('acc') ?? 8),
  });
}

// `bare`: only the map's own components (an element, not a component, so the entry exports nothing).
const bare = (
  <Box position="absolute" inset="0" overflow="hidden" bg="mapLand">
    <MapView />
    <Box position="absolute" right="var(--hud-r)" bottom="calc(var(--hud-b) + 52px)" zIndex="1">
      <RecenterChip />
    </Box>
  </Box>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ChakraProvider value={system}>
        <MotionConfig reducedMotion="user">{params.has('bare') ? bare : <App />}</MotionConfig>
      </ChakraProvider>
    </QueryClientProvider>
  </StrictMode>,
);
