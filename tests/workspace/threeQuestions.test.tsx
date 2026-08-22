/** Three Questions in four seconds render exactly one chart.

    The staleness logic has its own test at the `Workspace` seam. This one asserts the thing a
    visitor would actually see: that after three overlapping submissions resolving out of order,
    the canvas holds one chart and it is the newest one's. Asserted through the chart's accessible
    data table, never through SVG geometry. */
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Attempt, Translator } from '../../src/ai/translator';
import { createLoader } from '../../src/data/loader';
import type { DatasetRef } from '../../src/engine/handle';
import type { ModelReply } from '../../src/spec/grammar';
import { useApp } from '../../src/store';
import { AnalysisCard } from '../../src/ui/AnalysisCard';
import { createLocalPort } from '../../src/worker/localPort';
import { createWorkspace } from '../../src/workspace/workspace';

/** `useChartDimensions` takes its width from a ResizeObserver and nowhere else, and jsdom has
    none. A stub reporting a fixed width is the whole plot area this test needs. */
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

const ref: DatasetRef = { kind: 'sample', id: 'matches' };
const CSV = [
  'date,home_team,home_score',
  '1872-11-30,Scotland,0',
  '1873-03-08,England,4',
  '1874-03-07,Scotland,2',
].join('\n');

const reply = (title: string): ModelReply => ({
  kind: 'analysis',
  intent: 'new',
  title,
  narration: `Counting matches for ${title}.`,
  operation: {
    filters: [],
    groupBy: ['home_team'],
    timeBucket: null,
    aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
    derived: [],
    sort: null,
    limit: null,
  },
  visualization: { type: 'bar', x: 'home_team', y: 'm', seriesBy: null },
});

const attempt = (r: ModelReply): Attempt => ({
  reply: r,
  failure: null,
  usage: {
    model: 'smart',
    recorded: false,
    inputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 5,
  },
  input: r,
  echo: null,
});

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

const INITIAL = useApp.getState();

describe('three Questions in four seconds', () => {
  beforeEach(() => useApp.setState(INITIAL, true));

  it('renders exactly one chart, and it is the last Question asked', async () => {
    const port = createLocalPort();
    const settle: ((a: Attempt) => void)[] = [];
    const translator: Translator = {
      translate: () => new Promise<Attempt>((r) => settle.push(r)),
    };
    const workspace = createWorkspace({ translator, port, loader: createLoader(port) });
    const parsed = await port.send({ type: 'parse', source: { text: CSV }, ref, label: 'm' }).done;
    if (parsed.type !== 'parse:done') throw new Error('fixture failed to parse');
    useApp.getState().setDataset(parsed.handle, null);

    render(<AnalysisCard />);

    await act(async () => {
      void workspace.ask('matches by team');
      void workspace.ask('no, matches per country');
      void workspace.ask('actually, matches by host');
      await flush();
    });

    await act(async () => {
      settle[1]!(attempt(reply('the middle one')));
      settle[2]!(attempt(reply('the last one')));
      settle[0]!(attempt(reply('the first one')));
      await flush();
    });

    expect(screen.getByRole('heading', { name: 'the last one' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'the first one' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'the middle one' })).toBeNull();

    // One chart, and its accessible data table holds the real counts — Scotland twice, England
    // once, computed by the application from the rows and not by anything the model said.
    const tables = screen.getAllByRole('table', { hidden: true });
    expect(tables).toHaveLength(1);
    const cells = [...tables[0]!.querySelectorAll('td, th')].map((c) => c.textContent);
    expect(cells).toContain('Scotland');
    expect(cells).toContain('2');
    expect(cells).toContain('England');
  });
});
