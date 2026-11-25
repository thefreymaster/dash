/**
 * Per-frame pose: smoothed position, speed and heading, updated every animation frame.
 *
 * WHY THIS IS NOT IN THE QUERY CACHE
 *   GPS fixes arrive at ~1 Hz, but the map camera, puck and speedometer must move at 60 Hz
 *   (dead reckoning + damping between fixes). Pushing 60 updates/s through React state or
 *   the query cache would re-render the tree every frame. Instead these are module-level
 *   Motion values: writing one notifies its subscribers without any React render, and
 *   `motion.*` components bind them straight to styles.
 *
 *   - Writer: exactly one — the rAF motion loop (task T10) calls `.set()` each frame.
 *     Nothing else should write here.
 *   - Readers: the map camera (`.get()` inside its own rAF or `.on('change')`), the puck,
 *     the speedometer digits/arc (`useTransform(pose.speedMps, …)` or `<motion.span>{value}`),
 *     the compass tape.
 *   - Low-rate data for ordinary React UI (status, 1 Hz numbers) lives in the `telemetry`
 *     client-state entry instead.
 *
 * Units: degrees for lat/lng/heading (heading clockwise from north, [0, 360)), m/s for
 * speed, metres for accuracy. Until the first fix `hasPose` is `false` and the numbers
 * are placeholders (0) that must not be shown as real data.
 *
 * Never call `.destroy()` / `.clearListeners()` on these shared values; unsubscribe your own
 * listeners with the function `.on()` returns.
 */
import { motionValue } from 'motion/react';

/** Smoothed latitude, degrees. */
export const lat = motionValue(0);
/** Smoothed longitude, degrees. */
export const lng = motionValue(0);
/** Smoothed ground speed, m/s (≥ 0). */
export const speedMps = motionValue(0);
/** Smoothed heading used for the camera/puck, degrees [0, 360), clockwise from north. */
export const headingDeg = motionValue(0);
/** Current horizontal accuracy radius, metres (for the puck's accuracy halo). */
export const accuracyM = motionValue(0);
/** `true` once the loop has written a real position. */
export const hasPose = motionValue(false);
/**
 * `true` while `speedMps` is a trustworthy live speed (mirrors `telemetry.speedKnown`, with the
 * fix age checked every frame). When `false` the speedometer shows "–" and `speedMps` eases to 0
 * as a visual placeholder — do not treat that 0 as "stopped".
 */
export const speedKnown = motionValue(false);

/** All pose values as one object, e.g. `import { pose } from '../state'; pose.speedMps.get()`. */
export const pose = { lat, lng, speedMps, headingDeg, accuracyM, hasPose, speedKnown } as const;

export type Pose = typeof pose;
