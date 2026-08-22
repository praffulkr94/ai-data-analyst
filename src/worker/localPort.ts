/** An in-process port over the same kernel, for the `Workspace` seam tests. Node has no real
    `Worker`, and faking one would test the fake; running the kernel directly tests the kernel.
    The real transport is covered separately, in a browser, where `Worker` exists. */
import { createKernel } from './kernel';
import type { DataPort, PortCall, PortRequest } from './port';
import { isTerminal, type JobId, type WorkerResponse } from './protocol';

type Pending = { settle: (m: WorkerResponse) => void; onProgress?: (m: WorkerResponse) => void };

export function createLocalPort(): DataPort {
  const pending = new Map<JobId, Pending>();
  let nextJobId = 1;

  const handle = createKernel((m) => {
    const p = pending.get(m.jobId);
    if (!p) return;
    if (!isTerminal(m)) {
      p.onProgress?.(m);
      return;
    }
    pending.delete(m.jobId);
    p.settle(m);
  });

  return {
    send(req: PortRequest, onProgress?): PortCall {
      const jobId = nextJobId++;
      const done = new Promise<WorkerResponse>((resolve) => {
        pending.set(jobId, { settle: resolve, onProgress });
      });
      handle({ ...req, jobId } as Parameters<typeof handle>[0]);
      return { jobId, done };
    },
    cancel(jobId) {
      handle({ type: 'cancel', jobId });
    },
    onCrash() {
      return () => {}; // An in-process kernel cannot crash independently of its caller.
    },
    dispose() {
      pending.clear();
    },
  };
}
