/** `<ChartFrame>` — the SVG, the margins, the accessible representation, and nothing else. The
    marks are composed inside it as children, so adding a chart type adds a mark rather than a
    prop to a mega-component. */
import { useId, type ReactNode } from 'react';
import type { AnalysisResult } from '../engine/result';
import type { ChartType } from '../spec/grammar';
import { chartLabel } from './summaryText';
import type { ChartDimensions } from './useChartDimensions';

export function ChartFrame({
  dimensions,
  containerRef,
  result,
  type,
  describedBy,
  overlay,
  children,
}: {
  dimensions: ChartDimensions;
  containerRef: React.Ref<HTMLDivElement>;
  result: AnalysisResult;
  type: ChartType;
  /** The id of the table that *is* the accessible representation of this chart. */
  describedBy: string;
  /** Drawn behind the SVG's pointer surface and above its axes, in the same box: the canvas a
      scatter switches to past `CANVAS_ABOVE`. A canvas cannot be an SVG child, and this is the
      whole of the accommodation it gets. */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const { width, height, margin } = dimensions;
  const titleId = useId();
  return (
    <div className="chart" ref={containerRef}>
      {width > 0 && overlay}
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-labelledby={titleId}
          aria-describedby={describedBy}
        >
          <title id={titleId}>{chartLabel(result.summary, type)}</title>
          <g transform={`translate(${margin.left},${margin.top})`}>{children}</g>
        </svg>
      )}
    </div>
  );
}
