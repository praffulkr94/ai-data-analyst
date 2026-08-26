/** The inference gate: the stage between parsing and the workspace.

    It exists because inference is where a live demo breaks, and a visitor who never saw the
    guess has no way to know why an analysis is impossible (DECISIONS §21.1). What it must *not*
    do is stand in the way of the two arrivals that are not a first look at a Dataset: a retype,
    which comes back through the same `setDataset`, and a shared link, whose visitor came for a
    chart rather than for a schema review (ADR-0026). */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatasetHandle } from '../../src/engine/handle';
import { useApp } from '../../src/store';
import { reset } from './harness';

const handle = (label: string): DatasetHandle =>
  ({
    label,
    rowCount: 3,
    ref: { kind: 'sample', id: 'matches' },
    schema: { columns: [{ name: 'city', type: 'categorical', confidence: 1, nullCount: 0, stats: null }] },
  }) as DatasetHandle;

describe('the inference gate', () => {
  beforeEach(reset);

  it('opens when a Dataset arrives, and Continue is the only way past it', () => {
    useApp.getState().setDataset(handle('a.csv'), null);
    expect(useApp.getState().load.status).toBe('inferring');
    useApp.getState().confirmInference();
    expect(useApp.getState().load.status).toBe('ready');
  });

  /** `loader.retype` re-encodes one column in the worker and lands the rebuilt handle through
      this same action. Re-opening the gate there would put a stage between the visitor and the
      change they just made. */
  it('does not re-open when the same Dataset comes back from a retype', () => {
    useApp.getState().setDataset(handle('a.csv'), null);
    useApp.getState().confirmInference();
    useApp.getState().setDataset(handle('a.csv'), null);
    expect(useApp.getState().load.status).toBe('ready');
  });

  it('opens again for a different Dataset', () => {
    useApp.getState().setDataset(handle('a.csv'), null);
    useApp.getState().confirmInference();
    useApp.getState().setDataset(handle('b.csv'), null);
    expect(useApp.getState().load.status).toBe('inferring');
  });

  /** A link that carries an Analysis is a link to a chart. `resumeSession` has already parked
      the spec in `restore`, and interposing a schema review would answer a question nobody
      following that link asked. */
  it('stays out of the way of a link that carries an Analysis', () => {
    useApp.getState().awaitRestore({
      ref: { kind: 'sample', id: 'matches' },
      spec: {
        title: 'T',
        narration: 'N',
        operation: {
          filters: [],
          groupBy: ['city'],
          timeBucket: null,
          aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
          derived: [],
          sort: null,
          limit: null,
        },
        visualization: { type: 'bar', x: 'city', y: 'm', seriesBy: null },
      },
    });
    useApp.getState().setDataset(handle('a.csv'), null);
    expect(useApp.getState().load.status).toBe('ready');
  });
});
