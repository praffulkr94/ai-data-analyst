/** The chart layer, exercised through the real `DataEngine` and the real marks.

    Charts are asserted through their accessible data table and through the text on the page —
    never through SVG coordinates. Where a rule can only be observed in the path (a line that
    breaks at a gap rather than interpolating across it) the assertion is about the number of
    subpaths and never about where they are. */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AnalysisChart } from '../../src/chart/AnalysisChart';
import { buildColumnStore } from '../../src/engine/columnStore';
import { inferSchema } from '../../src/engine/infer';
import { executeOperation } from '../../src/engine/operation';
import type { AnalysisResult } from '../../src/engine/result';
import type { Operation, Visualization } from '../../src/spec/grammar';

/** jsdom has no ResizeObserver, and `useChartDimensions` takes its width from one and nowhere
    else. A stub reporting a fixed width is the entire plot area these tests need. */
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

const op = (over: Partial<Operation> = {}): Operation => ({
  filters: [],
  groupBy: [],
  timeBucket: null,
  aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
  derived: [],
  sort: null,
  limit: null,
  ...over,
});

type Viz = { type: 'bar' | 'line' | 'area'; x: string; y: string; seriesBy: string | null };
const viz = (over: Partial<Viz> = {}): Visualization => ({
  type: 'line',
  x: 'date',
  y: 'm',
  seriesBy: null,
  ...over,
});

/** `date,team,goals` over the given rows, with `goals` stated numeric — a small fixture falls
    under the 95% numeric threshold and would infer categorical. */
const HEADER = ['date', 'team', 'goals'];
const run = (rows: string[][], operation: Operation): AnalysisResult => {
  const schema = inferSchema(HEADER, rows);
  const store = buildColumnStore(HEADER, rows, {
    columns: schema.columns.map((c) => (c.name === 'goals' ? { ...c, type: 'number' } : c)),
  });
  return executeOperation(store, operation, { metric: 'm' });
};

const YEARLY = (years: number[], team = 'Brazil') =>
  years.map((y) => [`${y}-06-15`, team, '2']);

const paths = () => [...document.querySelectorAll('svg path')];
/** `M` opens a subpath, so counting them counts the runs a line was drawn in. */
const subpaths = (d: string) => d.split('M').length - 1;

describe('the line mark', () => {
  const result = run(
    YEARLY([2020, 2021, 2022, 2023]),
    op({ timeBucket: { column: 'date', unit: 'year' }, sort: { by: 'date', dir: 'asc' } }),
  );

  it('draws one line, and the numbers behind it are in the data table', () => {
    render(<AnalysisChart result={result} visualization={viz()} />);
    expect(paths()).toHaveLength(1);

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getByRole('rowheader').textContent).toBe('2020-01-01');
    expect(rows.map((r) => within(r).getByRole('cell').textContent)).toEqual(['1', '1', '1', '1']);
  });

  it('labels the temporal axis at the bucket’s own resolution', () => {
    render(<AnalysisChart result={result} visualization={viz()} />);
    const svg = document.querySelector('svg')!;
    expect(svg.textContent).toContain('2020');
    expect(svg.textContent).not.toContain('2020-01-01');
  });

  it('breaks the line at a gap instead of interpolating across it', () => {
    // `goals` is null in 2021, so a sum over it has no value that year.
    const withGap = run(
      [
        ['2020-06-15', 'Brazil', '3'],
        ['2021-06-15', 'Brazil', 'NA'],
        ['2022-06-15', 'Brazil', '1'],
      ],
      op({
        timeBucket: { column: 'date', unit: 'year' },
        aggregations: [{ id: 'm', fn: 'sum', column: 'goals', label: 'goals' }],
        sort: { by: 'date', dir: 'asc' },
      }),
    );
    render(<AnalysisChart result={withGap} visualization={viz()} />);
    expect(subpaths(paths()[0]!.getAttribute('d')!)).toBe(2);
  });

  it('draws a point that has no neighbour, so a single value is not an empty chart', () => {
    const one = run(
      YEARLY([2020]),
      op({ timeBucket: { column: 'date', unit: 'year' } }),
    );
    render(<AnalysisChart result={one} visualization={viz()} />);
    expect(document.querySelectorAll('svg circle')).toHaveLength(1);
  });

  it('draws the points in x order whatever order the result arrived in', () => {
    // Sorted by the metric descending, which is what a spec with no sort asks for.
    const unsorted = run(
      [...YEARLY([2020]), ...YEARLY([2021]), ...YEARLY([2021]), ...YEARLY([2022])],
      op({ timeBucket: { column: 'date', unit: 'year' } }),
    );
    expect(unsorted.rows.map((r) => r.m)).toEqual([2, 1, 1]);
    render(<AnalysisChart result={unsorted} visualization={viz()} />);
    // One unbroken run: drawn in metric order the line would still be one path, but the x
    // coordinates would go backwards. They are read off the path in order here.
    const xs = [...paths()[0]!.getAttribute('d')!.matchAll(/[ML]([\d.]+),/g)].map((m) =>
      Number(m[1]),
    );
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });
});

describe('several Series', () => {
  const result = run(
    [
      ...YEARLY([2020, 2021], 'Brazil'),
      ...YEARLY([2020, 2021], 'Peru'),
      ...YEARLY([2021], 'Peru'),
    ],
    op({
      timeBucket: { column: 'date', unit: 'year' },
      groupBy: ['team'],
      sort: { by: 'date', dir: 'asc' },
    }),
  );

  it('draws one line per Series and names each on the line itself', () => {
    render(<AnalysisChart result={result} visualization={viz({ seriesBy: 'team' })} />);
    expect(paths()).toHaveLength(2);
    const svg = document.querySelector('svg')!;
    expect(svg.textContent).toContain('Brazil');
    expect(svg.textContent).toContain('Peru');
  });

  it('gives each Series its own palette slot, and never the same one twice', () => {
    render(<AnalysisChart result={result} visualization={viz({ seriesBy: 'team' })} />);
    const strokes = paths().map((p) => p.getAttribute('stroke'));
    expect(new Set(strokes).size).toBe(2);
  });

  it('names the Series in words on a bar chart, where colour is all a bar has', () => {
    render(
      <AnalysisChart
        result={result}
        visualization={{ type: 'bar', x: 'date', y: 'm', seriesBy: 'team' }}
      />,
    );
    const legend = screen.getByRole('list');
    expect(within(legend).getByText('Brazil')).toBeTruthy();
    expect(within(legend).getByText('Peru')).toBeTruthy();
    // Grouped, not overdrawn: two Series share each band, so every bar is its own rect.
    expect(document.querySelectorAll('svg rect')).toHaveLength(4);
  });
});

describe('the area mark', () => {
  it('is the fill and the line composed, not a third kind of mark', () => {
    const result = run(
      YEARLY([2020, 2021, 2022]),
      op({ timeBucket: { column: 'date', unit: 'year' }, sort: { by: 'date', dir: 'asc' } }),
    );
    render(<AnalysisChart result={result} visualization={{ ...viz(), type: 'area' }} />);
    const [fill, stroke] = paths();
    expect(fill!.getAttribute('fill')).not.toBe('none');
    expect(stroke!.getAttribute('fill')).toBe('none');
    expect(stroke!.getAttribute('stroke')).toBe(fill!.getAttribute('fill'));
  });
});
