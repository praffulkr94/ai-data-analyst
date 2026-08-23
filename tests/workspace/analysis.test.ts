/** Analyses and Revisions: where a Request's result lands, and what happens to the Analysis it
    lands on. The Request lifecycle itself is `workspace.test.ts`; this file is about the target.

    The harness is shared — the scripted Translator, the builders and the four-row CSV all come
    from `harness.ts` rather than a second copy of them. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from '../../src/store';
import {
  aggregationOptions,
  chartTypeOptions,
  withAggregation,
  withChartType,
} from '../../src/spec/edits';
import type { ModelReply } from '../../src/spec/grammar';
import type { DataPort } from '../../src/worker/port';
import { analyses, analysis, attempt, byId, flush, reset, setup, titles } from './harness';

/** Land one Analysis and return its id, so a test that is about the *second* Request does not
    spend six lines on the first. */
async function landed(
  s: Awaited<ReturnType<typeof setup>>,
  question: string,
  title: string,
  column?: string,
): Promise<string> {
  const n = s.script.calls.length;
  void s.workspace.ask(question);
  await flush();
  await s.script.resolve(n, attempt(analysis(title, column)));
  return useApp.getState().activeAnalysisId!;
}

describe('the Analysis a Revision lands on', () => {
  beforeEach(reset);

  it('writes to the Analysis captured at dispatch, not the one on screen when it resolves', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    const b = await landed(s, 'matches by neutral ground', 'Matches by neutral ground', 'neutral');

    // Back to A, and a refine dispatched against it.
    s.workspace.selectCard(a);
    void s.workspace.ask('same but by neutral');
    await flush();

    // The visitor navigates to B while that Request is still in flight. Selecting an Analysis is
    // a pure view change: it cancels nothing and it must not redirect the result.
    s.workspace.selectCard(b);
    await s.script.resolve(2, attempt(analysis('Matches by team', 'neutral', 'refine')));

    expect(byId(a)!.revisions).toHaveLength(2);
    expect(byId(b)!.revisions).toHaveLength(1);
    // Navigation is not a submission, so it is still B on screen.
    expect(useApp.getState().activeAnalysisId).toBe(b);
  });

  it('marks an Analysis whose Revision landed out of view, and clears it on arrival', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    const b = await landed(s, 'matches by neutral ground', 'Matches by neutral ground', 'neutral');

    s.workspace.selectCard(a);
    void s.workspace.ask('same but by neutral');
    await flush();
    s.workspace.selectCard(b);
    await s.script.resolve(2, attempt(analysis('Matches by team', 'neutral', 'refine')));

    // Without the marker the finished work is silently invisible: the visitor is looking at B.
    expect(byId(a)!.updated).toBe(true);
    expect(byId(b)!.updated).toBe(false);

    s.workspace.selectCard(a);
    expect(byId(a)!.updated).toBe(false);
  });

  it('leaves no marker on an Analysis the visitor was watching', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    void s.workspace.ask('same but by neutral');
    await flush();
    await s.script.resolve(1, attempt(analysis('Matches by team', 'neutral', 'refine')));

    expect(byId(a)!.revisions).toHaveLength(2);
    expect(byId(a)!.updated).toBe(false);
  });

  it('starts a new Analysis when a refine resolves against a target that has been deleted', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');

    void s.workspace.ask('same but by neutral');
    await flush();
    s.workspace.deleteCard(a);
    await s.script.resolve(1, attempt(analysis('Matches by team', 'neutral', 'refine')));

    // The target is gone, so there is nothing to append to — but the work was asked for, so it
    // lands rather than being thrown away.
    expect(titles()).toEqual(['Matches by team']);
    expect(analyses()[0]!.id).not.toBe(a);
    expect(analyses()[0]!.revisions).toHaveLength(1);
  });
});

