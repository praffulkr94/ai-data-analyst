/** The three paths `/bench` compares, and the statistics over them.
 *
 * The comparison DECISIONS §7 and §13 ask for: the same Dataset and the same question, done
 * three ways. Naive main-thread row objects, columnar on the main thread, and the real path —
 * columnar in the worker. What it is trying to show is *not* that a `Map` groupBy is slow: it
 * is not, and claiming so is the straw man §7 throws out. What separates the paths is parsing,
 * type inference, encoding and index building, and where they run.
 *
 * The naive path is a naive path on purpose: row objects of strings, `Number()` at read time,
 * no index. It is not the engine with a flag flipped, and its aggregate is not asserted against
 * the engine's — the two agree on this Operation by construction, and the numbers here are
 * about cost, not correctness. */
import Papa from 'papaparse';
import { buildColumnStore, storeBytes } from '../engine/columnStore';
import { emptyResult, foldRow, readHeader, ROW_LIMIT } from '../engine/csv';
import { inferSchema } from '../engine/infer';
import { executeOperation } from '../engine/operation';
import { buildRowIndex } from '../engine/rowIndex';
import type { Operation } from '../spec/grammar';
import { fetchDataset } from '../worker/kernel';
import type { DataPort } from '../worker/port';

/** One phase of one run, in milliseconds, keyed by phase name in the order they ran. */
export type Run = {
  phases: [string, number][];
  rows: number;
  groups: number;
  /** The bytes the columnar encoding occupies, counted exactly. Null on the paths that hold no
      ColumnStore on this thread. Row objects have no equivalent reading — `performance.memory`
      is quantized and did not move between the three paths at all — so §13's heap snapshot,
      taken by hand in DevTools, is still the only side-by-side memory number. */
  bytes: number | null;
};

export type PathName = 'naive rows, main thread' | 'columnar, main thread' | 'columnar, worker';

/** `performance.mark`/`measure` rather than two `now()` readings, so every phase is also in the
    performance timeline and a DevTools trace of a run is readable without this page. */
async function measure<T>(name: string, fn: () => T | Promise<T>): Promise<[T, number]> {
  performance.mark(`${name}:start`);
  const value = await fn();
  const m = performance.measure(name, `${name}:start`);
  return [value, m.duration];
}

/** The question all three paths answer: matches per host team, and the goals with them. Group
    by a categorical column of a few thousand values, count, sum, rank. */
export const OPERATION: Operation = {
  filters: [],
  groupBy: ['home_team'],
  timeBucket: null,
  aggregations: [
    { id: 'm', fn: 'count', column: null, label: 'matches' },
    { id: 'g', fn: 'sum', column: 'home_score', label: 'goals' },
  ],
  derived: [],
  sort: { by: 'm', dir: 'desc' },
  limit: null,
};

/** Path one. Papa with `header: true`, which is what an application reaches for first: one
    object per row, every value a string, coerced at read time. */
async function naive(url: string): Promise<Run> {
  const phases: [string, number][] = [];
  const [blob, fetched] = await measure('naive:fetch', () => fetchDataset(url));
  phases.push(['fetch and gunzip', fetched]);

  const [text, read] = await measure('naive:read', () => blob.text());
  phases.push(['read as text', read]);

  const [rows, parsed] = await measure(
    'naive:parse',
    () => Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy' }).data,
  );
  phases.push(['parse to row objects', parsed]);

  const [groups, aggregated] = await measure('naive:aggregate', () => {
    const out = new Map<string, { m: number; g: number }>();
    for (const row of rows) {
      const key = row['home_team'] ?? '';
      const at = out.get(key) ?? { m: 0, g: 0 };
      at.m++;
      // The naive coercion: a number that lives as a string is a `Number()` per row per read.
      const goals = Number(row['home_score']);
      if (Number.isFinite(goals)) at.g += goals;
      out.set(key, at);
    }
    return [...out.entries()].sort((a, b) => b[1].m - a[1].m);
  });
  phases.push(['aggregate over objects', aggregated]);

  return { phases, rows: rows.length, groups: groups.length, bytes: null };
}

/** Path two. The engine, on the main thread: the same parse, inference, encoding, index and
    aggregation the worker runs, with nothing between it and the interface it is blocking. */
async function columnar(url: string): Promise<Run> {
  const phases: [string, number][] = [];
  const [blob, fetched] = await measure('columnar:fetch', () => fetchDataset(url));
  phases.push(['fetch and gunzip', fetched]);

  const [text, read] = await measure('columnar:read', () => blob.text());
  phases.push(['read as text', read]);

  const [parsedRows, parsed] = await measure('columnar:parse', () => {
    const data = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data;
    const out = emptyResult(readHeader(data[0]!));
    for (let i = 1; i < data.length; i++) foldRow(out, data[i]!, i, ROW_LIMIT);
    return out;
  });
  phases.push(['parse to rows of cells', parsed]);

  const [schema, inferred] = await measure('columnar:infer', () =>
    inferSchema(parsedRows.header, parsedRows.rows),
  );
  phases.push(['infer types', inferred]);

  const [store, built] = await measure('columnar:encode', () =>
    buildColumnStore(parsedRows.header, parsedRows.rows, schema),
  );
  phases.push(['encode columns', built]);

  const [, indexed] = await measure('columnar:index', () =>
    buildRowIndex(store, { sort: null, filters: [], hidden: [] }),
  );
  phases.push(['build the RowIndex', indexed]);

  const [result, aggregated] = await measure('columnar:aggregate', () =>
    executeOperation(store, OPERATION, { metric: 'm' }),
  );
  phases.push(['aggregate over columns', aggregated]);

  return { phases, rows: store.rowCount, groups: result.rows.length, bytes: storeBytes(store) };
}

/** Path three, and the one that ships. The same work, in the worker, over the real transport —
    so what is measured includes the two things the other paths do not pay: the structured clone
    of the result, and the fact that none of it is on the main thread. */
async function worker(port: DataPort, url: string, id: string): Promise<Run> {
  const phases: [string, number][] = [];

  const [handled, parsed] = await measure('worker:parse', () =>
    port.send({ type: 'parse', source: { url }, ref: { kind: 'sample', id }, label: id }).done,
  );
  if (handled.type !== 'parse:done') throw new Error(`the worker said ${handled.type}`);
  phases.push(['fetch, parse, infer, encode, index', parsed]);

  const [answered, aggregated] = await measure('worker:analyze', () =>
    port.send({ type: 'analyze', operation: OPERATION, metric: 'm', seriesBy: null, chartType: 'bar' })
      .done,
  );
  if (answered.type !== 'analyze:done') throw new Error(`the worker said ${answered.type}`);
  phases.push(['aggregate and clone the result back', aggregated]);

  return {
    phases,
    rows: handled.handle.rowCount,
    groups: answered.result.rows.length,
    // The same encoding as the path above, in the worker's heap, which this thread cannot read.
    // That absence is the point of the path.
    bytes: null,
  };
}

export const PATHS: Record<PathName, (port: DataPort, url: string, id: string) => Promise<Run>> = {
  'naive rows, main thread': (_port, url) => naive(url),
  'columnar, main thread': (_port, url) => columnar(url),
  'columnar, worker': (port, url, id) => worker(port, url, id),
};
