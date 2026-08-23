/** Demo mode: the Fixture Translator behind the same seam.

    What these assert is that nothing but the transport changed. The reply below goes through the
    same structural parse, the same semantic validator, the same worker and the same Revision that
    a live reply does — so the tests are written against the `Workspace`'s output, not against the
    replay, except where the replay itself is the subject. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createFixtureTranslator } from '../../src/ai/fixtureTranslator';
import type { Fixture } from '../../src/ai/fixtures';
import { Cancelled } from '../../src/ai/translator';
import { useApp } from '../../src/store';
import { analyses, reset, setup, titles } from './harness';

/** Recorded against the four-row Dataset the harness parses. */
const HOSTS: Fixture = {
  dataset: 'matches',
  question: 'Which teams have hosted the most matches?',
  narration: 'Counting matches for each home team, most first.',
  input: {
    kind: 'analysis',
    intent: 'new',
    title: 'Matches hosted by team',
    narration: 'Counting matches for each home team, most first.',
    operation: {
      filters: [],
      groupBy: ['home_team'],
      timeBucket: null,
      aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
      derived: [],
      sort: { by: 'm', dir: 'desc' },
      limit: null,
    },
    visualization: { type: 'bar', x: 'home_team', y: 'm', seriesBy: null },
  },
  usage: { inputTokens: 168, cacheReadTokens: 1_412, cacheWriteTokens: 0, outputTokens: 243 },
};

const FIXTURES = [HOSTS];

/** `pace: 0` collapses the recorded gaps. Only the cancellation test wants them back. */
const instant = () => createFixtureTranslator({ pace: 0, fixtures: FIXTURES });

const request = {
  question: HOSTS.question,
  schema: { columns: useApp.getState().columns },
  model: 'smart' as const,
};

describe('the replay', () => {
  it('streams the sentence as several deltas rather than one', async () => {
    const deltas: string[] = [];
    await instant().translate(request, { onNarration: (d) => deltas.push(d) });
    expect(deltas.length).toBeGreaterThan(3);
    expect(deltas.join('')).toBe(HOSTS.narration);
  });

  it('fills the chip strip in as the tool JSON arrives', async () => {
    const strips: string[][] = [];
    await instant().translate(request, { onChips: (c) => strips.push(c) });
    expect(strips.at(-1)).toEqual(['home_team', 'count', 'bar']);
    // Filled in, not published whole: the dimension is on screen before the chart type is.
    expect(strips.length).toBeGreaterThan(1);
  });

  it('reports the recorded counts and says nothing was charged', async () => {
    const attempt = await instant().translate(request);
    expect(attempt.usage).toMatchObject({ ...HOSTS.usage, recorded: true });
  });

  it('refuses a Question the recording does not cover, naming what is available', async () => {
    await expect(instant().translate({ ...request, question: 'what is the airspeed of a swallow' }))
      .rejects.toThrow(/Demo mode/);
  });

  it('cancels between two deltas rather than after the recording has played out', async () => {
    const controller = new AbortController();
    const pending = createFixtureTranslator({ fixtures: FIXTURES }).translate(
      request,
      undefined,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(Cancelled);
  });
});

describe('a Question answered from a Fixture', () => {
  beforeEach(reset);

  it('runs the whole lifecycle and appends a Revision like any other', async () => {
    const { workspace } = await setup({ translator: instant() });
    await workspace.ask(HOSTS.question);
    expect(titles()).toEqual(['Matches hosted by team']);
    // Executed by the real worker over the real Dataset: two home teams, two matches each.
    expect(analyses()[0]!.revisions[0]!.result.rows).toHaveLength(2);
  });

  it('counts towards the readout as recorded, so it neither vanishes nor implies a charge', async () => {
    const { workspace } = await setup({ translator: instant() });
    await workspace.ask(HOSTS.question);
    const usage = useApp.getState().usage;
    expect(usage.last?.recorded).toBe(true);
    expect(usage.total.cacheReadTokens).toBe(1_412);
  });

  it('leaves a notice and no Analysis when the Question is outside the repertoire', async () => {
    const { workspace } = await setup({ translator: instant() });
    await workspace.ask('why did scoring decline');
    expect(analyses()).toEqual([]);
    expect(useApp.getState().pendingNotice).toMatchObject({ kind: 'failed' });
  });

  it('leaves nothing behind when the visitor cancels mid-replay', async () => {
    const { workspace } = await setup({
      translator: createFixtureTranslator({ fixtures: FIXTURES }),
    });
    const pending = workspace.ask(HOSTS.question);
    workspace.cancel();
    await pending;
    expect(analyses()).toEqual([]);
    expect(useApp.getState().request).toBeNull();
    expect(useApp.getState().pendingNotice).toBeNull();
  });
});
