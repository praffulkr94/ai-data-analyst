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
import type { ChartType, Operation } from '../spec/grammar';
import { timedAsync } from '../perf';
import { fetchDataset } from '../worker/kernel';
import type { DataPort } from '../worker/port';

/** One phase of one run. `nested` phases happened *inside* another phase — the worker's own
    measures inside a round trip — so they are reported beside it and left out of the total. */
export type Phase = { name: string; ms: number; nested?: boolean };

export type Run = {
  phases: Phase[];
  rows: number;
  groups: number;
  /** The bytes the columnar encoding occupies, counted exactly. Null on the paths that hold no
      ColumnStore on this thread. Row objects have no equivalent reading — `performance.memory`
      is quantized and did not move between the three paths at all — so §13's heap snapshot,
      taken by hand in DevTools, is still the only side-by-side memory number. */
  bytes: number | null;
};

export type PathName = 'naive rows, main thread' | 'columnar, main thread' | 'columnar, worker';

/** The two questions, each naming the Dataset whose columns it reads. Not a free choice of
    sample and a fixed Operation: the columns belong to the file.

    The second one is the M8 number nobody measured. 98,899 (date, team) pairs is a result the
    same size as the Dataset, and the whole of ADR-0023's reasoning about the structured clone —
    accepted there without a measurement — is about that message. */
export type Question = {
  label: string;
  sample: string;
  operation: Operation;
  metric: string;
  chartType: ChartType;
};

export const QUESTIONS: Question[] = [
  {
    label: 'matches and goals by host team — 16 bars',
    sample: 'matches',
    metric: 'm',
    chartType: 'bar',
    operation: {
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
    },
  },
  {
    label: 'goals for against goals against, by team and date — 98,899 points',
    sample: 'team_matches',
    metric: 'gf',
    chartType: 'scatter',
    operation: {
      filters: [],
      groupBy: ['date', 'team'],
      timeBucket: null,
      aggregations: [
        { id: 'gf', fn: 'sum', column: 'goals_for', label: 'goals for' },
        { id: 'ga', fn: 'sum', column: 'goals_against', label: 'goals against' },
      ],
      derived: [],
      sort: null,
      limit: null,
    },
  },
];

/** Path one. Papa with `header: true`, which is what an application reaches for first: one
    object per row, every value a string, coerced at read time. */
async function naive(url: string, q: Question): Promise<Run> {
  const phases: Phase[] = [];
  const [blob, fetched] = await timedAsync('naive:fetch', () => fetchDataset(url));
  phases.push({ name: 'fetch and gunzip', ms: fetched });

  const [text, read] = await timedAsync('naive:read', () => blob.text());
  phases.push({ name: 'read as text', ms: read });

  const [rows, parsed] = await timedAsync(
    'naive:parse',
    () => Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy' }).data,
  );
  phases.push({ name: 'parse to row objects', ms: parsed });

  /** The naive aggregate: a `Map` keyed on the grouping columns joined, counting and summing
      whatever the question asks for, coercing every number at read time because that is what a
      row of strings costs. Not the executor with a flag flipped — see the module comment. */
  const group = q.operation.groupBy;
  const sums = q.operation.aggregations.filter((a) => a.fn === 'sum');
  const [groups, aggregated] = await timedAsync('naive:aggregate', () => {
    const out = new Map<string, { n: number; sums: number[] }>();
    for (const row of rows) {
      const key = group.map((c) => row[c] ?? '').join('\u0000');
      let at = out.get(key);
      if (!at) out.set(key, (at = { n: 0, sums: sums.map(() => 0) }));
      at.n++;
      sums.forEach((a, i) => {
        const v = Number(row[a.column!]);
        if (Number.isFinite(v)) at!.sums[i]! += v;
      });
    }
    return [...out.entries()].sort((a, b) => b[1].n - a[1].n);
  });
  phases.push({ name: 'aggregate over objects', ms: aggregated });

  return { phases, rows: rows.length, groups: groups.length, bytes: null };
}

/** Path two. The engine, on the main thread: the same parse, inference, encoding, index and
    aggregation the worker runs, with nothing between it and the interface it is blocking. */
