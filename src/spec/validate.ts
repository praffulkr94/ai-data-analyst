/** The semantic validator: a plain function of an AnalysisSpec and a DatasetSchema to a typed
    list of SpecViolations.

    Deliberately not Zod refinements with a context object. Zod's job is structure — shapes,
    enums, required fields, dataset-independent — and `strict: true` on the tool makes that a
    backstop rather than the headline. This layer is the one that knows what the visitor actually
    loaded, it is the highest-value unit-test target in the codebase, and it has to return a rich
    typed error list that the single Repair hands back to the model. Plain TypeScript gives all
    three; a refinement gives none of them. */
import type { ColumnMeta, ColumnType, DatasetSchema } from '../engine/types';
import { isCategoryStats } from '../engine/types';
import type { AggregationFn, AnalysisSpec, Operation, Visualization } from './grammar';

export type SpecViolation = {
  code:
    | 'unknown-column'
    | 'illegal-aggregation'
    | 'count-takes-no-column'
    | 'duplicate-id'
    | 'unknown-field'
    | 'not-a-measure'
    | 'not-a-dimension'
    | 'chart-mismatch'
    | 'cardinality'
    | 'not-temporal'
    | 'filter-type';
  /** Where in the spec, so the model can see which part to change. */
  path: string;
  /** Names the offender and lists what would have been valid. Handed back verbatim in the
      Repair's `tool_result`, so it has to be useful to a reader who cannot see the Dataset. */
  message: string;
};

/** Refused before rendering, with a top-N offered instead — a bad Question must not be able to
    hang the tab. */
export const CARDINALITY_CAP = 50_000;

/** Which aggregations each ColumnType admits. `avg` of a boolean is nonsense and `sum` of one is
    a miscount dressed as a total; `rate` is what a boolean actually wants. */
const LEGAL: Record<ColumnType, AggregationFn[]> = {
  number: ['sum', 'avg', 'count', 'countDistinct', 'min', 'max', 'median'],
  date: ['count', 'countDistinct', 'min', 'max'],
  categorical: ['count', 'countDistinct'],
  boolean: ['count', 'countDistinct', 'rate'],
};

/** Filter operators that need a numeric or date column to mean anything. */
const ORDERED_OPS = new Set(['gt', 'gte', 'lt', 'lte', 'between']);

