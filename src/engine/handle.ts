/** The main thread's view of a Dataset. Carries no rows — those live only in the worker's
    ColumnStore. */
import type { ColumnStore, DatasetSchema } from './types';
import { cellText } from './types';

/** A hash-encodable pointer to a Dataset. Survives a page reload, which a DatasetHandle
    cannot: no DatasetSchema, no sample, and above all no rows. */
export type DatasetRef =
  | { kind: 'sample'; id: string }
  | { kind: 'upload'; filename: string; rowCount: number };

/** Rows shown in the preview strip. **UI only** — this is not part of the prompt, and the
    "what the model sees" inspector exists so a visitor can check that for themselves. */
const SAMPLE_ROWS = 20;

export type DatasetHandle = {
  ref: DatasetRef;
  label: string;
  rowCount: number;
  schema: DatasetSchema;
  sampleRows: (string | null)[][];
};

/** Rows whose cell count did not match the header, and whether the row cap was hit. */
export type ParseReport = {
  totalRows: number;
  skipped: number;
  badRows: { row: number; cells: string[] }[];
  truncated: boolean;
};

export function makeHandle(store: ColumnStore, ref: DatasetRef, label: string): DatasetHandle {
  const columns = [...store.columns.values()];
  const rows = Math.min(store.rowCount, SAMPLE_ROWS);
  return {
    ref,
    label,
    rowCount: store.rowCount,
    schema: store.schema,
    sampleRows: Array.from({ length: rows }, (_, r) => columns.map((c) => cellText(c, r))),
  };
}
