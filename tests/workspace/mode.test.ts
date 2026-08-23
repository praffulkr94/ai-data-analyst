/** Switching between Demo and BYOK.

    Mode picks a Translator and does nothing else, so the Dataset, the Analyses and the Revisions
    survive a switch untouched. That is a property of the seam rather than of any code written to
    preserve them — which is exactly why it is worth a test: the day someone adds a reset to the
    mode setter, this is what says so. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createFixtureTranslator } from '../../src/ai/fixtureTranslator';
import type { Fixture } from '../../src/ai/fixtures';
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
  beforeEach(reset);

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

  it('carries the Dataset, the Analyses and their Revisions across a switch in both directions', async () => {
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
});
