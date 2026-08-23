/** Executing an Operation against a ColumnStore. Pure, Node-callable, and the highest bug
    density in the project after inference — which is why it is a seam.

    Aggregation is the *cheapest* step here: a Map groupBy over 99,040 parsed rows is tens of
    milliseconds. It is not the justification for the worker. See ADR-0004 before quoting a
    number from this file. */
import { bucketStart } from './time';
import type { AnalysisResult, ChartSummary, Fold, ResultField, ResultRow } from './result';
import { cellText, cellValue, type Column, type ColumnStore } from './types';
import type { Aggregation, ChartType, Filter, Operation } from '../spec/grammar';

/** Categories shown on an axis before the rest collapse into one. `city` has 2,092 distinct
    values and "matches by city" is a natural first Question, so this fires on day one. */
export const FOLD_TOP_N = 15;
/** Series drawn at once, the fold included. The palette has six slots, assigned in fixed order
    and never cycled (ADR-0012), so a seventh Series would have to reuse a colour — which is why
    this budget counts the "Other" Series against itself and `FOLD_TOP_N` does not. */
export const SERIES_BUDGET = 6;
export const FOLD_LABEL = 'Other';
/** The aggregate charts' cap: a bar, a line or an area aggregates to categories or buckets, and
    past a thousand of them a reader cannot compare anything. */
export const POINT_CAP = 1000;
/** A scatter's Series cap. Past three, yellow and orange appear together and fail the all-pairs
    colour-vision floors (ADR-0012). */
export const SCATTER_SERIES_BUDGET = 3;
/** A scatter's x is a measure, so its groups are positions rather than categories and one point
    per row is the shape it asks for. `team_matches.csv` is 99,040 rows. */
export const SCATTER_POINT_CAP = 100_000;

/** How many points and how many Series survive, per chart type. Both are properties of the
    Visualization rather than of the Operation, which is why the chart type travels on the
    `analyze` message beside `metric` and `seriesBy` — see ADR-0023. */
export const CHART_BUDGET: Record<ChartType, { points: number; series: number }> = {
  bar: { points: POINT_CAP, series: SERIES_BUDGET },
  line: { points: POINT_CAP, series: SERIES_BUDGET },
  area: { points: POINT_CAP, series: SERIES_BUDGET },
  scatter: { points: SCATTER_POINT_CAP, series: SCATTER_SERIES_BUDGET },
};

/* ---- filters ------------------------------------------------------------------------- */

/** A null never satisfies a comparison: a missing value is not greater or less than anything.
    `isNull` is the only operator that selects one. */
function passes(col: Column | undefined, row: number, f: Filter): boolean {
  if (!col) return false;
  const text = cellText(col, row);
  if (f.op === 'isNull') return text === null;
  if (f.op === 'isNotNull') return text !== null;
  if (text === null) return false;

  switch (f.op) {
    case 'eq':
      return text === String(booleanText(f.value));
    case 'neq':
      return text !== String(booleanText(f.value));
    case 'in':
      return f.values.includes(text);
    case 'dateRange':
      return text >= f.from && text <= f.to;
    default: {
      const v = cellValue(col, row);
      if (typeof v !== 'number') return false;
      switch (f.op) {
        case 'gt':
          return v > f.value;
        case 'gte':
          return v >= f.value;
        case 'lt':
          return v < f.value;
        case 'lte':
          return v <= f.value;
        case 'between':
          return v >= f.from && v <= f.to;
      }
    }
  }
}

/** The rows an Operation's filters keep, in file order. Shared with the RowIndex, so the rows
    behind a chart and the rows the table shows under that Analysis's chip are selected by one
    implementation rather than two that can disagree. */
export function filterRows(store: ColumnStore, filters: Filter[]): number[] {
  const cols = filters.map((f) => store.columns.get(f.column));
  const kept: number[] = [];
  for (let row = 0; row < store.rowCount; row++) {
    if (filters.every((f, i) => passes(cols[i], row, f))) kept.push(row);
  }
  return kept;
}

/** A boolean column reads as `TRUE`/`FALSE`, so a filter written against `true` must too. */
const booleanText = (v: string | number | boolean) =>
  typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v;

/* ---- aggregation --------------------------------------------------------------------- */

/** One aggregation over the rows of one group. Row indices rather than values, because
    `median` needs them all and the fold needs to re-aggregate a pooled set. */
