/** The transport: correlation-id bookkeeping over a real `Worker`, about eighty lines.
    Hand-rolled, not Comlink — ADR-0005 and ADR-0013. */
import { isTerminal, type JobId, type WorkerResponse } from './protocol';
import type { DataPort, PortCall, PortRequest } from './port';

type Pending = {
  settle: (m: WorkerResponse) => void;
  fail: (reason: Error) => void;
  onProgress?: (m: WorkerResponse) => void;
};

export type Spawn = () => Worker;

const defaultSpawn: Spawn = () =>
  new Worker(new URL('./dataset.worker.ts', import.meta.url), { type: 'module' });

export function createTransport(spawn: Spawn = defaultSpawn): DataPort {
  let worker = spawn();
  let nextJobId = 1;
  const pending = new Map<JobId, Pending>();
  const crashListeners = new Set<(error: string) => void>();

  function attach(w: Worker): void {
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      const p = pending.get(m.jobId);
      if (!p) return; // A response to a job nobody is waiting on. Dropping it is correct.
      if (!isTerminal(m)) {
        p.onProgress?.(m);
        return;
      }
      pending.delete(m.jobId);
      p.settle(m);
    };
    // A crash fails the jobs in flight and respawns. The application never white-screens;
    // it reports one failure and the visitor re-loads the Dataset.
    w.onerror = (e) => crash(e instanceof ErrorEvent ? e.message : 'The worker stopped.');
    w.onmessageerror = () => crash('The worker sent a message that could not be read.');
  }

  function crash(reason: string): void {
    for (const [, p] of pending) p.fail(new Error(reason));
    pending.clear();
    worker.terminate();
    worker = spawn();
    attach(worker);
    for (const listener of crashListeners) listener(reason);
  }

  attach(worker);

  return {
    send(req: PortRequest, onProgress?: (m: WorkerResponse) => void): PortCall {
      const jobId = nextJobId++;
      const done = new Promise<WorkerResponse>((resolve, reject) => {
        pending.set(jobId, { settle: resolve, fail: reject, onProgress });
      });
      worker.postMessage({ ...req, jobId });
      return { jobId, done };
    },
    cancel(jobId: JobId): void {
      worker.postMessage({ type: 'cancel', jobId });
    },
    onCrash(listener) {
      crashListeners.add(listener);
      return () => crashListeners.delete(listener);
    },
    dispose() {
      pending.clear();
      worker.terminate();
    },
  };
}
