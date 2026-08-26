/** What kind of values a column holds. `boolean` is first-class: `TRUE`/`FALSE` is not two
    text Categories (DECISIONS §A6 finding 3). */
export type ColumnType = 'number' | 'date' | 'categorical' | 'boolean';

export type NumberStats = { min: number; max: number; mean: number };
export type CategoryStats = { distinct: number; top: { value: string; count: number }[] };

/** One column of a DatasetSchema. `confidence` is the share of non-null sampled values that
    matched the winning ColumnType; 1 means every value fit. */
export type ColumnMeta = {
  name: string;
  type: ColumnType;
  confidence: number;
  nullCount: number;
  /** True when the type was set by the visitor rather than inferred. */
  overridden?: boolean;
  stats: NumberStats | CategoryStats | null;
};

/** Below this, the winning type did not fit enough of the sampled values to be taken on trust.
    A Dataset with no such column has nothing to ask a person about, and the inference gate does
    not open for it (ADR-0026). */
export const CONFIDENT = 0.99;

/** A column the inference is not sure enough about to use without asking. An override is a
    visitor's own decision and is never second-guessed. */
export const isUncertain = (c: ColumnMeta): boolean => !c.overridden && c.confidence < CONFIDENT;

export type DatasetSchema = { columns: ColumnMeta[] };

export const isNumberStats = (s: ColumnMeta['stats']): s is NumberStats =>
  s !== null && 'mean' in s;
export const isCategoryStats = (s: ColumnMeta['stats']): s is CategoryStats =>
  s !== null && 'distinct' in s;

/* ---- ColumnStore: the worker's private storage, one column at a time. ------------------
   The only copy of the rows in the application. `NaN` and `-1` are the null sentinels. */

export type NumberColumn = { kind: 'number'; values: Float64Array };
/** Epoch milliseconds, so a date column is arithmetic-ready and NaN-nullable like a number. */
export type DateColumn = { kind: 'date'; values: Float64Array };
export type BooleanColumn = { kind: 'boolean'; values: Int8Array };
/** Dictionary encoding, for string columns under 50% cardinality. Must be UTF-8 safe:
    14 team names and 11,639 scorer values are non-ASCII. */
export type DictColumn = { kind: 'dict'; codes: Int32Array; values: string[] };
/** Plain strings, for the rare column at or above 50% cardinality. `null` is the null. */
export type TextColumn = { kind: 'text'; values: (string | null)[] };

export type Column = NumberColumn | DateColumn | BooleanColumn | DictColumn | TextColumn;

export type ColumnStore = {
  rowCount: number;
  /** Insertion-ordered, matching `DatasetSchema.columns`. */
  columns: Map<string, Column>;
  /** The schema the store was encoded against, with `nullCount` corrected to the true count
      over every row — inference only ever saw a sample. */
  schema: DatasetSchema;
};

/** Read one cell as a display string. The single place that knows every Column layout. */
export function cellText(col: Column, row: number): string | null {
  switch (col.kind) {
    case 'number': {
      const v = col.values[row]!;
      return Number.isNaN(v) ? null : String(v);
    }
    case 'date': {
      const v = col.values[row]!;
      return Number.isNaN(v) ? null : new Date(v).toISOString().slice(0, 10);
    }
    case 'boolean': {
      const v = col.values[row]!;
      return v < 0 ? null : v === 1 ? 'TRUE' : 'FALSE';
    }
    case 'dict': {
      const code = col.codes[row]!;
      return code < 0 ? null : col.values[code]!;
    }
    case 'text':
      return col.values[row] ?? null;
  }
}

/** Read one cell as a sortable/comparable value. */
export function cellValue(col: Column, row: number): number | string | null {
  switch (col.kind) {
    case 'number':
    case 'date': {
      const v = col.values[row]!;
      return Number.isNaN(v) ? null : v;
    }
    case 'boolean': {
      const v = col.values[row]!;
      return v < 0 ? null : v;
    }
    default:
      return cellText(col, row);
  }
}