export function validateSpec(spec: AnalysisSpec, schema: DatasetSchema): SpecViolation[] {
  const out: SpecViolation[] = [];
  const columns = new Map(schema.columns.map((c) => [c.name, c]));
  const op = spec.operation;

  const column = (name: string, path: string, kinds?: ColumnType[]): ColumnMeta | null => {
    const col = columns.get(name);
    if (!col) {
      out.push({
        code: 'unknown-column',
        path,
        message: `Column \`${name}\` does not exist. Available columns: ${list(
          schema.columns.map((c) => c.name),
        )}.`,
      });
      return null;
    }
    if (kinds && !kinds.includes(col.type)) {
      out.push({
        code: 'filter-type',
        path,
        message: `Column \`${name}\` is ${col.type}, which does not support this. ${kinds.join(
          ' or ',
        )} columns here: ${list(named(schema, kinds))}.`,
      });
      return null;
    }
    return col;
  };

  /* ---- filters --------------------------------------------------------------------- */
  op.filters.forEach((f, i) => {
    const path = `operation.filters[${i}]`;
    if (ORDERED_OPS.has(f.op)) column(f.column, path, ['number', 'date']);
    else if (f.op === 'dateRange') column(f.column, path, ['date']);
    else column(f.column, path);
  });

  /* ---- grouping -------------------------------------------------------------------- */
  op.groupBy.forEach((name, i) => {
    const col = column(name, `operation.groupBy[${i}]`);
    if (!col) return;
    const distinct = isCategoryStats(col.stats) ? col.stats.distinct : 0;
    if (distinct > CARDINALITY_CAP) {
      out.push({
        code: 'cardinality',
        path: `operation.groupBy[${i}]`,
        message:
          `Grouping by \`${name}\` would produce ${distinct.toLocaleString('en-US')} categories, ` +
          `past the ${CARDINALITY_CAP.toLocaleString('en-US')} the application will draw. ` +
          `Add a limit to ask for a top-N instead.`,
      });
    }
  });

  if (op.timeBucket) {
    const col = columns.get(op.timeBucket.column);
    if (!col) column(op.timeBucket.column, 'operation.timeBucket.column');
    else if (col.type !== 'date') {
      out.push({
        code: 'not-temporal',
        path: 'operation.timeBucket.column',
        message: `Column \`${col.name}\` is ${col.type}, so it cannot be bucketed by time. Date columns: ${list(
          named(schema, ['date']),
        )}.`,
      });
    }
  }

  /* ---- aggregations ---------------------------------------------------------------- */
  const ids = new Set<string>();
  op.aggregations.forEach((a, i) => {
    const path = `operation.aggregations[${i}]`;
    if (ids.has(a.id)) {
      out.push({ code: 'duplicate-id', path, message: `Two aggregations share the id \`${a.id}\`.` });
    }
    ids.add(a.id);

    if (a.fn === 'count') {
      if (a.column !== null) {
        out.push({
          code: 'count-takes-no-column',
          path: `${path}.column`,
          message: '`count` counts rows and takes no column. Use `countDistinct` for a column.',
        });
      }
      return;
    }
    if (a.column === null) {
      out.push({
        code: 'unknown-column',
        path: `${path}.column`,
        message: `\`${a.fn}\` needs a column. Available columns: ${list(
          schema.columns.map((c) => c.name),
        )}.`,
      });
      return;
    }
    const col = columns.get(a.column);
    if (!col) {
      column(a.column, `${path}.column`);
      return;
    }
    if (!LEGAL[col.type].includes(a.fn)) {
      out.push({
        code: 'illegal-aggregation',
        path,
        message:
          `\`${a.fn}\` is not legal on \`${col.name}\`, which is ${col.type}. ` +
          `Legal here: ${list(LEGAL[col.type])}. ` +
          `Numeric columns: ${list(named(schema, ['number']))}.`,
      });
    }
  });

  op.derived.forEach((d, i) => {
    const path = `operation.derived[${i}]`;
    if (ids.has(d.id)) {
      out.push({ code: 'duplicate-id', path, message: `\`${d.id}\` is already an aggregation id.` });
    }
    for (const [side, ref] of [
      ['numerator', d.numerator],
      ['denominator', d.denominator],
    ] as const) {
      if (!ids.has(ref)) {
        out.push({
          code: 'unknown-field',
          path: `${path}.${side}`,
          message: `\`${ref}\` is not an aggregation in this Operation. Aggregation ids: ${list([
            ...ids,
          ])}.`,
        });
      }
    }
    ids.add(d.id);
  });

  /* ---- the output fields ----------------------------------------------------------- */
  const output = outputFields(op, schema);
  const field = (name: string, path: string) => {
    const f = output.get(name);
    if (f) return f;
    out.push({
      code: 'unknown-field',
      path,
      message:
        `\`${name}\` is not in the output of this Operation. ` +
        `The Operation produces: ${list([...output.keys()])}. ` +
        `A column of the Dataset is not automatically a field of the result — it has to be ` +
        `grouped by, bucketed, or aggregated first.`,
    });
    return null;
  };

  if (op.sort) field(op.sort.by, 'operation.sort.by');

  /* ---- the Visualization ----------------------------------------------------------- */
  out.push(...validateVisualization(spec.visualization, output, field));

  return out;
}

type OutputField = { name: string; role: 'dimension' | 'measure'; type: ColumnType; temporal: boolean };

