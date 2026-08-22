/** The chart layer, exercised through the real `DataEngine` and the real marks.

    Charts are asserted through their accessible data table and through the text on the page —
    never through SVG coordinates. Where a rule can only be observed in the path (a line that
    breaks at a gap rather than interpolating across it) the assertion is about the number of
    subpaths and never about where they are. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

  it('draws the points in x order whatever order the rows arrived in', () => {
    // Reversed on purpose. The executor orders a temporal result ascending, so this is the mark
    // defending itself rather than the case the executor produces.
    const reversed = { ...result, rows: [...result.rows].reverse() };
    render(<AnalysisChart result={reversed} visualization={viz()} />);
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

describe('degenerate results', () => {
  const bar = (over: Partial<Viz> = {}) => viz({ type: 'bar', x: 'team', ...over });
  const svg = () => document.querySelector('svg');

  it('draws one bar for one row, because one bar is a legitimate answer', () => {
    const one = run(YEARLY([2020]), op({ groupBy: ['team'] }));
    render(<AnalysisChart result={one} visualization={bar()} />);
    expect(document.querySelectorAll('svg rect')).toHaveLength(1);
  });

  it('says no rows matched rather than drawing an axis around nothing', () => {
    const none = run(
      YEARLY([2020]),
      op({ groupBy: ['team'], filters: [{ op: 'eq', column: 'team', value: 'Nowhere' }] }),
    );
    render(<AnalysisChart result={none} visualization={bar()} />);
    expect(svg()).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('No rows matched');
    // The accessible representation is still there, empty and honest.
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('refuses an all-null result rather than drawing zeros that read as real zeros', () => {
    const allNull = run(
      [
        ['2020-06-15', 'Brazil', 'NA'],
        ['2021-06-15', 'Peru', 'NA'],
      ],
      op({ groupBy: ['team'], aggregations: [{ id: 'm', fn: 'sum', column: 'goals', label: 'goals' }] }),
    );
    render(<AnalysisChart result={allNull} visualization={bar()} />);
    expect(svg()).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('no value');
  });

  it('refuses 800 bars and says what to ask for instead', () => {
    const many = run(
      Array.from({ length: 800 }, (_, i) => [`2020-06-15`, `t${i}`, '1']),
      op({ groupBy: ['team'], limit: 1000 }),
    );
    expect(many.rows).toHaveLength(800);
    render(<AnalysisChart result={many} visualization={bar()} />);
    expect(svg()).toBeNull();
    const notice = screen.getByRole('status').textContent!;
    expect(notice).toContain('800 categories');
    expect(notice).toContain('top-N');
    // 800 rows are readable one at a time, so the table keeps them.
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(801);
  });

  it('draws those same 800 as a line, where a point needs one pixel', () => {
    const many = run(
      Array.from({ length: 800 }, (_, i) => [`${1200 + i}-06-15`, 'Brazil', '1']),
      op({ timeBucket: { column: 'date', unit: 'year' }, limit: 1000 }),
    );
    render(<AnalysisChart result={many} visualization={viz()} />);
    expect(svg()).not.toBeNull();
    expect(paths()).toHaveLength(1);
  });
});

describe('the tooltip', () => {
  const result = run(
    YEARLY([2020, 2021, 2022, 2023]),
    op({ timeBucket: { column: 'date', unit: 'year' }, sort: { by: 'date', dir: 'asc' } }),
  );

  /** The transparent rectangle over the plot area. jsdom gives every element a zero bounding
      box, so a pointer at clientX 0 is at the left edge of the plot and the inner width is the
      right edge. */
  const surface = () => document.querySelector('svg rect[fill="transparent"]')!;
  const tip = () => document.querySelector('.chart-tooltip');
  const INNER = 900 - 52 - 16;

  it('is one element in the body, not one per mark', () => {
    render(<AnalysisChart result={result} visualization={viz()} />);
    fireEvent.pointerMove(surface(), { clientX: 4, clientY: 10 });
    expect(document.querySelectorAll('.chart-tooltip')).toHaveLength(1);
    expect(tip()!.parentElement).toBe(document.body);
    // Never a `<title>` per mark either — the one `<title>` there is belongs to the figure.
    expect(document.querySelectorAll('svg title')).toHaveLength(1);
  });

  it('names the point the pointer is nearest, found by inverting the scale', () => {
    render(<AnalysisChart result={result} visualization={viz()} />);
    fireEvent.pointerMove(surface(), { clientX: 2, clientY: 10 });
    expect(tip()!.textContent).toContain('2020');
    fireEvent.pointerMove(surface(), { clientX: INNER - 2, clientY: 10 });
    expect(tip()!.textContent).toContain('2023');
    expect(tip()!.textContent).toContain('1');
  });

  it('names the Series, so two lines at one x are told apart', () => {
    const two = run(
      [...YEARLY([2020, 2021], 'Brazil'), ...YEARLY([2020, 2021], 'Peru'), ...YEARLY([2021], 'Peru')],
      op({
        timeBucket: { column: 'date', unit: 'year' },
        groupBy: ['team'],
        sort: { by: 'date', dir: 'asc' },
      }),
    );
    render(<AnalysisChart result={two} visualization={viz({ seriesBy: 'team' })} />);
    // Peru has two matches in 2021 and Brazil one, so the pointer at the top of the chart is
    // nearest Peru and at the bottom nearest Brazil.
    fireEvent.pointerMove(surface(), { clientX: INNER - 2, clientY: 0 });
    expect(tip()!.textContent).toContain('Peru');
    fireEvent.pointerMove(surface(), { clientX: INNER - 2, clientY: 320 });
    expect(tip()!.textContent).toContain('Brazil');
  });

  it('goes away when the pointer leaves the plot', () => {
    render(<AnalysisChart result={result} visualization={viz()} />);
    fireEvent.pointerMove(surface(), { clientX: 4, clientY: 10 });
    expect(tip()).not.toBeNull();
    fireEvent.pointerLeave(surface());
    expect(tip()).toBeNull();
  });

  it('is hidden from the accessibility tree, which the data table serves instead', () => {
    render(<AnalysisChart result={result} visualization={viz()} />);
    fireEvent.pointerMove(surface(), { clientX: 4, clientY: 10 });
    expect(tip()!.getAttribute('aria-hidden')).toBe('true');
  });

  it('has no hover surface on a bar chart, where every bar is its own target', () => {
    render(<AnalysisChart result={result} visualization={viz({ type: 'bar' })} />);
    expect(document.querySelector('svg rect[fill="transparent"]')).toBeNull();
    fireEvent.mouseEnter(document.querySelector('svg rect')!, { clientX: 40, clientY: 40 });
    expect(tip()!.textContent).toContain('2020');
  });
});

