/**
 * Glass pill that brings the camera back to the vehicle (T13). Renders nothing while
 * `ui.following` is true (and never without a map); animates in when the user pans, pinches
 * or rotates the map. Tapping it sets `ui.following = true` — the follow camera then animates
 * back to the vehicle by itself.
 *
 * It is not positioned: the layout owner wraps it in an absolutely positioned slot.
 * Touch target: 44 px tall, ≥ 44 px wide.
 */
import { chakra } from '@chakra-ui/react';
import { AnimatePresence, motion } from 'motion/react';
import { ui } from '../../state';
import { motionTokens } from '../../theme';
import { recenter } from './camera';
import { isMapEnabled } from './mapInstance';

const MotionButton = motion.create(chakra.button);

const hidden = { opacity: 0, y: 14, scale: 0.92 };

export function RecenterChip() {
  const following = ui.use((s) => s.following);
  const visible = !following && isMapEnabled();
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <MotionButton
          key="recenter"
          type="button"
          onClick={recenter}
          aria-label="Recenter the map on your position"
          layerStyle="glass"
          rounded="pill"
          h="11"
          minW="11"
          ps="3.5"
          pe="4.5"
          display="inline-flex"
          alignItems="center"
          gap="2"
          cursor="pointer"
          fontFamily="display"
          fontWeight="semibold"
          fontSize="md"
          letterSpacing="0.01em"
          whiteSpace="nowrap"
          initial={hidden}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ ...hidden, transition: { duration: motionTokens.durationFast, ease: motionTokens.easeOut } }}
          transition={{ duration: motionTokens.duration, ease: motionTokens.easeSpring }}
          whileTap={{ scale: 0.94 }}
        >
          <RecenterIcon />
          Recenter
        </MotionButton>
      ) : null}
    </AnimatePresence>
  );
}

function RecenterIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3.5 19 19.5 12 16 5 19.5Z"
        fill="var(--chakra-colors-accent-solid)"
        stroke="var(--chakra-colors-accent-solid)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
