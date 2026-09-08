/** Switching between Demo and BYOK.

    Two different things share the word "switch" and this file holds both apart.

    `useApp.setMode` is the raw setter. It picks a Translator and does nothing else, so the
    Dataset, the Analyses and the Revisions survive it untouched — a property of the seam rather
    than of any code written to preserve them. That is the path a restored link takes: the hash
    already describes an Analysis, and the key arriving late completes it.

    `workspace.setMode` is a visitor at the header toggle. That one is a full reset — Dataset and
    thread both — because what changes with the mode is not only who answers but what an answer
    is (DECISIONS §A1), and a picker standing over a Dataset whose thread has just been thrown
    away is a panel you back out of rather than a home screen. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createFixtureTranslator } from '../../src/ai/fixtureTranslator';
import type { Fixture } from '../../src/ai/fixtures';
import { parseHash } from '../../src/route';
import { switching, type Translator } from '../../src/ai/translator';
import { useApp } from '../../src/store';
import { analyses, analysis, attempt, reset, scripted, setup, titles } from './harness';

const RECORDED: Fixture = {
  dataset: 'matches',
  question: 'Which teams have hosted the most matches?',
  narration: 'Counting matches by home_team.',
  input: analysis('Matches hosted by team'),
  usage: { inputTokens: 168, cacheReadTokens: 1_412, cacheWriteTokens: 0, outputTokens: 243 },
};

describe('the mode toggle', () => {
  beforeEach(() => {
    reset();
    // jsdom carries `location` between tests, and `workspace.setMode` navigates.
    history.replaceState(null, '', '#/');
  });

  /** Both implementations behind one seam, chosen per Request exactly as `main.tsx` chooses. */
  async function bothModes(): Promise<{
    workspace: Awaited<ReturnType<typeof setup>>['workspace'];
    live: ReturnType<typeof scripted>;
  }> {
    const live = scripted();
    const demo = createFixtureTranslator({ pace: 0, fixtures: [RECORDED] });
    const translator: Translator = switching(() =>
      useApp.getState().mode === 'byok' ? live.translator : demo,
    );
    const { workspace } = await setup({ translator });
    return { workspace, live };
  }

  it('carries the Dataset, the Analyses and their Revisions across the raw setter, both directions', async () => {
    const { workspace, live } = await bothModes();
    await workspace.ask(RECORDED.question);
    const handle = useApp.getState().datasetHandle;

    useApp.getState().setMode('byok');
    const asking = workspace.ask('and by away team?');
    await Promise.resolve();
    await live.resolve(0, attempt(analysis('Matches by away team', 'home_team', 'refine')));
    await asking;

    useApp.getState().setMode('demo');
    expect(useApp.getState().datasetHandle).toBe(handle);
    expect(titles()).toEqual(['Matches by away team']);
    expect(analyses()[0]!.revisions).toHaveLength(2);
  });

  /** A session that mixes modes must not bill the recorded half — and must not zero the keyed
      half either, which a single "is this Demo mode" flag over the whole readout would do. */
  it('charges for the keyed Request and not for the recorded one', async () => {
    const { workspace, live } = await bothModes();
    await workspace.ask(RECORDED.question);
    expect(useApp.getState().usage.cost).toBe(0);

    useApp.getState().setMode('byok');
    const asking = workspace.ask('and by away team?');
    await Promise.resolve();
    await live.resolve(0, attempt(analysis('Matches by away team')));
    await asking;

    expect(useApp.getState().usage.requests).toBe(2);
    expect(useApp.getState().usage.cost).toBeGreaterThan(0);
  });

  it('sends the Question to the Translator the mode names, not the one it was built with', async () => {
    const { workspace, live } = await bothModes();
    await workspace.ask(RECORDED.question);
    expect(live.calls).toHaveLength(0);

    useApp.getState().setMode('byok');
    void workspace.ask('anything at all');
    await Promise.resolve();
    expect(live.calls).toHaveLength(1);
  });

  /** The visitor's switch, which is the raw setter's opposite in every respect. */
  it('resets to the picker — Dataset and thread both — and keeps the session totals', async () => {
    const { workspace } = await bothModes();
    await workspace.ask(RECORDED.question);
    useApp.setState({ draft: 'half a question', suggestions: { for: 'x', questions: ['q'] } });
    const spent = useApp.getState().usage.requests;
    expect(spent).toBeGreaterThan(0);

    workspace.setMode('byok');

    const state = useApp.getState();
    expect(state.mode).toBe('byok');
    expect(state.datasetHandle).toBeNull();
    expect(state.columns).toEqual([]);
    expect(state.load).toEqual({ status: 'idle' });
    expect(analyses()).toEqual([]);
    expect(state.activeAnalysisId).toBeNull();
    expect(state.draft).toBe('');
    expect(state.suggestions).toBeNull();
    // Charged for whatever is on screen now.
    expect(state.usage.requests).toBe(spent);
    expect(parseHash().route).toBe('home');
  });

  /** Re-pressing the half that is already pressed is not a switch, and must not cost the thread
      the visitor is looking at. */
  it('does nothing when the mode is already the one asked for', async () => {
    const { workspace } = await bothModes();
    await workspace.ask(RECORDED.question);

    workspace.setMode('demo');

    expect(titles()).toEqual(['Matches hosted by team']);
    expect(parseHash().route).toBe('home');
  });
});