async function columnar(url: string, q: Question): Promise<Run> {
  const phases: Phase[] = [];
  const [blob, fetched] = await timedAsync('columnar:fetch', () => fetchDataset(url));
  phases.push({ name: 'fetch and gunzip', ms: fetched });

  const [text, read] = await timedAsync('columnar:read', () => blob.text());
  phases.push({ name: 'read as text', ms: read });

  const [parsedRows, parsed] = await timedAsync('columnar:parse', () => {
    const data = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data;
    const out = emptyResult(readHeader(data[0]!));
    for (let i = 1; i < data.length; i++) foldRow(out, data[i]!, i, ROW_LIMIT);
    return out;
  });
  phases.push({ name: 'parse to rows of cells', ms: parsed });

  const [schema, inferred] = await timedAsync('columnar:infer', () =>
    inferSchema(parsedRows.header, parsedRows.rows),
  );
  phases.push({ name: 'infer types', ms: inferred });

  const [store, built] = await timedAsync('columnar:encode', () =>
    buildColumnStore(parsedRows.header, parsedRows.rows, schema),
  );
  phases.push({ name: 'encode columns', ms: built });

  const [, indexed] = await timedAsync('columnar:index', () =>
    buildRowIndex(store, { sort: null, filters: [], hidden: [] }),
  );
  phases.push({ name: 'build the RowIndex', ms: indexed });

  const [result, aggregated] = await timedAsync('columnar:aggregate', () =>
    executeOperation(store, q.operation, { metric: q.metric, chartType: q.chartType }),
  );
  phases.push({ name: 'aggregate over columns', ms: aggregated });

  return { phases, rows: store.rowCount, groups: result.rows.length, bytes: storeBytes(store) };
}

/** Path three, and the one that ships. The same work, in the worker, over the real transport —
    so what is measured includes the two things the other paths do not pay: the structured clone
    of the result, and the fact that none of it is on the main thread. */
async function worker(port: DataPort, url: string, id: string, q: Question): Promise<Run> {
  const phases: Phase[] = [];

  const [handled, parsed] = await timedAsync('worker:parse', () =>
    port.send({ type: 'parse', source: { url }, ref: { kind: 'sample', id }, label: id }).done,
  );
  if (handled.type !== 'parse:done') throw new Error(`the worker said ${handled.type}`);
  phases.push({ name: 'parse: the whole round trip', ms: parsed });
  // What the worker measured on its own timeline, inside that round trip.
  const named: Record<string, string> = {
    readAndParse: 'fetch, gunzip and parse',
    infer: 'infer types',
    encode: 'encode columns',
    index: 'build the RowIndex',
  };
  let inside = 0;
  for (const [key, ms] of Object.entries(handled.timings)) {
    phases.push({ name: `  in the worker: ${named[key] ?? key}`, ms, nested: true });
    inside += ms;
  }
  phases.push({ name: '  the round trip minus all of it', ms: parsed - inside, nested: true });

  const [answered, aggregated] = await timedAsync('worker:analyze', () =>
    port.send({
      type: 'analyze',
      operation: q.operation,
      metric: q.metric,
      seriesBy: null,
      chartType: q.chartType,
    }).done,
  );
  if (answered.type !== 'analyze:done') throw new Error(`the worker said ${answered.type}`);
  phases.push({ name: 'analyze: the whole round trip', ms: aggregated });
  const aggregate = answered.timings['aggregate'] ?? 0;
  phases.push({ name: '  in the worker: aggregate', ms: aggregate, nested: true });
  /** The number ADR-0023 accepted on reasoning alone: everything the round trip cost that the
      worker did not spend computing is the structured clone of the result and the two
      postMessages around it. At a thousand rows it is noise; at 98,899 it is the figure. */
  phases.push({ name: '  the clone of the result, and the two hops', ms: aggregated - aggregate, nested: true });

  return {
    phases,
    rows: handled.handle.rowCount,
    groups: answered.result.rows.length,
    // The same encoding as the path above, in the worker's heap, which this thread cannot read.
    // That absence is the point of the path.
    bytes: null,
  };
}

export const PATHS: Record<
  PathName,
  (port: DataPort, url: string, id: string, q: Question) => Promise<Run>
> = {
  'naive rows, main thread': (_port, url, _id, q) => naive(url, q),
  'columnar, main thread': (_port, url, _id, q) => columnar(url, q),
  'columnar, worker': (port, url, id, q) => worker(port, url, id, q),
};
