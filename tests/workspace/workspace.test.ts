/** The `Workspace` seam: the Request lifecycle, driven by a scripted Translator over a real
    kernel. No HTTP anywhere — the Translator is the seam, and this is what it is for.

    The staleness test is the single highest-value test in the project. Everything else here is
    the Repair, the notices and the usage accounting around it. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Attempt, TranslateRequest, Translator } from '../../src/ai/translator';
import { createLoader } from '../../src/data/loader';
import type { DatasetRef } from '../../src/engine/handle';
import type { ModelReply } from '../../src/spec/grammar';
import { useApp } from '../../src/store';
import type { DataPort } from '../../src/worker/port';
import { createLocalPort } from '../../src/worker/localPort';
import { createWorkspace } from '../../src/workspace/workspace';

const ref: DatasetRef = { kind: 'sample', id: 'matches' };
const CSV = [
  'date,home_team,home_score,neutral',
  '1872-11-30,Scotland,0,FALSE',
  '1873-03-08,England,4,FALSE',
  '1874-03-07,Scotland,2,TRUE',
  '1875-03-06,England,2,FALSE',
].join('\n');

/** A reply naming `column` as the thing to count matches by. `home_teem` is the typo that makes
    the semantic validator speak. */
const analysis = (title: string, column = 'home_team', intent: 'new' | 'refine' = 'new'): ModelReply => ({
  kind: 'analysis',
  intent,
  title,
  narration: `Counting matches by ${column}.`,
  operation: {
    filters: [],
    groupBy: [column],
    timeBucket: null,
    aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
    derived: [],
    sort: null,
    limit: null,
  },
  visualization: { type: 'bar', x: column, y: 'm', seriesBy: null },
});

const attempt = (reply: ModelReply | null, over: Partial<Attempt> = {}): Attempt => ({
  reply,
  failure: null,
  usage: {
    model: 'smart',
    recorded: false,
    inputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 50,
  },
  input: reply,
  echo: { id: 'toolu_1', name: 'submit_analysis', input: reply },
  ...over,
});

/** A Translator whose replies are handed out by the test, one at a time and in any order. */
function scripted() {
  const calls: { req: TranslateRequest; settle: (a: Attempt) => void }[] = [];
  const translator: Translator = {
    translate: (req) => new Promise<Attempt>((settle) => calls.push({ req, settle })),
  };
  return {
    translator,
    calls,
    /** Resolve the nth call and let every continuation it starts run to completion. */
    async resolve(n: number, a: Attempt) {
      calls[n]!.settle(a);
      await flush();
    },
  };
}

/** The Request lifecycle awaits the Translator, then the worker. Draining the microtask queue a
    few times is enough for both, since the local port resolves without a timer. */
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const frame = () => new Promise((r) => requestAnimationFrame(r));

const INITIAL = useApp.getState();

async function setup() {
  useApp.setState(INITIAL, true);
  const port = createLocalPort();
  const loader = createLoader(port);
  const script = scripted();
  const workspace = createWorkspace({ translator: script.translator, port, loader });
  const res = await port.send({ type: 'parse', source: { text: CSV }, ref, label: 'm.csv' }).done;
  if (res.type !== 'parse:done') throw new Error('fixture failed to parse');
  useApp.getState().setDataset(res.handle, null);
  return { workspace, script, port };
}

/** A port that holds its answer until the test lets it go, so a Request can be superseded while
    its worker job is still running — the case that separates a guard at every continuation from
    a guard at the model call alone. */
function gated(port: DataPort): { port: DataPort; release: () => Promise<void> } {
  const held: (() => void)[] = [];
  return {
    port: {
      ...port,
      send(req, onProgress) {
        const call = port.send(req, onProgress);
        return {
          jobId: call.jobId,
          done: new Promise((resolve) => held.push(() => void call.done.then(resolve))),
        };
      },
    },
    async release() {
      held.splice(0).forEach((r) => r());
      await flush();
    },
  };
}

const analyses = () => useApp.getState().analyses;
const titles = () => analyses().map((a) => a.title);