function aggregate(store: ColumnStore, rows: number[], a: Aggregation): number | null {
  if (a.fn === 'count') return rows.length;
  const col = a.column === null ? undefined : store.columns.get(a.column);
  if (!col) return null;

  if (a.fn === 'countDistinct') {
    const seen = new Set<string>();
    for (const r of rows) {
      const t = cellText(col, r);
      if (t !== null) seen.add(t);
    }
    return seen.size;
  }

  const values: number[] = [];
  for (const r of rows) {
    const v = cellValue(col, r);
    if (typeof v === 'number') values.push(v);
  }
  if (values.length === 0) return null;

  switch (a.fn) {
    case 'sum':
      return values.reduce((x, y) => x + y, 0);
    // A rate is the share of true values, which over an Int8Array of 0 and 1 is the mean.
    case 'avg':
    case 'rate':
      return values.reduce((x, y) => x + y, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'median': {
      values.sort((x, y) => x - y);
      const mid = values.length >> 1;
      return values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
    }
  }
}

/* ---- grouping ------------------------------------------------------------------------ */

type Dimension = { field: ResultField; read: (row: number) => string | number | null };

function dimensions(store: ColumnStore, op: Operation): Dimension[] {
  const out: Dimension[] = [];

  // The temporal dimension comes first: it is the x-axis, which is the whole reason
  // `timeBucket` is separate from `groupBy`.
  if (op.timeBucket) {
    const col = store.columns.get(op.timeBucket.column);
    const unit = op.timeBucket.unit;
    out.push({
      field: {
        name: op.timeBucket.column,
        label: `${op.timeBucket.column} by ${unit}`,
        role: 'dimension',
        type: 'date',
        temporal: true,
        unit,
      },
      read: (row) => {
        const v = col ? cellValue(col, row) : null;
        return typeof v === 'number' ? bucketStart(v, unit) : null;
      },
    });
  }

  for (const name of op.groupBy) {
    const col = store.columns.get(name);
    out.push({
      field: {
        name,
        label: name,
        role: 'dimension',
        type: store.schema.columns.find((c) => c.name === name)?.type ?? 'categorical',
      },
      read: (row) => (col ? cellText(col, row) : null),
    });
  }
  return out;
}

type Group = { keys: (string | number | null)[]; rows: number[] };
type Key = string | number | null;

/** Each part is prefixed, so a null group and a cell holding the text "null" are different keys,
    and the tab separator cannot be confused with a value that holds one. */
const keyOf = (keys: Key[]) => keys.map((k) => (k === null ? '\u0000' : `=${k}`)).join('\t');

function groupRows(kept: number[], dims: Dimension[]): Group[] {
  if (dims.length === 0) return [{ keys: [], rows: kept }];
  const groups = new Map<string, Group>();
  for (const row of kept) {
    const keys = dims.map((d) => d.read(row));
    const key = keyOf(keys);
    const existing = groups.get(key);
    if (existing) existing.rows.push(row);
    else groups.set(key, { keys, rows: [row] });
  }
  return [...groups.values()];
}

/** Merge groups that agree on every key. The fold produces several groups with the same keys —
    one per folded value of the folded dimension — and they have to become one row. */
function mergeByKeys(groups: Group[]): Group[] {
  const out = new Map<string, Group>();
  for (const g of groups) {
    const existing = out.get(keyOf(g.keys));
    if (existing) existing.rows.push(...g.rows);
    else out.set(keyOf(g.keys), { keys: g.keys, rows: [...g.rows] });
  }
  return [...out.values()];
}

/* ---- ordering and folding ------------------------------------------------------------ */

/** Nulls sort last in both directions — a group with no value is not the smallest one. */
function compare(a: ResultRow, b: ResultRow, by: string, dir: 'asc' | 'desc'): number {
  const va = a[by] ?? null;
  const vb = b[by] ?? null;
  if (va === null || vb === null) return va === null && vb === null ? 0 : va === null ? 1 : -1;
  const sign = dir === 'asc' ? 1 : -1;
  if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
  return String(va).localeCompare(String(vb)) * sign;
}

/* ---- the executor -------------------------------------------------------------------- */

export type ExecuteOptions = {
  /** The measure the ChartSummary speaks about — the Visualization's `y`. Defaults to the
      first aggregation, which is what a spec without a Visualization means. */
  metric?: string;
  /** The Visualization's `seriesBy`, which decides *which* dimension the fold collapses and to
      how many groups. The executor otherwise cannot tell a Series from an x-axis. */
  seriesBy?: string | null;
  /** The Visualization's `type`, which decides how many points and how many Series survive.
      Defaults to the aggregate budget — a thousand points and six Series. */
  chartType?: ChartType;
};

/** Which dimension the fold collapses, and how many of its values survive.

    A temporal dimension is never folded. It is the x-axis, its order is its meaning, and
    keeping "the fifteen months with the most matches" out of a 152-year series is not an
    answer to the Question — the point cap is what bounds it instead.

    A Series folds to the palette's slots — six, or three on a scatter. Anything else folds to
    the top fifteen.

    A scatter has nothing else. Its x is a measure, so no dimension of it is on an axis: there are
    no categories to fold, and folding them anyway collapses the points the scatter is made of
    (ADR-0023). The point cap bounds it instead, exactly as it bounds a time axis. */
function foldPlan(
  dims: Dimension[],
  seriesBy: string | null | undefined,
  chartType: ChartType,
): { index: number; budget: number } | null {
  const series = dims.findIndex((d) => d.field.name === seriesBy);
  if (series >= 0) return { index: series, budget: CHART_BUDGET[chartType].series };
  if (chartType === 'scatter') return null;
  const first = dims.findIndex((d) => !d.field.temporal);
  return first >= 0 ? { index: first, budget: FOLD_TOP_N + 1 } : null;
}

export function executeOperation(
  store: ColumnStore,
  op: Operation,
  { metric, seriesBy, chartType = 'bar' }: ExecuteOptions = {},
): AnalysisResult {
  const kept = filterRows(store, op.filters);

  const dims = dimensions(store, op);
  const groups = groupRows(kept, dims);
  const fields: ResultField[] = [
    ...dims.map((d) => d.field),
    ...op.aggregations.map((a) => ({
      name: a.id,
      label: a.label,
      role: 'measure' as const,
      type: 'number' as const,
    })),
    ...op.derived.map((d) => ({
      name: d.id,
      label: d.label,
      role: 'measure' as const,
      type: 'number' as const,
    })),
  ];

  const measure = metric ?? op.aggregations[0]!.id;

  /** Turn one group into an output row. The fold reuses this over a pooled row set. */
  const toRow = (g: Group): ResultRow => {
    const row: ResultRow = {};
    dims.forEach((d, i) => {
      row[d.field.name] = g.keys[i] ?? null;
    });
    for (const a of op.aggregations) row[a.id] = aggregate(store, g.rows, a);
    for (const d of op.derived) {
      const n = row[d.numerator];
      const q = row[d.denominator];
      row[d.id] =
        typeof n === 'number' && typeof q === 'number' && q !== 0 ? n / q : null;
    }
    return row;
  };

  const totalGroups = groups.length;
  // A temporal result reads left to right unless the spec says otherwise. Ranked by the metric
  // instead, a line chart is a scribble.
  const temporal = dims.find((d) => d.field.temporal);
  const order =
    op.sort ??
    (temporal
      ? { by: temporal.field.name, dir: 'asc' as const }
      : { by: measure, dir: 'desc' as const });

  const laid = (rows: ResultRow[]) => rows.sort((a, b) => compare(a, b, order.by, order.dir));

  // An explicit limit is the model asking for a top-N, so it replaces the fold rather than
  // stacking with it: rank the groups by the metric and keep that many.
  if (op.limit !== null) {
    const ranked = groups
      .map(toRow)
      .sort((a, b) => compare(a, b, measure, 'desc'))
      .slice(0, op.limit);
    return finish(laid(ranked), null);
  }

  const plan = foldPlan(dims, seriesBy, chartType);
  if (plan === null) return finish(laid(groups.map(toRow)), null);

  // Rank the folded dimension's *values*, each scored over all of its rows pooled rather than
  // by the largest cell it contains — a Series that is second everywhere outranks one that
  // spikes once.
  const values = new Map<string, { key: Key; rows: number[] }>();
  for (const g of groups) {
    const key = g.keys[plan.index] ?? null;
    const id = keyOf([key]);
    const existing = values.get(id);
    if (existing) existing.rows.push(...g.rows);
    else values.set(id, { key, rows: [...g.rows] });
  }

  if (values.size <= plan.budget) return finish(laid(groups.map(toRow)), null);

  const scored = [...values.values()].map((v) => ({
    v,
    row: toRow({ keys: dims.map((_, i) => (i === plan.index ? v.key : null)), rows: v.rows }),
  }));
  // One slot goes to "Other", so the budget keeps one fewer than it allows on screen.
  const keptValues = scored
    .sort((a, b) => compare(a.row, b.row, measure, 'desc'))
    .slice(0, plan.budget - 1);
  const keptIds = new Set(keptValues.map((s) => keyOf([s.v.key])));

  const isKept = (g: Group) => keptIds.has(keyOf([g.keys[plan.index] ?? null]));
  const shown = laid(groups.filter(isKept).map(toRow));

  // The folded rows are pooled per remaining dimension, so a folded Series keeps one row per
  // x rather than collapsing 152 years into one. Pooled from the rows and not from the values,
  // so an average over "Other" is the mean of those rows and not the mean of their means. One
  // rule, exact for every aggregation.
  const foldedGroups = groups.filter((g) => !isKept(g));
  const pooled = mergeByKeys(
    foldedGroups.map((g) => ({
      keys: g.keys.map((k, i) => (i === plan.index ? FOLD_LABEL : k)),
      rows: g.rows,
    })),
  );
  const everything = toRow({
    keys: dims.map((_, i) => (i === plan.index ? FOLD_LABEL : null)),
    rows: foldedGroups.flatMap((g) => g.rows),
  })[measure];

  return finish([...shown, ...laid(pooled.map(toRow))], {
    dimensionLabel: dims[plan.index]!.field.label,
    kept: keptValues.length,
    folded: values.size - keptValues.length,
    value: typeof everything === 'number' ? everything : null,
  });

  /** The point cap and the ChartSummary, which every path above needs. */
  function finish(rows: ResultRow[], fold: Fold | null): AnalysisResult {
    // ponytail: a scatter's 98,899 rows cross the worker boundary as plain objects, which is a
    // few megabytes of structured clone once per Analysis. A columnar AnalysisResult over typed
    // arrays is the upgrade path if that ever measures; it touches every reader of `rows`.
    const cap = CHART_BUDGET[chartType].points;
    const truncated = rows.length > cap;
    const capped = truncated ? rows.slice(0, cap) : rows;
    return {
      fields,
      rows: capped,
      truncated,
      summary: summarise({ store, op, kept, capped, dims, measure, totalGroups, fold }),
    };
  }
}

function summarise({
  store,
  op,
  kept,
  capped,
  dims,
  measure,
  totalGroups,
  fold,
}: {
  store: ColumnStore;
  op: Operation;
  kept: number[];
  capped: ResultRow[];
  dims: Dimension[];
  measure: string;
  totalGroups: number;
  fold: Fold | null;
}): ChartSummary {
  const agg = op.aggregations.find((a) => a.id === measure);
  const derived = op.derived.find((d) => d.id === measure);
  const metricColumn = agg?.column ?? null;
  const col = metricColumn === null ? undefined : store.columns.get(metricColumn);

  let nullExcluded = 0;
  if (col) for (const row of kept) if (cellText(col, row) === null) nullExcluded++;

  const dimension = dims[0];
  // "Other" is not a category, so it is not a candidate for the extreme. Naming it as the
  // highest would point the reader at the bucket rather than at an answer.
  const extreme = capped
    .filter((r) => !dims.some((d) => r[d.field.name] === FOLD_LABEL))
    .filter((r) => typeof r[measure] === 'number')
    .reduce<{ label: string; value: number } | null>((best, r) => {
      const value = r[measure] as number;
      if (best && best.value >= value) return best;
      const key = dimension ? r[dimension.field.name] : null;
      return { label: key === null ? 'no value' : String(key), value };
    }, null);

  return {
    metricLabel: agg?.label ?? derived?.label ?? measure,
    aggregation: agg?.fn ?? 'ratio',
    dimensionLabel: dimension?.field.label ?? null,
    groupCount: capped.length,
    totalGroups,
    fold,
    extreme,
    nullExcluded,
    rowsMatched: kept.length,
    rowsTotal: store.rowCount,
  };
}