/** The fields the Operation produces. The Visualization has to name these, not merely columns of
    the Dataset — the specific confusion this function exists to make checkable. */
export function outputFields(op: Operation, schema: DatasetSchema): Map<string, OutputField> {
  const out = new Map<string, OutputField>();
  if (op.timeBucket) {
    out.set(op.timeBucket.column, {
      name: op.timeBucket.column,
      role: 'dimension',
      type: 'date',
      temporal: true,
    });
  }
  for (const name of op.groupBy) {
    if (out.has(name)) continue;
    out.set(name, {
      name,
      role: 'dimension',
      type: schema.columns.find((c) => c.name === name)?.type ?? 'categorical',
      temporal: false,
    });
  }
  for (const a of op.aggregations) {
    out.set(a.id, { name: a.id, role: 'measure', type: 'number', temporal: false });
  }
  for (const d of op.derived) {
    out.set(d.id, { name: d.id, role: 'measure', type: 'number', temporal: false });
  }
  return out;
}

function validateVisualization(
  viz: Visualization,
  output: Map<string, OutputField>,
  field: (name: string, path: string) => OutputField | null,
): SpecViolation[] {
  const out: SpecViolation[] = [];
  const x = field(viz.x, 'visualization.x');
  const y = field(viz.y, 'visualization.y');
  const series = viz.seriesBy === null ? null : field(viz.seriesBy, 'visualization.seriesBy');

  if (y && y.role !== 'measure') {
    out.push({
      code: 'not-a-measure',
      path: 'visualization.y',
      message: `\`${y.name}\` is a dimension, so it cannot be the y-axis. Measures available: ${list(
        measures(output),
      )}.`,
    });
  }

  if (x) {
    if (viz.type === 'scatter' && x.role !== 'measure') {
      out.push({
        code: 'chart-mismatch',
        path: 'visualization.x',
        message: `A scatter plots one measure against another, and \`${x.name}\` is a dimension. Measures available: ${list(
          measures(output),
        )}.`,
      });
    }
    if (viz.type !== 'scatter' && x.role !== 'dimension') {
      out.push({
        code: 'not-a-dimension',
        path: 'visualization.x',
        message: `A ${viz.type} chart needs a dimension on the x-axis, and \`${x.name}\` is a measure. Dimensions available: ${list(
          dimensions(output),
        )}.`,
      });
    }
    if (
      (viz.type === 'line' || viz.type === 'area') &&
      x.role === 'dimension' &&
      !x.temporal &&
      x.type !== 'number'
    ) {
      out.push({
        code: 'chart-mismatch',
        path: 'visualization.type',
        message:
          `A ${viz.type} chart joins its points, which implies an order, and \`${x.name}\` is ` +
          `${x.type} with no order to imply. Use a bar chart, or bucket a date column by time.`,
      });
    }
  }

  if (series && series.role !== 'dimension') {
    out.push({
      code: 'not-a-dimension',
      path: 'visualization.seriesBy',
      message: `\`${series.name}\` is a measure, so it cannot separate the Series. Dimensions available: ${list(
        dimensions(output),
      )}.`,
    });
  }
  if (series && series.name === viz.x) {
    out.push({
      code: 'chart-mismatch',
      path: 'visualization.seriesBy',
      message: `\`${series.name}\` is already the x-axis, so splitting the Series by it would draw one mark per Series.`,
    });
  }
  return out;
}

const measures = (output: Map<string, OutputField>) =>
  [...output.values()].filter((f) => f.role === 'measure').map((f) => f.name);
const dimensions = (output: Map<string, OutputField>) =>
  [...output.values()].filter((f) => f.role === 'dimension').map((f) => f.name);
const named = (schema: DatasetSchema, kinds: ColumnType[]) =>
  schema.columns.filter((c) => kinds.includes(c.type)).map((c) => c.name);

const list = (items: readonly string[]) => (items.length === 0 ? 'none' : items.join(', '));