describe('Revisions', () => {
  beforeEach(reset);

  it('never mutates a Revision that has already landed', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    const first = byId(a)!.revisions[0]!;
    const snapshot = JSON.stringify(first);

    void s.workspace.ask('same but by neutral');
    await flush();
    await s.script.resolve(1, attempt(analysis('Matches by team', 'neutral', 'refine')));

    expect(byId(a)!.revisions[0]).toBe(first);
    expect(JSON.stringify(byId(a)!.revisions[0])).toBe(snapshot);
    expect(byId(a)!.revisions[1]!.spec.visualization.x).toBe('neutral');
  });

  it('shows the newest Revision, and steps back and forward without changing them', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    void s.workspace.ask('same but by neutral');
    await flush();
    await s.script.resolve(1, attempt(analysis('Matches by team', 'neutral', 'refine')));

    expect(byId(a)!.at).toBe(1);
    useApp.getState().stepRevision(a, -1);
    expect(byId(a)!.at).toBe(0);
    // Clamped at both ends: there is no Revision before the first or after the last.
    useApp.getState().stepRevision(a, -1);
    expect(byId(a)!.at).toBe(0);
    useApp.getState().stepRevision(a, 1);
    useApp.getState().stepRevision(a, 1);
    expect(byId(a)!.at).toBe(1);
    expect(byId(a)!.revisions).toHaveLength(2);
  });

  it('jumps to a Revision that lands while an older one is on screen', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    void s.workspace.ask('same but by neutral');
    await flush();
    await s.script.resolve(1, attempt(analysis('Matches by team', 'neutral', 'refine')));
    useApp.getState().stepRevision(a, -1);

    void s.workspace.ask('and again');
    await flush();
    await s.script.resolve(2, attempt(analysis('Matches by team', 'home_team', 'refine')));

    expect(byId(a)!.revisions).toHaveLength(3);
    expect(byId(a)!.at).toBe(2);
  });
});

describe('deleting an Analysis', () => {
  beforeEach(reset);

  it('removes it and falls back to the one before it', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    const b = await landed(s, 'by neutral', 'Matches by neutral ground', 'neutral');

    s.workspace.deleteCard(b);
    expect(titles()).toEqual(['Matches by team']);
    expect(useApp.getState().activeAnalysisId).toBe(a);

    s.workspace.deleteCard(a);
    expect(analyses()).toEqual([]);
    expect(useApp.getState().activeAnalysisId).toBeNull();
  });

  it('leaves the selection alone when the deleted Analysis was not the active one', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    const b = await landed(s, 'by neutral', 'Matches by neutral ground', 'neutral');

    s.workspace.deleteCard(a);
    expect(useApp.getState().activeAnalysisId).toBe(b);
    expect(titles()).toEqual(['Matches by neutral ground']);
  });

  it('drops the deleted Analysis from the history a later refine would carry', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    s.workspace.deleteCard(a);

    // A new Analysis reuses no id, so this is only about the exchange history: the deleted
    // Analysis's Question must not surface in a later Request's context.
    const b = await landed(s, 'by neutral', 'Matches by neutral ground', 'neutral');
    void s.workspace.ask('refine that');
    await flush();
    const refine = s.script.calls[2]!.req.refine!;
    expect(refine.history.map((e) => e.question)).toEqual(['by neutral']);
    expect(b).not.toBe(a);
  });
});

describe('the manual controls', () => {
  beforeEach(reset);

  it('produces a Revision identical in kind to a spoken one, in the same history', async () => {
    const s = await setup();
    const a = await landedBucketed(s);
    const spoken = byId(a)!.revisions[0]!;

    await s.workspace.revise(withChartType(spoken.spec, 'line'));

    const manual = byId(a)!.revisions[1]!;
    expect(byId(a)!.revisions).toHaveLength(2);
    // Same shape, same keys, one history — the spec is a real object with two editors over it.
    expect(Object.keys(manual).sort()).toEqual(Object.keys(spoken).sort());
    expect(manual.spec.visualization.type).toBe('line');
    expect(manual.model).toBe(spoken.model);
    // Recomputed, not copied: a manual edit runs the same worker execution a spoken one does.
    expect(manual.result.rows).toEqual(spoken.result.rows);
    expect(manual.result).not.toBe(spoken.result);
    // And it asked the model nothing.
    expect(s.script.calls).toHaveLength(1);
  });

  it('changes the aggregation and relabels the measure with it', async () => {
    const s = await setup();
    const a = await landed(s, 'goals by team', 'Goals by team');
    const spec = withAggregation(
      { ...byId(a)!.revisions[0]!.spec, ...avgOf('home_score') },
      'sum',
    );
    await s.workspace.revise(spec);

    const revision = byId(a)!.revisions[1]!;
    expect(revision.spec.operation.aggregations[0]!.fn).toBe('sum');
    // A caption reading "average goals" over a sum is a caption that lies.
    expect(revision.spec.operation.aggregations[0]!.label).toBe('sum of home_score');
    expect(revision.result.summary.aggregation).toBe('sum');
    // England scored 4 and 2, Scotland 0 and 2 — hand-worked from the four-row fixture.
    expect(revision.result.rows.map((r) => r.m)).toEqual([6, 2]);
  });

  it('offers only the options the semantic validator would accept', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    const schema = { columns: useApp.getState().columns };
    const counting = byId(a)!.revisions[0]!.spec;

    // A count over a categorical x: a line joins its points, which implies an order `home_team`
    // does not have, and every function but `count` needs a column `count` does not carry.
    expect(chartTypeOptions(counting, schema)).toEqual(['bar']);
    expect(aggregationOptions(counting, schema)).toEqual(['count']);

    const averaging = { ...counting, ...avgOf('home_score') };
    expect(aggregationOptions(averaging, schema)).toEqual([
      'sum',
      'avg',
      'countDistinct',
      'min',
      'max',
      'median',
    ]);
  });

  it('supersedes a Question that is still in flight, rather than racing it', async () => {
    const s = await setup();
    const a = await landedBucketed(s);
    const spec = byId(a)!.revisions[0]!.spec;

    void s.workspace.ask('make it something else');
    await flush();
    await s.workspace.revise(withChartType(spec, 'line'));
    await s.script.resolve(1, attempt(analysis('Matches by team', 'neutral', 'refine')));

    // Two Revisions, not three: the Question was dispatched first and lost.
    expect(byId(a)!.revisions).toHaveLength(2);
    expect(byId(a)!.revisions[1]!.spec.visualization.type).toBe('line');
  });
});