describe('the Request lifecycle', () => {
  beforeEach(() => useApp.setState(INITIAL, true));

  it('renders exactly one chart from three Questions that resolve out of order', async () => {
    const { workspace, script } = await setup();

    void workspace.ask('first');
    void workspace.ask('second');
    void workspace.ask('third');
    await flush();
    expect(script.calls).toHaveLength(3);

    // The newest resolves first, then the oldest, then the middle one — the order that breaks a
    // design guarding only the model call or only the worker.
    await script.resolve(2, attempt(analysis('third')));
    await script.resolve(0, attempt(analysis('first')));
    await script.resolve(1, attempt(analysis('second')));

    expect(titles()).toEqual(['third']);
    expect(analyses()[0]!.revisions).toHaveLength(1);
    expect(useApp.getState().request).toBeNull();
  });

  it('discards a result whose worker job outlived its Request', async () => {
    useApp.setState(INITIAL, true);
    const real = createLocalPort();
    const gate = gated(real);
    const script = scripted();
    const workspace = createWorkspace({
      translator: script.translator,
      port: gate.port,
      loader: createLoader(real),
    });
    const parsed = await real.send({ type: 'parse', source: { text: CSV }, ref, label: 'm.csv' })
      .done;
    if (parsed.type !== 'parse:done') throw new Error('fixture failed to parse');
    useApp.getState().setDataset(parsed.handle, null);

    // The first Request gets all the way past validation and into the worker.
    void workspace.ask('first');
    await flush();
    await script.resolve(0, attempt(analysis('first')));
    expect(analyses()).toHaveLength(0); // still inside the worker

    // A second Request supersedes it while that job is in flight. This is the case where a
    // design that only aborts the model call still paints the older chart.
    void workspace.ask('second');
    await flush();
    await gate.release();
    expect(analyses()).toHaveLength(0);

    await script.resolve(1, attempt(analysis('second')));
    await gate.release();
    expect(titles()).toEqual(['second']);
  });

  it('counts every Request that completed towards the session total, current or not', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('first');
    void workspace.ask('second');
    await flush();

    await script.resolve(1, attempt(analysis('second')));
    await script.resolve(0, attempt(analysis('first')));

    const usage = useApp.getState().usage;
    // Both were charged for. Only the one that landed is the figure shown as "last".
    expect(usage.requests).toBe(2);
    expect(usage.total.inputTokens).toBe(200);
    expect(usage.total.outputTokens).toBe(100);
    expect(usage.last?.inputTokens).toBe(100);
    expect(titles()).toEqual(['second']);
  });

  it('leaves no Analysis and shows the reply when the Question is ambiguous', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('which team');
    await flush();
    await script.resolve(0, {
      ...attempt(null),
      reply: { kind: 'clarification', question: 'Home or away?', options: ['home', 'away'] },
    });

    expect(analyses()).toHaveLength(0);
    expect(useApp.getState().pendingNotice).toEqual({
      kind: 'clarification',
      question: 'Home or away?',
      options: ['home', 'away'],
    });
    expect(useApp.getState().request).toBeNull();
  });

  it('names the boundary when the Question is outside the grammar', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('why did scoring drop');
    await flush();
    await script.resolve(0, {
      ...attempt(null),
      reply: {
        kind: 'unsupported',
        reason: 'The grammar cannot express a causal question.',
        suggestions: ['goals per year'],
      },
    });

    expect(analyses()).toHaveLength(0);
    expect(useApp.getState().pendingNotice).toMatchObject({ kind: 'unsupported' });
  });
});

describe('the single Repair', () => {
  beforeEach(() => useApp.setState(INITIAL, true));

  it('hands the violations back once and lands the corrected specification', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('matches by team');
    await flush();

    await script.resolve(0, attempt(analysis('Matches by team', 'home_teem')));
    expect(script.calls).toHaveLength(2);

    const repair = script.calls[1]!.req.repair!;
    expect('violations' in repair.problem && repair.problem.violations[0]!.code).toBe(
      'unknown-column',
    );
    expect('violations' in repair.problem && repair.problem.violations[0]!.message).toContain(
      'home_teem',
    );
    // The correction carries the columns that would have worked, not just the fact of failure.
    expect('violations' in repair.problem && repair.problem.violations[0]!.message).toContain(
      'home_team',
    );

    await script.resolve(1, attempt(analysis('Matches by team')));
    expect(titles()).toEqual(['Matches by team']);
  });

  it('stops at two attempts and leaves a recoverable notice, not a third try', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('matches by team');
    await flush();

    await script.resolve(0, attempt(analysis('one', 'home_teem')));
    await script.resolve(1, attempt(analysis('two', 'home_teem')));

    expect(script.calls).toHaveLength(2);
    expect(analyses()).toHaveLength(0);
    const notice = useApp.getState().pendingNotice!;
    expect(notice.kind).toBe('failed');
    expect(notice.kind === 'failed' && notice.violations[0]!.code).toBe('unknown-column');
  });

  it('spends the same single attempt on a reply that ran out of room', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('matches by team');
    await flush();

    await script.resolve(
      0,
      attempt(null, {
        failure: { kind: 'max-tokens', message: 'reached the 2048-token ceiling' },
        echo: null,
      }),
    );
    expect(script.calls).toHaveLength(2);
    expect(script.calls[1]!.req.repair!.problem).toEqual({
      message: 'reached the 2048-token ceiling',
    });

    await script.resolve(1, attempt(analysis('Matches by team')));
    expect(titles()).toEqual(['Matches by team']);
  });

  it('spends it on a structurally invalid reply too, and gives up after the second', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('matches by team');
    await flush();

    const broken = attempt(null, { failure: { kind: 'invalid', message: 'operation: required' } });
    await script.resolve(0, broken);
    await script.resolve(1, broken);

    expect(script.calls).toHaveLength(2);
    expect(useApp.getState().pendingNotice).toEqual({
      kind: 'failed',
      message: 'operation: required',
      violations: [],
    });
  });
});

