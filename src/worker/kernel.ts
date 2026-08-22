/** The kernel: everything the worker does, as a plain function of request to responses. The
    worker file is a fifteen-line adapter over this, and so is the in-process port the
    `Workspace` seam tests run against — so there is one implementation, not two.

    The kernel owns the Dataset. One kernel, not a pool; one Dataset at a time. Parsing,
    inference and encoding all happen here so the main thread keeps responding — see ADR-0003
    and ADR-0004 for why aggregation is *not* the reason this exists. */
import Papa from 'papaparse';
import { buildColumnStore } from '../engine/columnStore';
import { emptyResult, foldRow, readHeader, ROW_LIMIT, type CsvResult } from '../engine/csv';
import { makeHandle, type DatasetRef } from '../engine/handle';
import { inferSchema } from '../engine/infer';
import { cellText, type ColumnStore, type ColumnType } from '../engine/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

export type Post = (m: WorkerResponse) => void;

/** Fetch a shipped Dataset, gunzipping it only if it actually arrives gzipped. Some hosts —
    Vite's dev server among them — serve a `.gz` file with `Content-Encoding: gzip`, so the
    browser has already decompressed it by the time we see the body; others serve the bytes
    untouched. Sniffing the two-byte magic number is correct on both. */
async function fetchDataset(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch ${url} — the server said ${res.status}.`);
  const blob = await res.blob();
  const [a, b] = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (a !== 0x1f || b !== 0x8b) return blob;
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
}

/** Rows read between cancellation checks inside one chunk. */
const CANCEL_CHECK_ROWS = 8_000;

/** Papa's default is 10MB, which reads the whole hero Dataset in a single synchronous
    callback — and a callback cannot receive the `cancel` message that would stop it. Half a
    megabyte is roughly 8,000 rows of the real data, so the worker yields to its message loop
    often enough for cooperative cancellation to actually cooperate. */
const CHUNK_BYTES = 512 * 1024;

export function createKernel(post: Post) {
  /** Cooperative cancellation. `terminate()` loses the Dataset and is never the primary path. */
  const cancelled = new Set<number>();

  /** The single ColumnStore. Rows exist here and nowhere else — the raw parsed strings are
      released as soon as they are encoded, so this is genuinely the only copy. */
  const state: { store: ColumnStore | null; ref: DatasetRef | null; label: string } = {
    store: null,
    ref: null,
    label: '',
  };

  function parse(req: Extract<WorkerRequest, { type: 'parse' }>): void {
    const { jobId, source, ref, label } = req;
    let out: CsvResult | null = null;
    let rowNumber = 0;
    let sinceCheck = 0;
    let aborted = false;

    /** Papa hands us rows in chunks for a File and all at once for a string. Either way the
        first row is the header and the rest fold into the result. */
    const take = (rows: string[][], abort: () => void) => {
      // The chunk boundary is the cancellation point that matters: it is the only moment the
      // worker's message loop has run since the last chunk.
      if (cancelled.has(jobId)) {
        aborted = true;
        abort();
        return;
      }
      for (const cells of rows) {
        if (!out) {
          out = emptyResult(readHeader(cells));
          continue;
        }
        foldRow(out, cells, ++rowNumber, ROW_LIMIT);
        if (++sinceCheck < CANCEL_CHECK_ROWS) continue;
        sinceCheck = 0;
        post({ type: 'parse:progress', jobId, rows: out.rows.length });
        if (cancelled.has(jobId)) {
          aborted = true;
          abort();
          return;
        }
      }
    };

    const finish = () => {
      if (aborted || cancelled.has(jobId)) {
        cancelled.delete(jobId);
        post({ type: 'cancelled', jobId });
        return;
      }
      const result = out;
      if (!result) {
        post({ type: 'error', jobId, code: 'parse-failed', message: 'The file held no rows.' });
        return;
      }
      const schema = inferSchema(result.header, result.rows);
      const store = buildColumnStore(result.header, result.rows, schema);
      Object.assign(state, { store, ref, label });
      post({
        type: 'parse:done',
        jobId,
        handle: makeHandle(store, ref, label),
        report: {
          totalRows: result.rows.length + result.skipped,
          skipped: result.skipped,
          badRows: result.badRows,
          truncated: result.truncated,
        },
      });
    };

    const onError = (err: Error) =>
      post({ type: 'error', jobId, code: 'parse-failed', message: err.message });

    const readFile = (file: File) =>
      Papa.parse<string[], File>(file, {
        skipEmptyLines: 'greedy',
        chunkSize: CHUNK_BYTES,
        chunk: (results, parser) => take(results.data, () => parser.abort()),
        complete: finish,
        error: onError,
      });

    if ('url' in source) {
      // Gunzipped in the worker and handed to Papa as a Blob, so the parse stays chunked and
      // the decompressed text never exists on the main thread.
      fetchDataset(source.url)
        .then((blob) => readFile(blob as unknown as File))
        .catch(onError);
      return;
    }
    if ('text' in source) {
      Papa.parse<string[]>(source.text, {
        skipEmptyLines: 'greedy',
        complete: (results) => {
          take(results.data, () => {});
          finish();
        },
        error: onError,
      });
      return;
    }
    readFile(source.file);
  }

  /** Re-encode one column under a ColumnType the visitor chose. The strings come back out of the
      existing Column rather than from a retained copy of the file, so overriding a type costs no
      standing memory. */
  function retype(jobId: number, name: string, columnType: ColumnType): void {
    const store = state.store;
    if (!store || !state.ref) {
      post({ type: 'error', jobId, code: 'no-dataset', message: 'No Dataset is loaded.' });
      return;
    }
    const header = [...store.columns.keys()];
    if (!header.includes(name)) {
      post({ type: 'error', jobId, code: 'unknown-column', message: `No column named ${name}.` });
      return;
    }
    const rows = Array.from({ length: store.rowCount }, (_, r) =>
      header.map((h) => cellText(store.columns.get(h)!, r) ?? ''),
    );
    const columns = store.schema.columns.map((c) =>
      c.name === name ? { ...c, type: columnType, overridden: true } : c,
    );
    const next = buildColumnStore(header, rows, { columns });
    state.store = next;
    post({ type: 'retype:done', jobId, handle: makeHandle(next, state.ref, state.label) });
  }

  return function handle(req: WorkerRequest): void {
    switch (req.type) {
      case 'cancel':
        cancelled.add(req.jobId);
        return;
      case 'parse':
        parse(req);
        return;
      case 'retype':
        retype(req.jobId, req.column, req.columnType);
        return;
    }
  };
}

export type Kernel = ReturnType<typeof createKernel>;
