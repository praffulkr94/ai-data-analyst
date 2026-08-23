/** The Revision stepper, undo, and the manual controls, through the rendered card.

    The card is asserted through its text and its accessible names — never through SVG geometry —
    and the chart inside it is real, which is why the ResizeObserver stub is here: the chart takes
    its width from an observer and nowhere else, and jsdom has none. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnalysisCard } from '../../src/ui/AnalysisCard';
import { useApp } from '../../src/store';
import type { ModelReply } from '../../src/spec/grammar';
import { attempt, flush, reset, setup } from './harness';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() {
      this.cb(
        [{ contentRect: { width: 900, height: 320 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => document.body.replaceChildren());

/** Counting by year: the temporal x-axis that makes line and area legal chart types, so the
    toggle has something to offer. */
const byYear = (title: string, intent: 'new' | 'refine'): ModelReply => ({
  kind: 'analysis',
  intent,
  title,
  narration: `${title}.`,
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
});

async function twoRevisions() {
  const s = await setup();
  await act(async () => {
    void s.workspace.ask('matches by year');
    await flush();
  });
  await act(() => s.script.resolve(0, attempt(byYear('Matches by year', 'new'))));
  await act(async () => {
    void s.workspace.ask('and again');
    await flush();
  });
  await act(() => s.script.resolve(1, attempt(byYear('Matches by year', 'refine'))));
  return s;
}

describe('the Revision stepper', () => {
  beforeEach(reset);

  it('opens on the newest Revision and steps back and forward', async () => {
    const s = await twoRevisions();
    render(<AnalysisCard workspace={s.workspace} />);
    expect(screen.getByText('2/2')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Previous revision'));
    expect(screen.getByText('1/2')).toBeTruthy();
    // There is nothing before the first, so the control that would go there is not offered.
    expect(screen.getByLabelText<HTMLButtonElement>('Previous revision').disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Next revision'));
    expect(screen.getByText('2/2')).toBeTruthy();
  });

  it('undoes with Cmd+Z and redoes with Shift+Cmd+Z', async () => {
    const s = await twoRevisions();
    render(<AnalysisCard workspace={s.workspace} />);

    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(screen.getByText('1/2')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    expect(screen.getByText('2/2')).toBeTruthy();
  });

  it('leaves undo inside a text field to the browser', async () => {
    const s = await twoRevisions();
    render(<AnalysisCard workspace={s.workspace} />);
    const input = document.createElement('input');
    document.body.append(input);

    fireEvent.keyDown(input, { key: 'z', metaKey: true });
    expect(screen.getByText('2/2')).toBeTruthy();
  });
});

describe('the manual controls', () => {
  beforeEach(reset);

  it('offers the legal chart types and appends a Revision when one is chosen', async () => {
    const s = await twoRevisions();
    render(<AnalysisCard workspace={s.workspace} />);
    const toggle = screen.getByRole('group', { name: 'Chart type' });
    // A temporal x-axis admits all three; scatter waits for `<Points>` in M8.
    expect([...toggle.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'bar',
      'line',
      'area',
    ]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'line' }));
      await flush();
    });

    expect(screen.getByText('3/3')).toBeTruthy();
    expect(useApp.getState().analyses[0]!.revisions[2]!.spec.visualization.type).toBe('line');
    // And the model was asked nothing.
    expect(s.script.calls).toHaveLength(2);
  });

  it('hides both controls when neither has a second option to offer', async () => {
    const s = await setup();
    await act(async () => {
      void s.workspace.ask('matches by team');
      await flush();
    });
    // Counting by a categorical column: a line has no order to join, and every function but
    // `count` needs a column that `count` does not carry.
    await act(() =>
      s.script.resolve(0, attempt({ ...byYear('Matches by team', 'new'),
        operation: {
          filters: [], groupBy: ['home_team'], timeBucket: null,
          aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
          derived: [], sort: null, limit: null,
        },
        visualization: { type: 'bar', x: 'home_team', y: 'm', seriesBy: null },
      } as ModelReply)),
    );
    render(<AnalysisCard workspace={s.workspace} />);

    expect(screen.queryByRole('group', { name: 'Chart type' })).toBeNull();
    expect(screen.queryByLabelText('Aggregation')).toBeNull();
  });
});