describe('notices and navigation', () => {
  beforeEach(() => useApp.setState(INITIAL, true));

  it('clears the notice on the next submission and on dismissal', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('which team');
    await flush();
    await script.resolve(0, {
      ...attempt(null),
      reply: { kind: 'clarification', question: 'Home or away?', options: ['home', 'away'] },
    });
    expect(useApp.getState().pendingNotice).not.toBeNull();

    void workspace.ask('home');
    await flush();
    expect(useApp.getState().pendingNotice).toBeNull();

    await script.resolve(1, {
      ...attempt(null),
      reply: { kind: 'clarification', question: 'Again?', options: ['a', 'b'] },
    });
    useApp.getState().dismissNotice();
    expect(useApp.getState().pendingNotice).toBeNull();
  });

  it('survives a staleness early-return, because it does not live inside the Request', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('the one that will go stale');
    void workspace.ask('the one that answers');
    await flush();

    await script.resolve(1, {
      ...attempt(null),
      reply: { kind: 'clarification', question: 'Home or away?', options: ['home', 'away'] },
    });
    const notice = useApp.getState().pendingNotice;
    expect(notice).toMatchObject({ kind: 'clarification' });

    // The abandoned Request resolves afterwards and returns early. Were the notice held inside
    // the Request, that early return would blank the visitor's explanation mid-read.
    await script.resolve(0, attempt(analysis('abandoned')));
    expect(useApp.getState().pendingNotice).toEqual(notice);
    expect(titles()).toEqual([]);
  });

  it('cancels on request without leaving a notice behind', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('slow one');
    await flush();
    workspace.cancel();
    await script.resolve(0, attempt(analysis('too late')));

    expect(useApp.getState().request).toBeNull();
    expect(useApp.getState().pendingNotice).toBeNull();
    expect(analyses()).toHaveLength(0);
  });

  it('appends a Revision when the model refines, and starts an Analysis when it does not', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('matches by team');
    await flush();
    await script.resolve(0, attempt(analysis('Matches by team')));
    expect(useApp.getState().activeAnalysisId).toBe('a1');

    void workspace.ask('same but by neutral');
    await flush();
    await script.resolve(1, attempt(analysis('Matches by team', 'neutral', 'refine')));
    expect(analyses()).toHaveLength(1);
    expect(analyses()[0]!.revisions).toHaveLength(2);

    void workspace.ask('a different topic');
    await flush();
    await script.resolve(2, attempt(analysis('Matches by neutral ground', 'neutral', 'new')));
    expect(titles()).toEqual(['Matches by team', 'Matches by neutral ground']);
  });

  it('carries the previous specification on a refine and never the whole history', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('matches by team');
    await flush();
    await script.resolve(0, attempt(analysis('Matches by team')));

    void workspace.ask('make it neutral');
    await flush();
    const refine = script.calls[1]!.req.refine!;
    expect(refine.spec.title).toBe('Matches by team');
    expect(refine.history.map((e) => e.question)).toEqual(['matches by team']);
  });
});

describe('the narration', () => {
  beforeEach(() => useApp.setState(INITIAL, true));

  it('reaches the store in whole frames rather than per delta', async () => {
    useApp.setState(INITIAL, true);
    const port = createLocalPort();
    const loader = createLoader(port);
    let deltas: ((s: string) => void) | null = null;
    const translator: Translator = {
      translate: (_req, events) =>
        new Promise<Attempt>(() => {
          deltas = events!.onNarration!;
        }),
    };
    const workspace = createWorkspace({ translator, port, loader });
    const res = await port.send({ type: 'parse', source: { text: CSV }, ref, label: 'm.csv' }).done;
    if (res.type !== 'parse:done') throw new Error('fixture failed to parse');
    useApp.getState().setDataset(res.handle, null);

    void workspace.ask('why');
    await flush();
    deltas!('Counting ');
    deltas!('matches ');
    deltas!('by team.');
    // Nothing has been written yet: three deltas, one pending frame.
    expect(useApp.getState().request!.narration).toBe('');
    await frame();
    expect(useApp.getState().request!.narration).toBe('Counting matches by team.');
  });
});
