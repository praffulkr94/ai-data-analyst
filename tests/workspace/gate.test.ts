/** The inference gate: the stage between parsing and the workspace.

    It exists because inference is where a live demo breaks, and a visitor who never saw the
    guess has no way to know why an analysis is impossible (DECISIONS §21.1). What it must *not*
    do is stand in the way of the three arrivals that are not a decision: a Dataset every column
    of which typed confidently, which has nothing to ask; a retype, which comes back through the
    same `setDataset`; and a shared link, whose visitor came for a chart rather than for a schema
    review (ADR-0026, ADR-0027). */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatasetHandle } from '../../src/engine/handle';
import { parseHash } from '../../src/route';
import { SAMPLES } from '../../src/data/samples';
import { useApp } from '../../src/store';
import { reset, setup } from './harness';

/** `confidence` is what decides whether there is anything to ask about: 0.9 of the sampled values
    matching is a column in doubt, 1 is one that is not. */
const handle = (label: string, confidence = 0.9): DatasetHandle =>
  ({
    label,
    rowCount: 3,
    ref: { kind: 'sample', id: 'matches' },
    schema: { columns: [{ name: 'city', type: 'categorical', confidence, nullCount: 0, stats: null }] },
  }) as DatasetHandle;

describe('the inference gate', () => {
  beforeEach(reset);

  it('opens when a Dataset arrives with a column in doubt, and Continue is the way past it', () => {
    useApp.getState().setDataset(handle('a.csv'), null);
    expect(useApp.getState().load.status).toBe('inferring');
    expect(useApp.getState().typesReviewed).toBe(true);
    useApp.getState().confirmInference();
    expect(useApp.getState().load.status).toBe('ready');
  });

  /** The case this screen used to open for anyway. With every type confident the screen had no
      decision on it — one line of census and a Continue button — so it asked permission to do
      what had just been asked for. The census is news, and news goes to the workspace. */
  it('does not open when every column typed confidently', () => {
    useApp.getState().setDataset(handle('a.csv', 1), null);
    expect(useApp.getState().load.status).toBe('ready');
    expect(useApp.getState().typesReviewed).toBe(false);
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

  /** Switching Datasets from `#/data` used to leave the visitor on `#/data`, watching a table of
      columns that were about to stop existing. Whatever the arrival has to say — the gate when
      there is a decision in it, `LoadNews` when there is not — is said on home, so a switch that
      stays on the data surface silently skips both. */
  it('sends the route home, because a switch is not a view change', async () => {
    const { workspace } = await setup();
    location.hash = '#/data';
    expect(parseHash().route).toBe('data');

    await workspace.loadDataset(SAMPLES[0]!);

    expect(parseHash().route).toBe('home');
  });

  /** A refused file — the wrong type, or over the cap — is rejected before anything is touched,
      so the Dataset on screen is still loaded and still answerable. Failing the whole load state
      for it would disable the composer over a file that never got in. Only a worker crash, which
      takes the ColumnStore with it, is fatal. */
  describe('a load that fails with a Dataset already open', () => {
    it('leaves it usable and puts the message on the strip', () => {
      useApp.getState().setDataset(handle('a.csv', 1), null);
      useApp.getState().failLoad('notes.pdf is not a CSV.');

      expect(useApp.getState().load.status).toBe('ready');
      expect(useApp.getState().loadFailure).toBe('notes.pdf is not a CSV.');
      expect(useApp.getState().datasetHandle?.label).toBe('a.csv');
    });

    it('fails the whole state when the worker died and took the rows with it', () => {
      useApp.getState().setDataset(handle('a.csv', 1), null);
      useApp.getState().failLoad('The worker stopped.', true);

      expect(useApp.getState().load.status).toBe('failed');
    });

    /** Nothing else puts the status back — `run` returns early on a job it no longer owns — so
        without this the interface sits on the progress stage for a load that has stopped. */
    it('goes back to ready when the visitor cancels', () => {
      useApp.getState().setDataset(handle('a.csv', 1), null);
      useApp.getState().beginLoad('big.csv');
      useApp.getState().cancelLoad();

      expect(useApp.getState().load.status).toBe('ready');
    });
  });
});