describe('the table under an Analysis', () => {
  beforeEach(reset);

  it('filters to the rows behind the active Analysis and clears with the chip', async () => {
    const s = await setup();
    void s.workspace.ask('matches Scotland played at home');
    await flush();
    await s.script.resolve(0, attempt(analysis('Scotland at home', 'home_team')), );

    // A Revision carrying a filter puts the table on the rows its chart was computed from.
    const spec = useApp.getState().analyses[0]!.revisions[0]!.spec;
    await s.workspace.revise({
      ...spec,
      operation: {
        ...spec.operation,
        filters: [{ op: 'eq', column: 'home_team', value: 'Scotland' }],
      },
    });

    expect(useApp.getState().viewState.filters).toHaveLength(1);
    expect(await rowCount(s.port)).toBe(2);

    useApp.getState().clearTableFilter();
    expect(await rowCount(s.port)).toBe(4);
    // Removing the chip is a table action, so the Analysis it came from is untouched.
    expect(useApp.getState().analyses[0]!.revisions[1]!.spec.operation.filters).toHaveLength(1);
  });

  it('never lets the table drive the chart', async () => {
    const s = await setup();
    const a = await landed(s, 'matches by team', 'Matches by team');
    const before = byId(a)!.revisions[0]!.spec;

    useApp.getState().sortBy('home_score');
    useApp.getState().toggleColumn('neutral');
    useApp.getState().clearTableFilter();

    expect(byId(a)!.revisions).toHaveLength(1);
    expect(s.workspace.latestSpec()).toBe(before);
  });
});

/** Counting by year: a temporal x-axis, which is what makes a line or an area chart a legal
    thing for the chart-type toggle to offer at all. */
const byYear: ModelReply = {
  kind: 'analysis',
  intent: 'new',
  title: 'Matches by year',
  narration: 'Counting matches by year.',
  operation: {
    filters: [],
    groupBy: [],
    timeBucket: { column: 'date', unit: 'year' },
    aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
    derived: [],
    sort: null,
    limit: null,
  },
  visualization: { type: 'bar', x: 'date', y: 'm', seriesBy: null },
};

async function landedBucketed(s: Awaited<ReturnType<typeof setup>>): Promise<string> {
  const n = s.script.calls.length;
  void s.workspace.ask('matches by year');
  await flush();
  await s.script.resolve(n, attempt(byYear));
  return useApp.getState().activeAnalysisId!;
}

/** The metric as an average of a numeric column, which is what most of the aggregation options
    need to exist at all: `count` carries no column, so nothing else is legal on it. */
const avgOf = (column: string) => ({
  operation: {
    filters: [],
    groupBy: ['home_team'],
    timeBucket: null,
    aggregations: [{ id: 'm', fn: 'avg' as const, column, label: `avg of ${column}` }],
    derived: [],
    sort: null,
    limit: null,
  },
  visualization: { type: 'bar' as const, x: 'home_team', y: 'm', seriesBy: null },
});

const rowCount = async (port: DataPort): Promise<number> => {
  const res = await port.send({ type: 'view', viewState: useApp.getState().viewState }).done;
  if (res.type !== 'view:done') throw new Error('expected view:done');
  return res.rowCount;
};
