/** The starter Questions, and what the composer does with one.

    The behaviour under test is the loop: a Question is chosen from the list, it lands in the
    composer, and the visitor sends it. Clicking used to dispatch straight to the Translator,
    which produced a chart without ever showing where a Question goes.

    Rendered through `TipProvider` because Radix's tooltip Root requires a provider ancestor —
    the real one is in `App`, and a test that renders the composer on its own supplies it. */
import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_REPERTOIRE } from '../../src/ai/fixtures';
import { useApp } from '../../src/store';
import { Composer } from '../../src/ui/Composer';
import { EmptyState } from '../../src/ui/EmptyState';
import { TipProvider } from '../../src/ui/Tip';
import type { Workspace } from '../../src/workspace/workspace';
import { flush, setup } from './harness';

const screenful = (workspace: Workspace) =>
  render(
    <TipProvider>
      <EmptyState workspace={workspace} />
      <Composer workspace={workspace} />
    </TipProvider>,
  );

const composer = () => screen.getByLabelText('Question') as HTMLInputElement;

afterEach(cleanup);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('a starter Question fills the composer', () => {
  it('lands in the input rather than being asked, and sends when the visitor sends it', async () => {
    const { workspace, script } = await setup();
    const question = DEMO_REPERTOIRE[0]!.question;
    screenful(workspace);

    await act(async () => {
      screen.getByText(question).closest('button')!.click();
      await flush();
    });

    // Nothing was asked. The Question is in the composer, waiting for the visitor.
    expect(script.calls).toHaveLength(0);
    expect(composer().value).toBe(question);

    await act(async () => {
      screen.getByRole('button', { name: 'Ask' }).click();
      await flush();
    });

    expect(script.calls).toHaveLength(1);
    expect(script.calls[0]!.req.question).toBe(question);
    // Sent means gone: the box is empty and the Question is in flight.
    expect(composer().value).toBe('');
  });

  /** `readOnly`, not `disabled`, is what lets a chosen Question land in a box free text cannot
      reach — so the box has to stay closed to typing. */
  it('is the only thing that can get into the composer in Demo mode', async () => {
    const { workspace } = await setup();
    screenful(workspace);
    expect(composer().readOnly).toBe(true);
    expect(composer().disabled).toBe(false);
  });

  it('is inert while the model picker is, and says why', async () => {
    const { workspace } = await setup();
    screenful(workspace);
    const fast = screen.getByRole('button', { name: 'Fast' });
    expect(fast.getAttribute('aria-disabled')).toBe('true');

    await act(async () => {
      fast.click();
      await flush();
    });
    expect(useApp.getState().model).toBe('smart');
  });
});

describe('the three sample Questions', () => {
  const THREE = [
    'Which tournament has the most matches?',
    'How many matches were played each year?',
    'What is the average home score by country?',
  ];

  it('are proposed once per Dataset and fill the composer the same way', async () => {
    let calls = 0;
    const { workspace } = await setup({
      propose: async () => {
        calls++;
        return THREE;
      },
    });
    act(() => useApp.getState().setMode('byok'));

    const view = screenful(workspace);
    await act(async () => {
      await flush();
    });

    for (const q of THREE) expect(screen.getByText(q)).toBeTruthy();

    await act(async () => {
      screen.getByText(THREE[1]!).closest('button')!.click();
      await flush();
    });
    expect(composer().value).toBe(THREE[1]);

    // The empty state unmounts the moment an Analysis lands and comes back when the last one is
    // deleted. That must not be a second call on the visitor's key.
    view.unmount();
    screenful(workspace);
    await act(async () => {
      await flush();
    });
    expect(calls).toBe(1);
  });

  /** A failed or empty proposal is remembered as one, so the fallback prose is what stands and
      the call is not retried on every remount. */
  it('fall back to the grammar when nothing usable comes back', async () => {
    let calls = 0;
    const { workspace } = await setup({
      propose: async () => {
        calls++;
        return [];
      },
    });
    act(() => useApp.getState().setMode('byok'));

    screenful(workspace);
    await act(async () => {
      await flush();
    });

    expect(screen.getByText('Ask anything this grammar can express')).toBeTruthy();
    expect(calls).toBe(1);
  });
});
