/** Layer one of three: measurement. ResizeObserver entries are the only measurement source —
    no `getBoundingClientRect` in a render, no window resize listeners.

    The margin convention: the caller says how much room the axes need, and this returns the
    inner box the marks are drawn in. Every mark component then works in inner coordinates and
    never has to know a margin exists. */
import { useLayoutEffect, useRef, useState } from 'react';

export type Margin = { top: number; right: number; bottom: number; left: number };

export type ChartDimensions = {
  width: number;
  height: number;
  margin: Margin;
  /** Width and height inside the margins, never negative. */
  innerWidth: number;
  innerHeight: number;
};

const DEFAULT_MARGIN: Margin = { top: 12, right: 16, bottom: 28, left: 52 };

export function useChartDimensions(margin: Partial<Margin> = {}, height = 320) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const m = { ...DEFAULT_MARGIN, ...margin };
  const dimensions: ChartDimensions = {
    width,
    height,
    margin: m,
    innerWidth: Math.max(0, width - m.left - m.right),
    innerHeight: Math.max(0, height - m.top - m.bottom),
  };
  return [ref, dimensions] as const;
}
