/** The AnalysisSpec, read back as a compact aligned DSL.

    It replaces the JSON textarea the developer panel carried. JSON in a text field is an
    invitation to edit it, and the specification is edited through the card's controls — so this
    is deliberately a *different* notation from the one on the wire: read-only, one line per
    clause, and in the grammar's own words rather than its field names.

    Aggregation ids (`m`, `gf`) are the model's internal handles and mean nothing to a reader,
    so every reference to one is resolved to its label. */
import type { AnalysisSpec, Filter, Operation } from './grammar';

const SYMBOL: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

const literal = (v: string | number | boolean): string =>
  typeof v === 'string' ? `"${v}"` : String(v);

const filterLine = (f: Filter): string => {
  switch (f.op) {
    case 'in':
      return `${f.column} in ${f.values.map(literal).join(', ')}`;
    case 'between':
    case 'dateRange':
      return `${f.column} ${f.from} → ${f.to}`;
    case 'isNull':
      return `${f.column} is empty`;
    case 'isNotNull':
      return `${f.column} is not empty`;
    default:
      return `${f.column} ${SYMBOL[f.op]} ${literal(f.value)}`;
  }
};

/** What a measure computes, in call notation. `count` takes no column, which is why it is the
    one that reads `count(*)`. */
const call = (fn: string, column: string | null): string => `${fn}(${column ?? '*'})`;

/** Every id a clause can name, mapped to the words a reader knows it by. */
function labels(op: Operation): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of op.aggregations) out.set(a.id, a.label);
  for (const d of op.derived) out.set(d.id, d.label);
  if (op.timeBucket) out.set(op.timeBucket.column, op.timeBucket.column);
  return out;
}

/** Wide enough for `group_by`, the longest clause name, plus three. */
const GUTTER = 11;

export function formatSpec(spec: AnalysisSpec): string {
  const op = spec.operation;
  const name = labels(op);
  const label = (id: string) => name.get(id) ?? id;
  const rows: [string, string][] = [];

  for (const f of op.filters) rows.push(['filter', filterLine(f)]);
  for (const column of op.groupBy) rows.push(['group_by', column]);
  if (op.timeBucket) rows.push(['bucket', `${op.timeBucket.column} by ${op.timeBucket.unit}`]);
  for (const a of op.aggregations) rows.push(['measure', `${call(a.fn, a.column)} as ${a.label}`]);
  for (const d of op.derived) {
    rows.push(['ratio', `${label(d.numerator)} / ${label(d.denominator)} as ${d.label}`]);
  }
  if (op.sort) rows.push(['sort', `${label(op.sort.by)} ${op.sort.dir}`]);
  if (op.limit !== null) rows.push(['limit', String(op.limit)]);

  const vis = spec.visualization;
  rows.push([
    'chart',
    [vis.type, `x=${label(vis.x)}`, `y=${label(vis.y)}`, vis.seriesBy && `by=${vis.seriesBy}`]
      .filter(Boolean)
      .join('  '),
  ]);

  // One fixed gutter rather than one measured per spec: the clause names are a closed set, and
  // an alignment that shifts between two Revisions of the same Analysis reads as a change.
  return rows.map(([k, v]) => `${k.padEnd(GUTTER)}${v}`).join('\n');
}
