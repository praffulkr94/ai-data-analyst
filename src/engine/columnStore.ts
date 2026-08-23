/** Encoding parsed rows into the ColumnStore. The store is the only copy of the rows in the
    application, so the layout choices here are load-bearing — see ADR-0003. */
import { columnDateOrder } from './infer';
import { TOP_VALUES } from './infer';
import type { Column, ColumnMeta, ColumnStore, DatasetSchema } from './types';
import { isNullToken, parseBoolean, parseDate, parseNumber } from './values';

/** A string column with distinct-to-rows below this dictionary-encodes. Measured against the
    real Dataset every string column clears it — `scorer` least comfortably at 32%
    (DECISIONS §A6). Above it, plain strings: the codes would cost more than they save. */
export const DICT_MAX_RATIO = 0.5;

function encodeNumber(cells: string[]): Column {
  const values = new Float64Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    values[i] = isNullToken(cells[i]!) ? NaN : parseNumber(cells[i]!);
  }
  return { kind: 'number', values };
}

function encodeDate(cells: string[], sample: string[]): Column {
  const order = columnDateOrder(sample);
  const values = new Float64Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    values[i] = isNullToken(cells[i]!) ? NaN : parseDate(cells[i]!, order);
  }
  return { kind: 'date', values };
}

function encodeBoolean(cells: string[]): Column {
  const values = new Int8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    values[i] = isNullToken(cells[i]!) ? -1 : parseBoolean(cells[i]!);
  }
  return { kind: 'boolean', values };
}

/** Interning is done over the whole column, so cardinality is exact rather than sampled. The
    Map keys are the strings themselves, which is UTF-8 safe by construction — no byte-level
    encoding is involved anywhere in the store. */
function encodeString(cells: string[]): Column {
  const codes = new Int32Array(cells.length);
  const index = new Map<string, number>();
  const values: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    const raw = cells[i]!;
    if (isNullToken(raw)) {
      codes[i] = -1;
      continue;
    }
    let code = index.get(raw);
    if (code === undefined) {
      code = values.push(raw) - 1;
      index.set(raw, code);
    }
    codes[i] = code;
  }
  if (cells.length > 0 && values.length / cells.length >= DICT_MAX_RATIO) {
    return { kind: 'text', values: cells.map((c) => (isNullToken(c) ? null : c)) };
  }
  return { kind: 'dict', codes, values };
}

/** Exact statistics, read off the encoded column rather than the inference sample. Inference
    only has to *decide the type* from a sample; the ranges and frequencies go into the prompt
    and onto the screen, so a sampled `city` reading 352 distinct instead of 2,092 would be a
    quietly wrong number in both places. */
export function columnStats(col: Column): ColumnMeta['stats'] {
  if (col.kind === 'number' || col.kind === 'date') {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let n = 0;
    for (const v of col.values) {
      if (Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      n++;
    }
    return n === 0 ? null : { min, max, mean: sum / n };
  }

  const counts = new Map<string, number>();
  if (col.kind === 'boolean') {
    for (const v of col.values) {
      if (v < 0) continue;
      const key = v === 1 ? 'TRUE' : 'FALSE';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  } else if (col.kind === 'dict') {
    const tally = new Int32Array(col.values.length);
    for (const code of col.codes) if (code >= 0) tally[code]!++;
    col.values.forEach((v, i) => counts.set(v, tally[i]!));
  } else {
    for (const v of col.values) {
      if (v === null) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return {
    distinct: counts.size,
    top: [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_VALUES)
      .map(([value, count]) => ({ value, count })),
  };
}

function countNulls(col: Column): number {
  let n = 0;
  if (col.kind === 'number' || col.kind === 'date') {
    for (const v of col.values) if (Number.isNaN(v)) n++;
  } else if (col.kind === 'boolean') {
    for (const v of col.values) if (v < 0) n++;
  } else if (col.kind === 'dict') {
    for (const c of col.codes) if (c < 0) n++;
  } else {
    for (const v of col.values) if (v === null) n++;
  }
  return n;
}

/** Build the store. `schema` decides each column's layout, so a visitor's type override is
    honoured by passing an edited schema back in — there is no second inference path. */
export function buildColumnStore(
  header: string[],
  rows: readonly string[][],
  schema: DatasetSchema,
): ColumnStore {
  const columns = new Map<string, Column>();
  const corrected = schema.columns.map((meta) => {
    const at = header.indexOf(meta.name);
    const cells = rows.map((r) => r[at] ?? '');
    const col =
      meta.type === 'number'
        ? encodeNumber(cells)
        : meta.type === 'date'
          ? encodeDate(cells, cells)
          : meta.type === 'boolean'
            ? encodeBoolean(cells)
            : encodeString(cells);
    columns.set(meta.name, col);
    return { ...meta, nullCount: countNulls(col), stats: columnStats(col) };
  });
  return { rowCount: rows.length, columns, schema: { columns: corrected } };
}

/** The bytes a ColumnStore actually occupies, counted rather than estimated: typed arrays know
    their own `byteLength`, and the only other storage is the strings a dictionary or a text
    column holds. A JS string is charged 16 bytes of object header plus two per code unit, which
    is V8's worst case — a one-byte string costs half that, and nothing here rounds down.
    Row objects have no equivalent reading, which is why §13 sends the memory comparison to a
    DevTools heap snapshot and this number stands beside it rather than instead of it. */
export function storeBytes(store: ColumnStore): number {
  const string = (s: string) => 16 + s.length * 2;
  let total = 0;
  for (const col of store.columns.values()) {
    switch (col.kind) {
      case 'number':
      case 'date':
      case 'boolean':
        total += col.values.byteLength;
        break;
      case 'dict':
        total += col.codes.byteLength;
        for (const v of col.values) total += string(v);
        break;
      case 'text':
        for (const v of col.values) total += v === null ? 0 : string(v);
        break;
    }
  }
  return total;
}
