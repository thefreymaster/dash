/**
 * HUD layout plumbing shared by `HudRegion` (which places a region and says when/how its
 * widgets enter) and `GlassWidget` (the glass surface every widget is built from).
 *
 * Each region provides `{ order, from }` through `HudSlotContext`. A `GlassWidget` inside it
 * reads that and staggers in from that side, so feature code never has to know where in
 * the layout it sits or which number it is in the boot stagger.
 *
 * WHY EVERY WIDGET ANIMATES ITSELF
 *   `backdrop-filter` samples only inside the nearest ancestor that is semi-transparent,
 *   filtered or masked. Fading a parent of a glass surface therefore switches its blur off
 *   for the whole fade (then it pops back on). Regions never animate; each glass element
 *   animates its own opacity/transform.
 */
import { createContext } from 'react';
import { motionTokens } from '../../theme';

/** Named HUD regions (see `HudRegion` for their geometry). */
export type HudArea =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'left'
  | 'center'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight';

/** Side a widget enters from. */
export type EntranceFrom = 'top' | 'bottom' | 'left' | 'right' | 'scale';

export interface HudSlot {
  /** Position in the boot stagger (0 enters first). */
  order: number;
  /** Side the widget slides in from. */
  from: EntranceFrom;
}

export const HudSlotContext = createContext<HudSlot>({ order: 0, from: 'scale' });

/** Delay before the first widget enters, seconds (lets the start gate begin fading first). */
export const ENTRANCE_BASE_DELAY_S = 0.3;
/** Delay between consecutive widgets, seconds. */
export const ENTRANCE_STEP_S = 0.08;

const OFFSETS: Record<EntranceFrom, { x?: number; y?: number; scale?: number }> = {
  top: { y: -16 },
  bottom: { y: 16 },
  left: { x: -24, scale: 0.96 },
  right: { x: 24, scale: 0.96 },
  scale: { y: 10, scale: 0.94 },
};

/** Motion props (`initial` / `animate` / `exit`) for a widget at `order`, entering from `from`. */
export function widgetMotion(order: number, from: EntranceFrom) {
  const delay = ENTRANCE_BASE_DELAY_S + Math.max(0, order) * ENTRANCE_STEP_S;
  const hidden = { opacity: 0, x: 0, y: 0, scale: 1, ...OFFSETS[from] };
  return {
    initial: hidden,
    animate: {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      transition: {
        default: { duration: 0.6, ease: motionTokens.easeOut, delay },
        opacity: { duration: motionTokens.duration, ease: motionTokens.easeOut, delay },
      },
    },
    exit: { ...hidden, transition: { duration: 0.35, ease: motionTokens.easeOut } },
  };
}
