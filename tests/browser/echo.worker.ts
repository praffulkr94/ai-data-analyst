/// <reference lib="webworker" />
/** A test-only worker that answers on demand and out of order, so the transport's
    correlation-id bookkeeping can be exercised independently of the kernel. */
type Ask = { jobId: number; delay: number; progress?: number };

self.onmessage = (e: MessageEvent<Ask | { type: 'cancel'; jobId: number }>) => {
  const m = e.data;
  if ('type' in m) return;
  for (let i = 0; i < (m.progress ?? 0); i++) {
    self.postMessage({ type: 'parse:progress', jobId: m.jobId, rows: i + 1 });
  }
  setTimeout(() => self.postMessage({ type: 'cancelled', jobId: m.jobId }), m.delay);
};
