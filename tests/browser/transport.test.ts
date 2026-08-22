import { describe, expect, it } from 'vitest';
import { createTransport } from '../../src/worker/transport';
import type { PortRequest } from '../../src/worker/port';

/** The transport is not a test seam — it is the one thing neither seam can hold, because Node
    has no real `Worker`. These tests run in Chromium, where `new Worker(url, {type:'module'})`
    genuinely exists. */

const echo = () =>
  createTransport(() => new Worker(new URL('./echo.worker.ts', import.meta.url), { type: 'module' }));

const real = () =>
  createTransport(
    () => new Worker(new URL('../../src/worker/dataset.worker.ts', import.meta.url), { type: 'module' }),
  );

/** The echo worker takes a shape of its own; the transport only ever adds the correlation id. */
const ask = (delay: number, progress = 0) => ({ delay, progress }) as unknown as PortRequest;

describe('the worker transport', () => {
  it('matches every response to its own request when they come back out of order', async () => {
    const port = echo();
    const slow = port.send(ask(60));
    const quick = port.send(ask(0));
    const middling = port.send(ask(20));

    const order: number[] = [];
    await Promise.all(
      [slow, quick, middling].map((c) => c.done.then((m) => order.push(m.jobId))),
    );
    // Arrival order is quick, middling, slow — the reverse of dispatch order.
    expect(order).toEqual([quick.jobId, middling.jobId, slow.jobId]);
    for (const call of [slow, quick, middling]) {
      await expect(call.done).resolves.toMatchObject({ jobId: call.jobId });
    }
    port.dispose();
  });

  it('routes progress messages to the caller that asked, and does not settle on them', async () => {
    const port = echo();
    const seen: number[] = [];
    const call = port.send(ask(10, 3), (m) => m.type === 'parse:progress' && seen.push(m.rows));
    await expect(call.done).resolves.toMatchObject({ type: 'cancelled' });
    expect(seen).toEqual([1, 2, 3]);
    port.dispose();
  });

  it('parses a real file through the real worker', async () => {
    const port = real();
    const csv = 'date,team,score\n1872-11-30,Scotland,0\n1873-03-08,England,4\n';
    const res = await port.send({
      type: 'parse',
      source: { file: new File([csv], 'matches.csv', { type: 'text/csv' }) },
      ref: { kind: 'upload', filename: 'matches.csv', rowCount: 2 },
      label: 'matches.csv',
    }).done;
    expect(res).toMatchObject({ type: 'parse:done' });
    if (res.type !== 'parse:done') return;
    expect(res.handle.rowCount).toBe(2);
    port.dispose();
  });

  it('cancels a job mid-parse and reports it cancelled rather than done', async () => {
    const port = real();
    const rows = Array.from({ length: 40_000 }, (_, i) => `1990-01-01,Team${i % 50},${i % 9}`);
    const file = new File([`date,team,score\n${rows.join('\n')}\n`], 'big.csv');

    const call = port.send(
      {
        type: 'parse',
        source: { file },
        ref: { kind: 'upload', filename: 'big.csv', rowCount: 40_000 },
        label: 'big.csv',
      },
      // Cancellation is cooperative: the kernel checks the cancelled set between chunks, so
      // the cancel has to land after the parse has started reporting progress.
      (m) => m.type === 'parse:progress' && port.cancel(call.jobId),
    );
    await expect(call.done).resolves.toMatchObject({ type: 'cancelled' });
    port.dispose();
  });

  it('reports the worker crashing rather than hanging the caller', async () => {
    let spawns = 0;
    const port = createTransport(() => {
      spawns++;
      const blob = new Blob(['self.onmessage = () => { throw new Error("boom") }'], {
        type: 'text/javascript',
      });
      return new Worker(URL.createObjectURL(blob), { type: 'module' });
    });
    const crashes: string[] = [];
    port.onCrash((e) => crashes.push(e));
    await expect(port.send(ask(0)).done).rejects.toThrow();
    expect(crashes).toHaveLength(1);
    // Respawned, so the application never white-screens.
    expect(spawns).toBe(2);
    port.dispose();
  });
});
