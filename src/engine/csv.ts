/** CSV reading. Papa Parse does the tokenising — BOM, CRLF, quoted commas and escaped quotes
    are its job, not ours. What lives here is the row contract: a rectangular `string[][]`,
    a count of malformed rows, the first ten of them for display, and the row cap. */
import Papa from 'papaparse';

export type CsvResult = {
  header: string[];
  rows: string[][];
  /** Rows whose cell count did not match the header. A little dirt must not cost the file. */
  skipped: number;
  badRows: { row: number; cells: string[] }[];
  truncated: boolean;
};

/** Above this the tab cannot hold the Dataset, so we cap and say so rather than hang. */
export const ROW_LIMIT = 500_000;
const BAD_ROWS_SHOWN = 10;

export type CsvOptions = { rowLimit?: number };

/** Fold one Papa row into the result. Shared by the one-shot and the chunked readers so the
    row contract cannot drift between them. */
export function foldRow(out: CsvResult, cells: string[], rowNumber: number, rowLimit: number): void {
  if (out.rows.length >= rowLimit) {
    out.truncated = true;
    return;
  }
  // Papa emits a trailing [''] for a final newline; that is not a malformed row.
  if (cells.length === 1 && cells[0] === '') return;
  if (cells.length !== out.header.length) {
    out.skipped++;
    if (out.badRows.length < BAD_ROWS_SHOWN) out.badRows.push({ row: rowNumber, cells });
    return;
  }
  out.rows.push(cells);
}

export function emptyResult(header: string[]): CsvResult {
  return { header, rows: [], skipped: 0, badRows: [], truncated: false };
}

/** Header names, BOM stripped. Papa's `header: true` would give us objects, which is exactly
    the array-of-objects layout the ColumnStore exists to avoid. */
export function readHeader(cells: string[]): string[] {
  return cells.map((h, i) => (i === 0 ? h.replace(/^﻿/, '') : h).trim());
}

/** One-shot read, for tests and small files. The worker uses `Papa.parse` in chunk mode over a
    `File` instead — a one-shot 100k-row parse blocks for seconds wherever it runs. */
export function parseCsv(text: string, { rowLimit = ROW_LIMIT }: CsvOptions = {}): CsvResult {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const [head = [], ...body] = parsed.data;
  const out = emptyResult(readHeader(head));
  body.forEach((cells, i) => foldRow(out, cells, i + 1, rowLimit));
  return out;
}
