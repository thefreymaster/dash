/**
 * A frosted Glass surface that animates its own entrance and exit.
 *
 * Use it as the outermost element of every HUD widget (pills, panels, banners, sheets in
 * a slot). Inside a `HudRegion` it picks up the region's stagger order and entrance side;
 * `order` / `from` override them. All Chakra style props and Motion props pass through
 * (e.g. `layout` to animate size changes, `whileTap`, `exit`).
 *
 * Do not wrap it in another element that animates opacity — see `hud.ts`.
 */
import { Box } from '@chakra-ui/react';
import { motion } from 'motion/react';
import { useContext, type ComponentProps } from 'react';
import { HudSlotContext, widgetMotion, type EntranceFrom } from './hud';

const MotionBox = motion.create(Box);

type GlassWidgetProps = ComponentProps<typeof MotionBox> & {
  /** Denser fill (`glassStrong`) for large or text-heavy surfaces. */
  strong?: boolean;
  /** Override the region's stagger position. */
  order?: number;
  /** Override the region's entrance side. */
  from?: EntranceFrom;
};

export function GlassWidget({ strong = false, order, from, ...rest }: GlassWidgetProps) {
  const slot = useContext(HudSlotContext);
  const motionProps = widgetMotion(order ?? slot.order, from ?? slot.from);
  return (
    <MotionBox
      layerStyle={strong ? 'glassStrong' : 'glass'}
      position="relative"
      pointerEvents="auto"
      {...motionProps}
      {...rest}
    />
  );
}
