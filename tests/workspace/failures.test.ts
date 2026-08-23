/** The failure taxonomy at the seam (DECISIONS §18).

    The rows already covered elsewhere are not repeated here: the Repair and the stale response
    are in `workspace.test.ts`, the degenerate results are in `tests/engine/degeneracy.test.ts`.
    What is here is the two the milestone added — a failure worth waiting out, and a worker that
    stops answering. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Retryable, type Attempt, type Translator } from '../../src/ai/translator';
import { createLoader } from '../../src/data/loader';
import { useApp } from '../../src/store';
import { createLocalPort } from '../../src/worker/localPort';
import type { DataPort } from '../../src/worker/port';
import { createWorkspace, MAX_RETRIES } from '../../src/workspace/workspace';
import { analyses, analysis, attempt, CSV, ref, reset, titles } from './harness';

/** Throws a Retryable for the first `failures` calls, then answers. The wait it asks for is one
    millisecond, so the test measures the behaviour rather than the clock. */
function flaky(failures: number, reply: Attempt) {
  let calls = 0;
  const translator: Translator = {
    translate: async () => {
      if (calls++ < failures) throw new Retryable('The API rate-limited this request.', 1);
      return reply;
    },
  };
  return { translator, calls: () => calls };
}

async function build(translator: Translator, wrap: (p: DataPort) => DataPort = (p) => p) {
  reset();
  const port = createLocalPort();
  const loader = createLoader(port);
  const res = await port.send({ type: 'parse', source: { text: CSV }, ref, label: 'm.csv' }).done;
  if (res.type !== 'parse:done') throw new Error('fixture failed to parse');
  useApp.getState().setDataset(res.handle, null);
  return createWorkspace({ translator, port: wrap(port), loader });
}

describe('a failure worth waiting out', () => {
  beforeEach(reset);

  it('waits and asks again without spending the single Repair', async () => {
    const flake = flaky(1, attempt(analysis('Matches by team')));
    const workspace = await build(flake.translator);
    await workspace.ask('how many matches per team?');
    expect(flake.calls()).toBe(2);
    expect(titles()).toEqual(['Matches by team']);
    expect(useApp.getState().pendingNotice).toBeNull();
  });

  it('tells the visitor what it is waiting for, and when it will stop', async () => {
    const workspace = await build(flaky(1, attempt(analysis('Matches by team'))).translator);
    const waits: { waiting: string | null; retryAt: number | null }[] = [];
    const unsubscribe = useApp.subscribe((s) => {
      if (s.request?.status === 'waiting') {
        waits.push({ waiting: s.request.waiting, retryAt: s.request.retryAt });
      }
    });
    const before = Date.now();
    await workspace.ask('how many matches per team?');
    unsubscribe();

    expect(waits).toHaveLength(1);
    expect(waits[0]!.waiting).toBe('The API rate-limited this request.');
    // A deadline the countdown can be driven from, not merely a spinner.
    expect(waits[0]!.retryAt).toBeGreaterThanOrEqual(before);
  });

  it('gives up after a bounded number of waits rather than retrying forever', async () => {
    const flake = flaky(99, attempt(null));
    const workspace = await build(flake.translator);
    await workspace.ask('how many matches per team?');
    expect(flake.calls()).toBe(MAX_RETRIES + 1);
    expect(analyses()).toEqual([]);
    expect(useApp.getState().pendingNotice).toMatchObject({
      kind: 'failed',
      message: 'The API rate-limited this request.',
    });
  });

  it('stops waiting the moment the visitor cancels', async () => {
    const workspace = await build({
      translate: async () => {
        throw new Retryable('The API is overloaded — it answered 529.', 10_000);
      },
    });
    const pending = workspace.ask('how many matches per team?');
    await vi.waitFor(() => expect(useApp.getState().request?.status).toBe('waiting'));
    workspace.cancel();
    await pending;
    expect(useApp.getState().request).toBeNull();
    expect(useApp.getState().pendingNotice).toBeNull();
  });
});

describe('a worker that stops answering', () => {
  beforeEach(reset);

  /** What the real transport does on a crash: it fails the jobs in flight and respawns. */
  const crashing = (port: DataPort): DataPort => ({
    ...port,
    send: (req, onProgress) =>
      req.type === 'analyze'
        ? { jobId: -1, done: Promise.reject(new Error('The worker stopped.')) }
        : port.send(req, onProgress),
  });

  it('fails the one Analysis and says the worker was restarted, rather than throwing', async () => {
    const workspace = await build(
      { translate: async () => attempt(analysis('Matches by team')) },
      crashing,
    );
    await expect(workspace.ask('how many matches per team?')).resolves.toBeUndefined();
    expect(analyses()).toEqual([]);
    expect(useApp.getState().pendingNotice).toMatchObject({ kind: 'failed' });
    expect((useApp.getState().pendingNotice as { message: string }).message).toMatch(
      /worker has been restarted/,
    );
  });
});
