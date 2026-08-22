/** Layer two of three: scales. Six d3 submodules, no `d3-axis`, no `d3-selection`, no
    `d3-transition`, and no charting library — React owns every DOM node (ADR-0008, ADR-0013).
    Ticks come from `scale.ticks()` and are rendered as React elements by the axis marks. */
import { max, min } from 'd3-array';
import { scaleBand, scaleLinear, scaleTime, type ScaleBand, type ScaleLinear, type ScaleTime } from 'd3-scale';
import { useMemo } from 'react';
import type { AnalysisResult, ResultField } from '../engine/result';
import type { ChartDimensions } from './useChartDimensions';

/** The x-axis is one of three things, and which one is decided by the field, not by the chart
    type — which is why `timeBucket` is separate from `groupBy` in the grammar. */
export type XScale =
  | { kind: 'band'; scale: ScaleBand<string>; at: (v: unknown) => number | undefined }
  | { kind: 'time'; scale: ScaleTime<number, number>; at: (v: unknown) => number | undefined }
  | { kind: 'linear'; scale: ScaleLinear<number, number>; at: (v: unknown) => number | undefined };

export type Scales = {
  x: XScale;
  y: ScaleLinear<number, number>;
  /** Category values in the order the x-axis lays them out. */
  categories: string[];
};

const asNumber = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export function useScales(
  result: AnalysisResult,
  xField: ResultField | undefined,
  yField: ResultField | undefined,
  dimensions: ChartDimensions,
  { banded }: { banded: boolean },
): Scales {
  const { innerWidth, innerHeight } = dimensions;
  const xName = xField?.name;
  const yName = yField?.name;

  return useMemo(() => {
    const rows = result.rows;

    const values = yName ? rows.map((r) => asNumber(r[yName])).filter((v): v is number => v !== null) : [];
    // Bars are read against zero, so the domain includes it even when every value is far above.
    const lo = Math.min(0, min(values) ?? 0);
    const hi = max(values) ?? 1;
    const y = scaleLinear()
      .domain([lo, hi === lo ? lo + 1 : hi])
      .nice()
      .range([innerHeight, 0]);

    const categories = xName ? rows.map((r) => String(r[xName] ?? '')) : [];

    if (banded || !xField) {
      const scale = scaleBand<string>().domain(categories).range([0, innerWidth]).padding(0.18);
      return {
        x: { kind: 'band', scale, at: (v) => scale(String(v ?? '')) },
        y,
        categories,
      };
    }

    const xs = xName ? rows.map((r) => asNumber(r[xName])).filter((v): v is number => v !== null) : [];
    const domain: [number, number] = [min(xs) ?? 0, max(xs) ?? 1];
    if (domain[0] === domain[1]) domain[1] = domain[0] + 1;

    if (xField.temporal || xField.type === 'date') {
      const scale = scaleTime()
        .domain([new Date(domain[0]), new Date(domain[1])])
        .range([0, innerWidth]);
      return { x: { kind: 'time', scale, at: (v) => (typeof v === 'number' ? scale(new Date(v)) : undefined) }, y, categories };
    }

    const scale = scaleLinear().domain(domain).nice().range([0, innerWidth]);
    return { x: { kind: 'linear', scale, at: (v) => (typeof v === 'number' ? scale(v) : undefined) }, y, categories };
  }, [result, xField, xName, yName, innerWidth, innerHeight, banded]);
}
