/** The RowIndex — the ordered set of rows a ViewState selects from a Dataset — and reading a
    RowSlice out of it. Both run in the worker: locale-aware string sorting over 49,520 rows is
    precisely the expensive work the worker exists to keep off the main thread (ADR-0004). */
import { filterRows } from './operation';
import type { Filter } from '../spec/grammar';
import type { Column, ColumnStore } from './types';
import { cellText } from './types';

/** How the visitor has arranged the table. Inspection only — it never changes an Analysis, and
    table sort never drives the chart (DECISIONS §11). */
export type ViewState = {
  sort: { column: string; dir: 'asc' | 'desc' } | null;
  /** The active Analysis's filters, so the table can show the rows behind its chart. They arrive
      from the Analysis and are removed as a chip; the table never sends them the other way. */
  filters: Filter[];
  /** Columns the visitor has hidden. */
  hidden: string[];
};

/** Ranks for a dictionary column: the collation runs over the dictionary, not the rows. Sorting
    `city` means ordering 2,092 names rather than 49,520, which is where the saving is. */
function dictRanks(values: string[]): Float64Array {
  const order = values.map((_, i) => i).sort((a, b) => values[a]!.localeCompare(values[b]!));
  const ranks = new Float64Array(values.length);
  order.forEach((code, rank) => {
    ranks[code] = rank;
  });
  return ranks;
}

/** A sort key per row, with `NaN` for nulls. Reducing every ColumnType to a number means one
    comparator, and it is the comparator that runs 49,520·log(49,520) times. */
function sortKeys(col: Column): Float64Array {
  // A number or a date is already its own sort key.
  if (col.kind === 'number' || col.kind === 'date') return col.values;
  const n = col.kind === 'dict' ? col.codes.length : col.values.length;
  const keys = new Float64Array(n);
  switch (col.kind) {
    case 'boolean':
      for (let i = 0; i < n; i++) keys[i] = col.values[i]! < 0 ? NaN : col.values[i]!;
      return keys;
    case 'dict': {
      const ranks = dictRanks(col.values);
      for (let i = 0; i < n; i++) {
        const code = col.codes[i]!;
        keys[i] = code < 0 ? NaN : ranks[code]!;
      }
      return keys;
    }
    case 'text': {
      const present = col.values.filter((v): v is string => v !== null);
      const ranks = new Map<string, number>();
      [...new Set(present)]
        .sort((a, b) => a.localeCompare(b))
        .forEach((v, rank) => ranks.set(v, rank));
      for (let i = 0; i < n; i++) {
        const v = col.values[i] ?? null;
        keys[i] = v === null ? NaN : ranks.get(v)!;
      }
      return keys;
    }
  }
}

export function buildRowIndex(store: ColumnStore, view: ViewState): Int32Array {
  // The same selection the Operation makes, so the table under an Analysis's chip holds exactly
  // the rows its chart was computed from.
  const index =
    view.filters.length > 0
      ? Int32Array.from(filterRows(store, view.filters))
      : Int32Array.from({ length: store.rowCount }, (_, i) => i);

  const col = view.sort ? store.columns.get(view.sort.column) : undefined;
  if (!view.sort || !col) return index;

  const keys = sortKeys(col);
  const dir = view.sort.dir === 'asc' ? 1 : -1;
  // Nulls sort last in both directions: a missing value is not a small one. Ties fall back to
  // the row number, which makes the ordering stable — equal rows keep their file order.
  const ordered = Array.from(index).sort((a, b) => {
    const ka = keys[a]!;
    const kb = keys[b]!;
    const na = Number.isNaN(ka);
    const nb = Number.isNaN(kb);
    if (na || nb) return na && nb ? a - b : na ? 1 : -1;
    return ka === kb ? a - b : (ka < kb ? -1 : 1) * dir;
  });
  return Int32Array.from(ordered);
}

/** A RowSlice: a contiguous run of rows, as display text. Never the whole Dataset — the
    protocol caps this at a few hundred rows because it is the only message carrying cells. */
export function readSlice(
  store: ColumnStore,
  index: Int32Array,
  offset: number,
  limit: number,
  columns: string[],
): (string | null)[][] {
  const cols = columns.map((name) => store.columns.get(name)).filter((c): c is Column => !!c);
  const end = Math.min(offset + limit, index.length);
  const out: (string | null)[][] = [];
  for (let i = Math.max(0, offset); i < end; i++) {
    const row = index[i]!;
    out.push(cols.map((c) => cellText(c, row)));
  }
  return out;
}
