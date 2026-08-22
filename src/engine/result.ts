/** The shape of an executed Operation. The chart layer, the accessible data table and the
    ChartSummary formatters all read this one value. */
import type { TimeUnit } from '../spec/grammar';
import type { ColumnType } from './types';

/** One output column. `dimension` fields come from `groupBy` and the `timeBucket`; `measure`
    fields are the aggregations and the one derived ratio. The Visualization's `x`, `y` and
    `seriesBy` must name fields **here**, not merely columns in the Dataset. */
export type ResultField = {
  name: string;
  label: string;
  role: 'dimension' | 'measure';
  /** For a dimension, the source ColumnType; for a measure, always `number`. */
  type: ColumnType;
  /** Set on the dimension a `timeBucket` produced, so the x-axis knows it is temporal. */
  temporal?: boolean;
  /** The TimeUnit that dimension was floored to. The axis formats at the bucket's resolution
      rather than guessing one from the gaps between the buckets that happen to be occupied. */
  unit?: TimeUnit;
};

export type ResultRow = Record<string, string | number | null>;

/** The deterministic facts about a result. Computed by the application, never written by the
    model. The chart layer owns two formatters over this — see ADR-0018. */
export type ChartSummary = {
  /** The measure the summary speaks about: the Visualization's `y`. */
  metricLabel: string;
  aggregation: string;
  dimensionLabel: string | null;
  /** Groups in the result after folding. */
  groupCount: number;
  /** Distinct groups the Operation produced before folding. */
  totalGroups: number;
  /** The fold that happened, or `null` when everything fit. */
  fold: Fold | null;
  /** The largest group by the metric, or `null` when there is nothing to point at. */
  extreme: { label: string; value: number } | null;
  /** Rows the metric column was null in, and which the aggregation therefore left out. */
  nullExcluded: number;
  /** Rows the filters kept. */
  rowsMatched: number;
  /** Rows in the Dataset. */
  rowsTotal: number;
};

/** What the cardinality fold collapsed. One object rather than four loose fields, because every
    reader of it needs all four or none of them, and because the formatters must never hardcode
    the kept count: it is 15 categories on the x-axis and 5 Series in the palette. */
export type Fold = {
  /** The dimension that folded, named as the axis names it. */
  dimensionLabel: string;
  /** Distinct values of that dimension kept, and collapsed into "Other". */
  kept: number;
  folded: number;
  /** The metric over the folded rows pooled, so the caption can say how much was set aside.
      A folded x-axis category is not drawn as a mark — an "Other" bar holding 87% of the
      Dataset flattens the fifteen the Question was about — so for that fold this number is the
      only place its size appears. */
  value: number | null;
};

export type AnalysisResult = {
  fields: ResultField[];
  rows: ResultRow[];
  summary: ChartSummary;
  /** True when the result hit the point cap and is not the whole answer. */
  truncated: boolean;
};

/** A result that is valid but awkward to draw. The chart layer renders a named state for each
    rather than an empty SVG. */
export type Degenerate = 'empty' | 'single' | 'all-null' | null;

export function degeneracy(result: AnalysisResult, metric: string): Degenerate {
  if (result.rows.length === 0) return 'empty';
  if (result.rows.every((r) => r[metric] === null)) return 'all-null';
  if (result.rows.length === 1) return 'single';
  return null;
}
