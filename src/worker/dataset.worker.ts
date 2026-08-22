/// <reference lib="webworker" />
/** The worker: an adapter over the kernel. Everything interesting is in `kernel.ts`, which is
    also what the in-process port runs, so the two cannot drift. */
import { createKernel } from './kernel';
import type { WorkerRequest } from './protocol';

const handle = createKernel((m) => self.postMessage(m));

self.onmessage = (e: MessageEvent<WorkerRequest>) => handle(e.data);
