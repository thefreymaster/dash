/**
 * A requestAnimationFrame loop that pauses while the document is hidden (screen off, app in
 * the background) and resumes when it is visible again. `dt` is clamped so a resume does not
 * produce one huge step.
 */

/** Longest frame step passed to `onFrame`, seconds. */
export const MAX_FRAME_DT_S = 0.25;

/** Start the loop. Returns a stop function. */
export function startFrameLoop(onFrame: (nowMs: number, dtSeconds: number) => void): () => void {
  let raf = 0;
  let last: number | null = null;
  let stopped = false;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = last === null ? 0 : Math.min(MAX_FRAME_DT_S, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      onFrame(now, dt);
    } catch (error) {
      console.error('[map] frame failed', error);
    }
  };

  const start = () => {
    if (stopped || raf !== 0 || document.visibilityState === 'hidden') return;
    last = null;
    raf = requestAnimationFrame(frame);
  };
  const pause = () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
  };
  const onVisibility = () => (document.visibilityState === 'hidden' ? pause() : start());

  document.addEventListener('visibilitychange', onVisibility);
  start();

  return () => {
    stopped = true;
    pause();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
