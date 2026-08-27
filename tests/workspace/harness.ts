/** The shared `Workspace` seam harness: a scripted Translator over a real kernel.

    The Translator is the seam, so there is no HTTP here and no fake worker — the kernel that runs
    in these tests is the one that runs in the browser, reached through the in-process port. What
    the tests control is which reply arrives and when. */
import type { Attempt, TranslateRequest, Translator } from '../../src/ai/translator';
import { createLoader } from '../../src/data/loader';
import type { DatasetRef } from '../../src/engine/handle';
import type { ModelReply } from '../../src/spec/grammar';
import { useApp } from '../../src/store';
import type { DataPort } from '../../src/worker/port';
import { createLocalPort } from '../../src/worker/localPort';
import { createWorkspace } from '../../src/workspace/workspace';

export const ref: DatasetRef = { kind: 'sample', id: 'matches' };

export const CSV = [
  'date,home_team,home_score,neutral',
  '1872-11-30,Scotland,0,FALSE',
  '1873-03-08,England,4,FALSE',
  '1874-03-07,Scotland,2,TRUE',
  '1875-03-06,England,2,FALSE',
].join('\n');

/** A reply counting matches by `column`. `home_teem` is the typo that makes the semantic
    validator speak. */
export const analysis = (
  title: string,
  column = 'home_team',
  intent: 'new' | 'refine' = 'new',
): ModelReply => ({
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

export const attempt = (reply: ModelReply | null, over: Partial<Attempt> = {}): Attempt => ({
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

/** The Request lifecycle awaits the Translator, then the worker. Draining the microtask queue a
    few times is enough for both, since the local port resolves without a timer. */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

export const frame = (): Promise<unknown> => new Promise((r) => requestAnimationFrame(r));

/** A Translator whose replies are handed out by the test, one at a time and in any order. */
export function scripted() {
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

/** A port that holds its answer until the test lets it go, so a Request can be superseded while
    its worker job is still running — the case that separates a guard at every continuation from
    a guard at the model call alone. */
export function gated(port: DataPort): { port: DataPort; release: () => Promise<void> } {
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

/** The store is a module singleton, so every test starts by putting it back as it was found. */
export const INITIAL = useApp.getState();
export const reset = (): void => useApp.setState(INITIAL, true);

/** `translator` swaps in a different implementation of the one seam — the Fixture Translator in
    the Demo-mode tests. Everything downstream of it is the same code either way, which is the
    property those tests exist to hold. */
export async function setup({
  translator,
  propose,
}: { translator?: Translator; propose?: () => Promise<string[]> } = {}) {
  reset();
  const port = createLocalPort();
  const loader = createLoader(port);
  const script = scripted();
  const workspace = createWorkspace({
    translator: translator ?? script.translator,
    port,
    loader,
    propose,
  });
  const res = await port.send({ type: 'parse', source: { text: CSV }, ref, label: 'm.csv' }).done;
  if (res.type !== 'parse:done') throw new Error('fixture failed to parse');
  useApp.getState().setDataset(res.handle, null);
  return { workspace, script, port };
}

export const analyses = () => useApp.getState().analyses;
export const titles = () => analyses().map((a) => a.title);
export const byId = (id: string) => analyses().find((a) => a.id === id);
