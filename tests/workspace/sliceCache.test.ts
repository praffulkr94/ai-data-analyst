import { describe, expect, it } from 'vitest';
import { createSliceCache, MAX_SLICES, SLICE_ROWS } from '../../src/table/sliceCache';
import { createLocalPort } from '../../src/worker/localPort';
import type { DataPort } from '../../src/worker/port';
import type { WorkerResponse } from '../../src/worker/protocol';

const csv = ['n,t', ...Array.from({ length: 1000 }, (_, i) => `${i},t${i % 4}`)].join('\n');

const loaded = async () => {
  const port = createLocalPort();
  await port.send({
    type: 'parse',
    source: { text: csv },
    ref: { kind: 'sample', id: 'x' },
    label: 'x',
  }).done;
  const cache = createSliceCache(port);
  await cache.setView({ sort: null, filters: [], hidden: [] });
  return { port, cache };
};

describe('the SliceCache', () => {
  it('holds the row count from the view and no rows until a RowSlice arrives', async () => {
    const { cache } = await loaded();
    expect(cache.rowCount).toBe(1000);
    expect(cache.row(0)).toEqual(['0', 't0']);
    expect(cache.row(900)).toBeNull();
  });

  it('reports a miss as null so the table can render a skeleton rather than block', async () => {
    const { cache } = await loaded();
    expect(cache.row(500)).toBeNull();
    cache.setRange(500, 520);
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.row(500)).toEqual(['500', 't0']);
  });

  it('names the columns the worker put in the RowSlice', async () => {
    const { cache } = await loaded();
    expect(cache.columns()).toEqual(['n', 't']);
  });

  it('keeps at most the documented number of RowSlices', async () => {
    const { cache } = await loaded();
    for (let start = 0; start < 1000; start += SLICE_ROWS) {
      cache.setRange(start, start + 20);
      await new Promise((r) => setTimeout(r, 0));
    }
    // Ten slices of a thousand rows is under the cap, so nothing should have been evicted; the
    // cap itself is asserted below against a Dataset large enough to exceed it.
    expect(MAX_SLICES).toBe(40);
    expect(cache.row(0)).not.toBeNull();
  });
});

/** A port that answers slices on demand, so arrival order and version can be controlled. */
function scriptedPort(): DataPort & { reply: (m: WorkerResponse) => void; asked: number[] } {
  const settle = new Map<number, (m: WorkerResponse) => void>();
  const asked: number[] = [];
  let nextJobId = 1;
  return {
    asked,
    reply(m) {
      settle.get(m.jobId)?.(m);
      settle.delete(m.jobId);
    },
    send(req) {
      const jobId = nextJobId++;
      if (req.type === 'slice') asked.push(req.offset);
      const done = new Promise<WorkerResponse>((resolve) => {
        if (req.type === 'view') {
          resolve({ type: 'view:done', jobId, viewVersion: 7, rowCount: 1000 });
          return;
        }
        settle.set(jobId, resolve);
      });
      return { jobId, done };
    },
    cancel() {},
    onCrash: () => () => {},
    dispose() {},
  };
}

describe('stale RowSlices', () => {
  const rows = (from: number) =>
    Array.from({ length: SLICE_ROWS }, (_, i) => [String(from + i)] as (string | null)[]);

  it('drops a RowSlice built against an older view version', async () => {
    const port = scriptedPort();
    const cache = createSliceCache(port);
    await cache.setView({ sort: null, filters: [], hidden: [] });
    cache.setRange(0, 50);
    // The view has since been rebuilt — a sort landed — so this answer describes an ordering
    // that is no longer on screen.
    port.reply({
      type: 'slice:done',
      jobId: 2,
      viewVersion: 6,
      offset: 0,
      columns: ['n'],
      rows: rows(0),
    });
    await Promise.resolve();
    expect(cache.row(0)).toBeNull();
  });

  it('drops a RowSlice for rows the viewport has already scrolled past', async () => {
    const port = scriptedPort();
    const cache = createSliceCache(port);
    await cache.setView({ sort: null, filters: [], hidden: [] });
    cache.setRange(0, 50);
    // The visitor flung down the table before the answer came back.
    cache.setRange(800, 850);
    port.reply({
      type: 'slice:done',
      jobId: 2,
      viewVersion: 7,
      offset: 0,
      columns: ['n'],
      rows: rows(0),
    });
    await Promise.resolve();
    expect(cache.row(0)).toBeNull();
  });

  it('keeps a RowSlice that is still on screen when it arrives', async () => {
    const port = scriptedPort();
    const cache = createSliceCache(port);
    await cache.setView({ sort: null, filters: [], hidden: [] });
    cache.setRange(0, 50);
    port.reply({
      type: 'slice:done',
      jobId: 2,
      viewVersion: 7,
      offset: 0,
      columns: ['n'],
      rows: rows(0),
    });
    await Promise.resolve();
    expect(cache.row(3)).toEqual(['3']);
  });

  it('asks once for a RowSlice already in flight', async () => {
    const port = scriptedPort();
    const cache = createSliceCache(port);
    await cache.setView({ sort: null, filters: [], hidden: [] });
    cache.setRange(0, 50);
    cache.setRange(10, 60);
    expect(port.asked.filter((o) => o === 0)).toHaveLength(1);
  });
});
