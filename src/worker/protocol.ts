/** The worker message protocol: a discriminated union with correlation ids, hand-rolled.
    Deliberately not Comlink — see ADR-0005 and ADR-0013. Comlink would hide exactly the
    thing this file makes legible: which messages exist, what each carries, and the fact that
    rows never appear in any of them. */
import type { DatasetHandle, DatasetRef, ParseReport } from '../engine/handle';
import type { AnalysisResult } from '../engine/result';
import type { ViewState } from '../engine/rowIndex';
import type { ColumnType } from '../engine/types';
import type { ChartType, Operation } from '../spec/grammar';

/** The correlation id. One per request, matched on the way back. */
export type JobId = number;

/** Where the rows come from. A built-in sample is a gzipped URL the worker fetches itself, so
    the text never crosses the main thread. */
export type ParseSource = { file: File } | { text: string } | { url: string };

export type WorkerRequest =
  | { type: 'parse'; jobId: JobId; source: ParseSource; ref: DatasetRef; label: string }
  | { type: 'retype'; jobId: JobId; column: string; columnType: ColumnType }
  | { type: 'view'; jobId: JobId; viewState: ViewState }
  | { type: 'slice'; jobId: JobId; offset: number; limit: number }
  /** `metric`, `seriesBy` and `chartType` are the Visualization's: the executor needs them to
      know what the ChartSummary speaks about, which dimension the fold collapses, and how many
      points and Series survive. None of the three is readable from the Operation. */
  | {
      type: 'analyze';
      jobId: JobId;
      operation: Operation;
      metric: string;
      seriesBy: string | null;
      chartType: ChartType;
    }
  | { type: 'cancel'; jobId: JobId };

export type WorkerErrorCode = 'parse-failed' | 'no-dataset' | 'unknown-column' | 'internal';

export type WorkerResponse =
  | { type: 'parse:progress'; jobId: JobId; rows: number }
  | { type: 'parse:done'; jobId: JobId; handle: DatasetHandle; report: ParseReport }
  | { type: 'retype:done'; jobId: JobId; handle: DatasetHandle }
  /** Never rows. The main thread learns how many there are and nothing else. */
  | { type: 'view:done'; jobId: JobId; viewVersion: number; rowCount: number }
  /** The one message that carries cells, capped at a few hundred rows by the SliceCache. */
  | {
      type: 'slice:done';
      jobId: JobId;
      viewVersion: number;
      offset: number;
      columns: string[];
      rows: (string | null)[][];
    }
  /** At most the chart type's point budget: a thousand for an aggregate chart, 100,000 for a
      scatter, where one point per row is the shape asked for (ADR-0023). */
  | { type: 'analyze:done'; jobId: JobId; result: AnalysisResult }
  | { type: 'cancelled'; jobId: JobId }
  | { type: 'error'; jobId: JobId; code: WorkerErrorCode; message: string };

/** The response that closes a job. Anything else is progress, and more may follow. */
export function isTerminal(m: WorkerResponse): boolean {
  return m.type !== 'parse:progress';
}