describe('the Series budget on screen', () => {
  it('draws six lines at most, each in a slot of its own, the fold among them', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [
      `${2000 + (i % 3)}-06-15`,
      `t${i % 10}`,
      '2',
    ]);
    const schema = inferSchema(HEADER, rows);
    const store = buildColumnStore(HEADER, rows, schema);
    const result = executeOperation(
      store,
      op({ timeBucket: { column: 'date', unit: 'year' }, groupBy: ['team'] }),
      { metric: 'm', seriesBy: 'team' },
    );

    render(<AnalysisChart result={result} visualization={viz({ seriesBy: 'team' })} />);
    expect(paths()).toHaveLength(6);
    expect(new Set(paths().map((p) => p.getAttribute('stroke'))).size).toBe(6);
    expect(document.querySelector('svg')!.textContent).toContain('Other');
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

describe('the reveal transition', () => {
  const result = run(
    YEARLY([2020, 2021, 2022]),
    op({ timeBucket: { column: 'date', unit: 'year' }, sort: { by: 'date', dir: 'asc' } }),
  );

  /** jsdom has no `matchMedia`, so both branches have to be asked for explicitly. */
  const asking = (reduce: boolean) => {
    window.matchMedia = ((media: string) => ({
      media,
      matches: reduce,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  };

  afterEach(() => {
    // @ts-expect-error putting jsdom back the way it was
    delete window.matchMedia;
    vi.restoreAllMocks();
  });

  const line = () => document.querySelector('svg path')!;

  it('draws the line whole and schedules no frame when reduced motion is asked for', () => {
    asking(true);
    const frame = vi.spyOn(globalThis, 'requestAnimationFrame');
    render(<AnalysisChart result={result} visualization={viz()} />);
    expect(line().getAttribute('stroke-dasharray')).toBeNull();
    expect(frame).not.toHaveBeenCalled();
  });

  it('draws it in when motion is allowed', () => {
    asking(false);
    render(<AnalysisChart result={result} visualization={viz()} />);
    // `pathLength` is 1, so the dash covers the whole line and the offset is how much of it is
    // still hidden. At the first paint that is all of it.
    expect(line().getAttribute('pathLength')).toBe('1');
    expect(line().getAttribute('stroke-dasharray')).toBe('1');
    expect(Number(line().getAttribute('stroke-dashoffset'))).toBeGreaterThan(0);
  });

  it('treats a browser that will not say as having asked for less motion', () => {
    // No `matchMedia` at all. Animating on the assumption that nobody minds is the wrong
    // default; the chart is legible either way.
    render(<AnalysisChart result={result} visualization={viz()} />);
    expect(line().getAttribute('stroke-dasharray')).toBeNull();
  });
});
