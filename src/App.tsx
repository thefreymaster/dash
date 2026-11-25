/**
 * App frame.
 *
 *   map         MapView, mounted from the very first render so tiles load behind the gate,
 *               on a themed land colour, with legibility scrims above it
 *   phase       gate → boot → cluster (`ui.phase`), cross-faded with AnimatePresence.
 *               `boot` and `cluster` share one ClusterLayout (same key), so the HUD enters
 *               once; BootSequence drives the boot timing and gauge sweep
 *   rotate      RotatePrompt above everything while the phone is upright
 *
 * No props anywhere: every component reads what it needs from `src/state`.
 */
import { Box } from '@chakra-ui/react';
import { AnimatePresence } from 'motion/react';
import { MapView } from './features/map';
import { BootSequence, ClusterLayout, MapScrim, RotatePrompt, StartGate } from './features/shell';
import { ui } from './state';

export default function App() {
  const phase = ui.use((s) => s.phase);
  return (
    <Box position="absolute" inset="0" overflow="hidden" bg="mapLand">
      <Box position="absolute" inset="0" zIndex="0">
        <MapView />
      </Box>
      <MapScrim />

      <AnimatePresence>
        {phase === 'gate' ? <StartGate key="gate" /> : <ClusterLayout key="cluster" />}
      </AnimatePresence>
      {phase === 'boot' && <BootSequence />}

      <RotatePrompt />
    </Box>
  );
}
