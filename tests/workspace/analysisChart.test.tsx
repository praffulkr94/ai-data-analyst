/** The chart layer, exercised through the real `DataEngine` and the real marks.

    Charts are asserted through their accessible data table and through the text on the page —
    never through SVG coordinates. Where a rule can only be observed in the path (a line that
    breaks at a gap rather than interpolating across it) the assertion is about the number of
    subpaths and never about where they are. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AnalysisChart } from '../../src/chart/AnalysisChart';
import { buildColumnStore } from '../../src/engine/columnStore';
import { inferSchema } from '../../src/engine/infer';
import { executeOperation, type ExecuteOptions } from '../../src/engine/operation';
import type { AnalysisResult } from '../../src/engine/result';
import { CANVAS_ABOVE } from '../../src/chart/marks';
import { TABLE_CAP } from '../../src/chart/ResultTable';
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
const run = (
  rows: string[][],
  operation: Operation,
  over: ExecuteOptions = {},
): AnalysisResult => {
  const schema = inferSchema(HEADER, rows);
  const store = buildColumnStore(HEADER, rows, {
    columns: schema.columns.map((c) => (c.name === 'goals' ? { ...c, type: 'number' } : c)),
  });
  return executeOperation(store, operation, { metric: 'm', ...over });
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

  /** A `date` column that was grouped by rather than bucketed reads out of the ColumnStore as an
      ISO day, not as an epoch. Every tick of it was labelled "no value" until `temporalLabel`
      accepted that third form. */
  it('labels a date column that was grouped rather than bucketed', () => {
    const grouped = run(YEARLY([2020, 2021]), op({ groupBy: ['date'] }));
    render(
      <AnalysisChart
        result={grouped}
        visualization={{ type: 'bar', x: 'date', y: 'm', seriesBy: null }}
      />,
    );
    const svg = document.querySelector('svg')!;
    expect(svg.textContent).toContain('15 Jun 2020');
    expect(svg.textContent).not.toContain('no value');
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

describe('the scatter mark', () => {
  /** Both axes are measures, which is what makes it a scatter: `g` is goals summed and `m` is
      matches counted, and `team` — the thing each point *is* — is on neither axis.

      Hand-worked so the two points sit in opposite corners of the plot. Brazil: three matches of
      three goals, so (9, 3), the largest of both, at the top right. Peru: one match of none, so
      (0, 1), at the left edge two thirds of the way down. */
  const ROWS = [
    ['2020-06-15', 'Brazil', '3'],
    ['2021-06-15', 'Brazil', '3'],
    ['2022-06-15', 'Brazil', '3'],
    ['2020-06-15', 'Peru', '0'],
  ];
  const spec = op({
    groupBy: ['team'],
    aggregations: [
      { id: 'm', fn: 'count', column: null, label: 'matches' },
      { id: 'g', fn: 'sum', column: 'goals', label: 'goals' },
    ],
  });
  const points = (over: Partial<Operation> = {}, rows = ROWS) =>
    run(rows, { ...spec, ...over }, { chartType: 'scatter' });
  const scatter: Visualization = { type: 'scatter', x: 'g', y: 'm', seriesBy: null };

  const INNER_W = 900 - 52 - 16;
  const INNER_H = 320 - 12 - 28;
  const surface = () => document.querySelector('svg rect[fill="transparent"]')!;
  const tip = () => document.querySelector('.chart-tooltip');

  it('draws one circle per point, and the pair behind each is in the data table', () => {
    render(<AnalysisChart result={points()} visualization={scatter} />);
    expect(document.querySelectorAll('svg circle')).toHaveLength(2);

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const cells = rows.map((r) => [
      within(r).getByRole('rowheader').textContent,
      ...within(r).getAllByRole('cell').map((c) => c.textContent),
    ]);
    expect(cells).toEqual([
      ['Brazil', '3', '9'],
      ['Peru', '1', '0'],
    ]);
  });

  /** There is no line to invert a scale against: the point is found in the quadtree, by pixel
      distance, in both directions at once. And what it is named by is the dimension, which on a
      scatter is on neither axis. */
  it('names the group of the point under the pointer', () => {
    render(<AnalysisChart result={points()} visualization={scatter} />);
    fireEvent.pointerMove(surface(), { clientX: INNER_W - 2, clientY: 2 });
    expect(tip()!.textContent).toContain('Brazil');
    fireEvent.pointerMove(surface(), { clientX: 2, clientY: Math.round(INNER_H * (2 / 3)) });
    expect(tip()!.textContent).toContain('Peru');
  });

  /** The group is the whole tuple: one of two names half-identifies the point. */
  it('names every grouping dimension the point belongs to', () => {
    const pairs = run(ROWS, { ...spec, groupBy: ['team', 'date'] }, { chartType: 'scatter' });
    render(<AnalysisChart result={pairs} visualization={scatter} />);
    // Brazil's three team-dates all sit at (3, 1), the largest x and the only y.
    fireEvent.pointerMove(surface(), { clientX: INNER_W - 2, clientY: 2 });
    expect(tip()!.textContent).toMatch(/Brazil · \d{2} \w{3} \d{4}/);
  });

  it('names nothing when the pointer is on no point, rather than the nearest one anywhere', () => {
    render(<AnalysisChart result={points()} visualization={scatter} />);
    fireEvent.pointerMove(surface(), { clientX: Math.round(INNER_W / 2), clientY: 140 });
    expect(tip()).toBeNull();
  });

  it('draws three Series at most, each in a slot of its own, the fold among them', () => {
    const rows = Array.from({ length: 40 }, (_, i) => [
      `${2000 + (i % 10)}-06-15`,
      `t${i % 8}`,
      String(i),
    ]);
    const result = run(
      rows,
      { ...spec, groupBy: ['team', 'date'] },
      { chartType: 'scatter', seriesBy: 'team' },
    );
    render(<AnalysisChart result={result} visualization={{ ...scatter, seriesBy: 'team' }} />);
    const fills = new Set(
      [...document.querySelectorAll('svg circle')].map((c) => c.getAttribute('fill')),
    );
    expect(fills.size).toBe(3);
    expect(document.querySelector('svg')!.textContent).toContain('Other');
  });

  /** The table stays the chart's accessible representation — one element, one id, pointed at by
      the same `aria-describedby` — but it renders a bounded number of rows and says so. */
  it('caps the table and says how much of the result it is showing', () => {
    const many = Array.from({ length: 1_200 }, (_, i) => ['2020-06-15', `t${i}`, String(i)]);
    const result = points({}, many);
    expect(result.rows).toHaveLength(1_200);
    render(<AnalysisChart result={result} visualization={scatter} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(TABLE_CAP + 1);
    expect(table.querySelector('caption')!.textContent).toContain('first 1,000 of 1,200');
    expect(document.querySelector('svg')!.getAttribute('aria-describedby')).toBe(table.id);
  });
});

describe('the canvas a large scatter switches to', () => {
  /** jsdom has no 2D context and nothing to draw one on, which is exactly why nothing here
      asserts a pixel: what is asserted is that the elements are gone, that the canvas is there,
      and that the table beside it still is. */
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterAll(() => vi.restoreAllMocks());

  const spec = op({
    groupBy: ['team'],
    aggregations: [
      { id: 'm', fn: 'count', column: null, label: 'matches' },
      { id: 'g', fn: 'sum', column: 'goals', label: 'goals' },
    ],
  });
  const scatter: Visualization = { type: 'scatter', x: 'g', y: 'm', seriesBy: null };
  /** One row per team, one point per row, one past the threshold. */
  const result = run(
    Array.from({ length: CANVAS_ABOVE + 1 }, (_, i) => ['2020-06-15', `t${i}`, String(i)]),
    spec,
    { chartType: 'scatter' },
  );

  it('draws the points into a canvas instead of into elements', () => {
    expect(result.rows).toHaveLength(CANVAS_ABOVE + 1);
    render(<AnalysisChart result={result} visualization={scatter} />);
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(document.querySelectorAll('svg circle')).toHaveLength(0);
  });

  /** The contract the canvas must not break: a chart with no elements still has an accessible
      representation, and it is the same table pointed at by the same `aria-describedby`. */
  it('keeps the data table and the description that points at it', () => {
    render(<AnalysisChart result={result} visualization={scatter} />);
    const table = screen.getByRole('table');
    expect(document.querySelector('svg')!.getAttribute('aria-describedby')).toBe(table.id);
    expect(within(table).getAllByRole('row')).toHaveLength(TABLE_CAP + 1);
    expect(document.querySelector('svg title')!.textContent).toContain('Scatter plot');
    expect(document.querySelector('svg title')!.textContent).toContain('points');
  });

  /** A drag is observable without measuring anything: the way back from one appears. */
  it('offers a way back from a pan, for anyone who cannot drag one back', () => {
    render(<AnalysisChart result={result} visualization={scatter} />);
    const surface = document.querySelector('svg rect[fill="transparent"]')!;
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 160, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    const reset = screen.getByRole('button', { name: 'Reset view' });

    fireEvent.click(reset);
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
  });

  /** The pan was pointer-only, and its only way back was a button that appears once a pointer
      has been used — which is no way back at all for anybody without one. */
  it('pans from the keyboard, and Home is the way back', () => {
    render(<AnalysisChart result={result} visualization={scatter} />);
    const surface = screen.getByRole('application');
    expect(surface).toHaveProperty('tabIndex', 0);

    fireEvent.keyDown(surface, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeTruthy();

    fireEvent.keyDown(surface, { key: 'Home' });
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
  });

  it('does not offer a drag on a scatter small enough to be whole on the screen', () => {
    const small = run(
      Array.from({ length: 10 }, (_, i) => ['2020-06-15', `t${i}`, String(i)]),
      spec,
      { chartType: 'scatter' },
    );
    render(<AnalysisChart result={small} visualization={scatter} />);
    const surface = document.querySelector('svg rect[fill="transparent"]')!;
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 160, clientY: 130, pointerId: 1 });
    fireEvent.keyDown(surface, { key: 'ArrowRight' });
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    // Nothing to pan is nothing to focus: the surface is not a control on this chart.
    expect(screen.queryByRole('application')).toBeNull();
  });
});

/** The `role="img"` label is the whole of what a screen reader gets before it reaches the
    table: what kind of chart, what it measures, how many of them, where the extreme is. The
    label text itself is tested at the engine seam (`tests/engine/summaryText.test.ts`); what
    is asserted here is that every chart type actually carries it as its accessible name, and
    that the name points at the table that holds the numbers. */
describe('the accessible chart', () => {
  const overTime = run(
    [...YEARLY([2020, 2021, 2022], 'Brazil')],
    op({ timeBucket: { column: 'date', unit: 'year' }, sort: { by: 'date', dir: 'asc' } }),
  );

  for (const [type, name] of [
    ['bar', 'Bar chart'],
    ['line', 'Line chart'],
    ['area', 'Area chart'],
  ] as const) {
    it(`names a ${type} chart, its measure and its size`, () => {
      render(<AnalysisChart result={overTime} visualization={viz({ type })} />);
      expect(
        screen.getByRole('img', { name: `${name}. matches by date by year, 3 categories. Highest: 2020, 1.` }),
      ).toBeTruthy();
    });
  }

  it('calls a scatter’s groups points, because its x is a measure and not a category', () => {
    const result = run(
      [
        ['2020-06-15', 'Brazil', '3'],
        ['2021-06-15', 'Peru', '1'],
      ],
      op({
        groupBy: ['team'],
        aggregations: [
          { id: 'm', fn: 'count', column: null, label: 'matches' },
          { id: 'g', fn: 'sum', column: 'goals', label: 'goals' },
        ],
      }),
      { chartType: 'scatter' },
    );
    render(
      <AnalysisChart result={result} visualization={{ type: 'scatter', x: 'g', y: 'm', seriesBy: null }} />,
    );
    expect(screen.getByRole('img', { name: /2 points\./ })).toBeTruthy();
  });

  it('describes every chart by the table that holds its numbers', () => {
    render(<AnalysisChart result={overTime} visualization={viz()} />);
    const describedBy = screen.getByRole('img').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toBe(screen.getByRole('table', { hidden: true }));
  });
});

/** Keyboard-navigable marks, for bar only — doing one chart type well beats doing four badly
    (DECISIONS §15). What is asserted is the shape of the interaction: one tab stop for the
    whole chart, the arrow keys moving inside it, and every bar naming itself. */
describe('walking a bar chart from the keyboard', () => {
  const result = run(
    [...YEARLY([2020, 2021, 2022], 'Brazil')],
    op({ timeBucket: { column: 'date', unit: 'year' }, sort: { by: 'date', dir: 'asc' } }),
  );
  const bars = () => [...document.querySelectorAll<SVGRectElement>('[data-bar]')];
  const stops = () => bars().filter((b) => b.getAttribute('tabindex') === '0');
  const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });

  it('offers one tab stop for the whole chart, on the first bar', () => {
    render(<AnalysisChart result={result} visualization={viz({ type: 'bar' })} />);
    expect(bars()).toHaveLength(3);
    expect(stops()).toEqual([bars()[0]]);
  });

  it('moves along the axis with the arrow keys, and the tab stop follows the focus', () => {
    render(<AnalysisChart result={result} visualization={viz({ type: 'bar' })} />);
    bars()[0]!.focus();
    key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement).toBe(bars()[1]);
    key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement).toBe(bars()[2]);
    key(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement).toBe(bars()[1]);
    // The reader left it there, so Tab comes back to it and not to the first bar.
    expect(stops()).toEqual([bars()[1]]);
  });

  it('stops at both ends rather than wrapping, and Home and End reach them', () => {
    render(<AnalysisChart result={result} visualization={viz({ type: 'bar' })} />);
    bars()[0]!.focus();
    key(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement).toBe(bars()[0]);
    key(document.activeElement!, 'End');
    expect(document.activeElement).toBe(bars()[2]);
    key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement).toBe(bars()[2]);
    key(document.activeElement!, 'Home');
    expect(document.activeElement).toBe(bars()[0]);
  });

  it('names every bar by its group and its value, and a bucket as a date', () => {
    render(<AnalysisChart result={result} visualization={viz({ type: 'bar' })} />);
    expect(bars().map((b) => b.getAttribute('aria-label'))).toEqual([
      '2020: 1',
      '2021: 1',
      '2022: 1',
    ]);
  });

  it('names the Series too, where a bar carries one in colour alone', () => {
    const grouped = run(
      [...YEARLY([2020], 'Brazil'), ...YEARLY([2020], 'Peru')],
      op({
        timeBucket: { column: 'date', unit: 'year' },
        groupBy: ['team'],
        sort: { by: 'date', dir: 'asc' },
      }),
    );
    render(<AnalysisChart result={grouped} visualization={viz({ type: 'bar', seriesBy: 'team' })} />);
    expect(bars().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Brazil, 2020: 1',
      'Peru, 2020: 1',
    ]);
    // Still one tab stop across both Series, and the arrows cross from one into the other.
    expect(stops()).toEqual([bars()[0]]);
    bars()[0]!.focus();
    key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement).toBe(bars()[1]);
  });

  it('keeps a tab stop when the first Series has no bar to draw', () => {
    // `goals` is null for Chile throughout, so an average over it draws no bar for that Series.
    const rows = [
      ['2020-06-15', 'Chile', 'NA'],
      ['2020-06-15', 'Brazil', '2'],
    ];
    const nulled = run(
      rows,
      op({
        groupBy: ['team'],
        aggregations: [{ id: 'm', fn: 'avg', column: 'goals', label: 'goals' }],
        sort: null,
      }),
    );
    render(
      <AnalysisChart result={nulled} visualization={{ type: 'bar', x: 'team', y: 'm', seriesBy: null }} />,
    );
    expect(bars()).toHaveLength(1);
    expect(stops()).toEqual([bars()[0]]);
  });
});
