import { describe, expect, it } from 'vitest';
import { createLocalPort } from '../../src/worker/localPort';
import type { DatasetRef } from '../../src/engine/handle';

const ref: DatasetRef = { kind: 'sample', id: 'matches' };
const csv = [
  'date,home_team,home_score,neutral',
  '1872-11-30,Scotland,0,FALSE',
  '1873-03-08,England,4,FALSE',
  '2026-07-19,"Kansas City, MO",2,TRUE',
].join('\n');

const parse = async (text: string) => {
  const port = createLocalPort();
  const progress: number[] = [];
  const res = await port.send(
    { type: 'parse', source: { text }, ref, label: 'matches.csv' },
    (m) => m.type === 'parse:progress' && progress.push(m.rows),
  ).done;
  return { res, progress, port };
};

describe('the kernel, driven through a port', () => {
  it('answers a parse with a DatasetHandle carrying the DatasetSchema', async () => {
    const { res } = await parse(csv);
    expect(res.type).toBe('parse:done');
    if (res.type !== 'parse:done') return;
    expect(res.handle.rowCount).toBe(3);
    expect(res.handle.schema.columns.map((c) => c.type)).toEqual([
      'date',
      'categorical',
      'number',
      'boolean',
    ]);
  });

  it('carries a small sample for the preview and nothing more', async () => {
    const { res } = await parse(csv);
    if (res.type !== 'parse:done') throw new Error('expected parse:done');
    expect(res.handle.sampleRows).toHaveLength(3);
    expect(res.handle.sampleRows[2]![1]).toBe('Kansas City, MO');
    // The handle is the main thread's description of a Dataset. It must carry no rows beyond
    // the preview sample — the point the "what the model sees" inspector exists to prove.
    expect(Object.keys(res.handle).sort()).toEqual([
      'label',
      'ref',
      'rowCount',
      'sampleRows',
      'schema',
    ]);
  });

  it('reports malformed rows without failing the file', async () => {
    const { res } = await parse('a,b\n1,2\n3\n4,5\n');
    if (res.type !== 'parse:done') throw new Error('expected parse:done');
    expect(res.report).toMatchObject({ totalRows: 3, skipped: 1, truncated: false });
    expect(res.report.badRows[0]!.row).toBe(2);
  });

  it('reports an error rather than throwing when the file holds nothing', async () => {
    const { res } = await parse('');
    expect(res).toMatchObject({ type: 'error', code: 'parse-failed' });
  });

  it('re-encodes a column under a type the visitor chose', async () => {
    const port = createLocalPort();
    await port.send({ type: 'parse', source: { text: csv }, ref, label: 'm' }).done;
    const res = await port.send({ type: 'retype', column: 'home_score', columnType: 'categorical' })
      .done;
    if (res.type !== 'retype:done') throw new Error('expected retype:done');
    const col = res.handle.schema.columns.find((c) => c.name === 'home_score')!;
    expect(col).toMatchObject({ type: 'categorical', overridden: true });
    expect(res.handle.sampleRows[1]![2]).toBe('4');
  });

  it('refuses a retype of a column that does not exist', async () => {
    const port = createLocalPort();
    await port.send({ type: 'parse', source: { text: csv }, ref, label: 'm' }).done;
    const res = await port.send({ type: 'retype', column: 'revenu', columnType: 'number' }).done;
    expect(res).toMatchObject({ type: 'error', code: 'unknown-column' });
  });

  it('refuses a retype before any Dataset is loaded', async () => {
    const res = await createLocalPort().send({
      type: 'retype',
      column: 'a',
      columnType: 'number',
    }).done;
    expect(res).toMatchObject({ type: 'error', code: 'no-dataset' });
  });

  it('matches each response to its own job', async () => {
    const port = createLocalPort();
    const a = port.send({ type: 'parse', source: { text: csv }, ref, label: 'a' });
    const b = port.send({ type: 'retype', column: 'nope', columnType: 'number' });
    const [ra, rb] = await Promise.all([a.done, b.done]);
    expect(ra.jobId).toBe(a.jobId);
    expect(rb.jobId).toBe(b.jobId);
    expect(a.jobId).not.toBe(b.jobId);
  });
});

describe('view and slice', () => {
  const rows = Array.from({ length: 500 }, (_, i) => `1990-01-0${(i % 9) + 1},Team${i % 7},${i}`);
  const big = ['date,team,n', ...rows].join('\n');

  const loaded = async () => {
    const port = createLocalPort();
    await port.send({ type: 'parse', source: { text: big }, ref, label: 'big' }).done;
    return port;
  };

  it('answers a view with a row count and a version, and never with rows', async () => {
    const port = await loaded();
    const res = await port.send({
      type: 'view',
      viewState: { sort: { column: 'n', dir: 'desc' }, hidden: [] },
    }).done;
    expect(res.type).toBe('view:done');
    if (res.type !== 'view:done') return;
    expect(res.rowCount).toBe(500);
    expect(Object.keys(res).sort()).toEqual(['jobId', 'rowCount', 'type', 'viewVersion']);
  });

  it('answers a slice with the requested run of rows in the current view order', async () => {
    const port = await loaded();
    await port.send({ type: 'view', viewState: { sort: { column: 'n', dir: 'desc' }, hidden: [] } })
      .done;
    const res = await port.send({ type: 'slice', offset: 0, limit: 3 }).done;
    if (res.type !== 'slice:done') throw new Error('expected slice:done');
    expect(res.rows.map((r) => r[2])).toEqual(['499', '498', '497']);
    expect(res.columns).toEqual(['date', 'team', 'n']);
  });

  it('bumps the view version on every view, so a slice in flight can be recognised as stale', async () => {
    const port = await loaded();
    const first = await port.send({
      type: 'view',
      viewState: { sort: { column: 'n', dir: 'asc' }, hidden: [] },
    }).done;
    const second = await port.send({
      type: 'view',
      viewState: { sort: { column: 'n', dir: 'desc' }, hidden: [] },
    }).done;
    if (first.type !== 'view:done' || second.type !== 'view:done') throw new Error('bad');
    expect(second.viewVersion).toBe(first.viewVersion + 1);
  });

  it('omits hidden columns from the slice', async () => {
    const port = await loaded();
    await port.send({ type: 'view', viewState: { sort: null, hidden: ['team'] } }).done;
    const res = await port.send({ type: 'slice', offset: 0, limit: 1 }).done;
    if (res.type !== 'slice:done') throw new Error('expected slice:done');
    expect(res.columns).toEqual(['date', 'n']);
    expect(res.rows[0]).toHaveLength(2);
  });

  it('has a view ready as soon as the Dataset lands, without being asked', async () => {
    const port = await loaded();
    const res = await port.send({ type: 'slice', offset: 0, limit: 2 }).done;
    if (res.type !== 'slice:done') throw new Error('expected slice:done');
    expect(res.viewVersion).toBe(1);
    expect(res.rows).toHaveLength(2);
  });

  it('refuses a view before any Dataset is loaded', async () => {
    const res = await createLocalPort().send({
      type: 'view',
      viewState: { sort: null, hidden: [] },
    }).done;
    expect(res).toMatchObject({ type: 'error', code: 'no-dataset' });
  });
});
