/** The chart layer's one transition. A line draws itself in when a result arrives, which is the
    only motion in a plot area — bars, axes and the grid appear where they belong.

    The `prefers-reduced-motion` check is inside the hook rather than at the call site, so a mark
    cannot animate by forgetting to ask. When the visitor has asked for reduced motion the hook
    returns 1 immediately and never schedules a frame: the line is simply there, which is the
    honest reading of the preference — not a shorter animation. */
import { useEffect, useState } from 'react';

/** Matches the `--motion-slow` token, so the plot area and the chrome agree. */
export const REVEAL_MS = 180;

export function prefersReducedMotion(): boolean {
  // jsdom has no `matchMedia`, and a chart in a test has nothing to animate anyway.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Runs 0 → 1 each time `key` changes. `key` is compared by identity, so a new result animates
    and a re-render for a hover does not. */
export function useReveal(key: unknown, duration = REVEAL_MS): number {
  const [reduced] = useState(prefersReducedMotion);
  const [value, setValue] = useState(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      setValue(1);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(t);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    setValue(0);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, duration, reduced]);

  return value;
}
