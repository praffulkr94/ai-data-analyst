/** The worker message protocol: a discriminated union with correlation ids, hand-rolled.
    Deliberately not Comlink — see ADR-0005 and ADR-0013. Comlink would hide exactly the
    thing this file makes legible: which messages exist, what each carries, and the fact that
    rows never appear in any of them. */
import type { DatasetHandle, DatasetRef, ParseReport } from '../engine/handle';
import type { ColumnType } from '../engine/types';

/** The correlation id. One per request, matched on the way back. */
export type JobId = number;

/** Where the rows come from. A built-in sample is a gzipped URL the worker fetches itself, so
    the text never crosses the main thread. */
export type ParseSource = { file: File } | { text: string } | { url: string };

export type WorkerRequest =
  | { type: 'parse'; jobId: JobId; source: ParseSource; ref: DatasetRef; label: string }
  | { type: 'retype'; jobId: JobId; column: string; columnType: ColumnType }
  | { type: 'cancel'; jobId: JobId };

export type WorkerErrorCode = 'parse-failed' | 'no-dataset' | 'unknown-column' | 'internal';

export type WorkerResponse =
  | { type: 'parse:progress'; jobId: JobId; rows: number }
  | { type: 'parse:done'; jobId: JobId; handle: DatasetHandle; report: ParseReport }
  | { type: 'retype:done'; jobId: JobId; handle: DatasetHandle }
  | { type: 'cancelled'; jobId: JobId }
  | { type: 'error'; jobId: JobId; code: WorkerErrorCode; message: string };

/** The response that closes a job. Anything else is progress, and more may follow. */
export function isTerminal(m: WorkerResponse): boolean {
  return m.type !== 'parse:progress';
}
