/** The main thread's side of the protocol. `DataPort` is the whole surface the application
    sees, so the `Workspace` seam can be driven by an in-process port while the real transport
    is tested where a real `Worker` exists. */
import type { JobId, WorkerRequest, WorkerResponse } from './protocol';

/** A request minus its correlation id — the transport assigns that. Distributive, so the union
    survives: a plain `Omit` over a union collapses it into one unusable shape. */
type WithoutJobId<T> = T extends unknown ? Omit<T, 'jobId'> : never;
export type PortRequest = WithoutJobId<Exclude<WorkerRequest, { type: 'cancel' }>>;

export type PortCall = {
  jobId: JobId;
  /** Resolves with the response that closed the job. Rejects only if the worker died. */
  done: Promise<WorkerResponse>;
};

export type DataPort = {
  send(req: PortRequest, onProgress?: (m: WorkerResponse) => void): PortCall;
  cancel(jobId: JobId): void;
  /** Called when the worker died and was respawned. The Dataset is gone with it. */
  onCrash(listener: (error: string) => void): () => void;
  dispose(): void;
};
