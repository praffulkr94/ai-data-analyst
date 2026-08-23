/** The shape of an executed Operation. The chart layer, the accessible data table and the
    ChartSummary formatters all read this one value. */
import type { TimeUnit } from '../spec/grammar';
import { temporalLabel } from './time';
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

/** One dimension value as the text that names it. A bucketed dimension holds epoch
    milliseconds and a `date` column an ISO day, so every reader that names a group — the axis,
    the tooltip, a bar's `aria-label`, the summary's extreme — goes through this or prints
    1577836800000 at one of them. The axis had it and the summary did not. */
export function dimensionText(
  field: ResultField | undefined,
  raw: string | number | null | undefined,
): string {
  if (raw === null || raw === undefined) return 'no value';
  return field && (field.temporal || field.type === 'date')
    ? temporalLabel(field.unit, raw)
    : String(raw);
}

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

/** A result that is valid but awkward to draw: no rows, a single row, all-null values, or more
    groups than can be shown. The chart layer renders a named state for each rather than an empty
    or unreadable SVG.

    `single` is drawable — one bar is a legitimate answer — and is named so the caller can say
    so; the other three are not. */
export type Degenerate = 'empty' | 'single' | 'all-null' | 'too-many' | null;

/** How much the chart type can draw. Omitted by a caller that only cares about the data
    states — the guard needs to know which field is the x-axis to count what would be drawn. */
export type Renderable = { x: string; marks: number };

export function degeneracy(
  result: AnalysisResult,
  metric: string,
  renderable?: Renderable,
): Degenerate {
  if (result.rows.length === 0) return 'empty';
  if (result.rows.every((r) => r[metric] === null)) return 'all-null';
  // Truncated means the point cap cut the answer short, so drawing it draws a fraction without
  // saying which fraction. Refusing and offering a top-N is the honest move.
  if (result.truncated) return 'too-many';
  if (renderable && marksNeeded(result, renderable.x) > renderable.marks) return 'too-many';
  if (result.rows.length === 1) return 'single';
  return null;
}

/** Marks along the x-axis. Series share a position, so what decides readability is the number of
    distinct x values and not the number of rows. */
export const marksNeeded = (result: AnalysisResult, x: string) =>
  new Set(result.rows.map((r) => String(r[x] ?? ''))).size;
