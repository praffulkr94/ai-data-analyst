/** Composes the three layers into a chart for one AnalysisResult. Everything type-specific is
    the choice of mark; nothing else branches on the chart type. */
import { useEffect, useId, useMemo, useState } from 'react';
import { CHART_BUDGET, FOLD_LABEL } from '../engine/operation';
import {
  degeneracy,
  marksNeeded,
  type AnalysisResult,
  type Degenerate,
  type ResultRow,
} from '../engine/result';
import { since } from '../perf';
import type { Visualization } from '../spec/grammar';
import { ChartFrame } from './ChartFrame';
import {
  Area,
  Bars,
  CANVAS_ABOVE,
  Grid,
  HoverArea,
  lastPoint,
  Line,
  MARK_CAP,
  NO_PAN,
  Points,
  PointsCanvas,
  PointsHover,
  seriesColor,
  XAxis,
  YAxis,
} from './marks';
import { Tooltip, type Hover } from './Tooltip';
import { ResultTable } from './ResultTable';
import { chartCaption } from './summaryText';
import { useChartDimensions } from './useChartDimensions';
import { useReveal } from './useReveal';
import { useScales } from './useScales';

/** One Series and the rows that belong to it. A chart with no `seriesBy` is one Series holding
    every row, so the marks never need a special case for the single-Series chart. */
type Series = { key: string; label: string; rows: ResultRow[] };

/** Split in first-appearance order, with the fold last. Slots are handed out by position, so
    what matters is that the order is a function of the data and nothing else. */
function splitSeries(rows: ResultRow[], by: string | null): Series[] {
  if (!by) return [{ key: '', label: '', rows }];
  const out = new Map<string, Series>();
  for (const row of rows) {
    const key = String(row[by] ?? '');
    const existing = out.get(key);
    if (existing) existing.rows.push(row);
    else out.set(key, { key, label: key === '' ? 'no value' : key, rows: [row] });
  }
  const series = [...out.values()];
  return [
    ...series.filter((s) => s.key !== FOLD_LABEL),
    ...series.filter((s) => s.key === FOLD_LABEL),
  ];
}

export function AnalysisChart({
  result,
  visualization,
  table,
}: {
  result: AnalysisResult;
  visualization: Visualization;
  /** The card owns this switch when it renders a control bar, because that is where the design
      puts it — but the table itself stays here, hidden rather than unmounted, because that is
      the accessible reading of the chart and it must not depend on a control being pressed. */
  table?: { shown: boolean; onToggle: () => void };
}) {
  const [ownTable, setOwnTable] = useState(false);
  const showTable = table ? table.shown : ownTable;
  /** A drag offset, and only a canvas scatter has one: an SVG chart is whole on the screen
      already. Reset when a new result arrives, because it is a view of that result and not of
      the chart element. */
  const [pan, setPan] = useState(NO_PAN);
  /** The bar the chart's single tab stop sits on, `null` until one has been entered. Reset with
      the result: a key names a bar in the chart that is on screen now. */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    setPan(NO_PAN);
    setFocusKey(null);
    /** Time to a chart on screen, measured from the Request that asked for it: the effect after
        the commit that drew it. Null for a chart that arrived without a Request behind it — a
        restored link, or the dev panel — and a measure against a mark that is not there throws,
        which is why `since` checks. */
    since('chart:paint', 'request:start');
  }, [result]);
  /** One hover value for the whole chart. Marks report into it; nothing else subscribes. */
  const [hover, setHover] = useState<Hover | null>(null);
  const tableId = useId();

  const xField = result.fields.find((f) => f.name === visualization.x);
  const yField = result.fields.find((f) => f.name === visualization.y);
  /** A scatter's axes are both measures, so the dimensions its points are grouped by are on
      neither of them and the tooltip is the only place they can be named. */
  const groupFields =
    visualization.type === 'scatter'
      ? result.fields.filter((f) => f.role === 'dimension' && f.name !== visualization.seriesBy)
      : undefined;

  /** The fold is in the result, the table and the caption, but not among the marks: an "Other"
      bar holding most of the Dataset flattens the fifteen groups the Question was about, and a
      reader cannot compare what they cannot see. The caption states its size instead.

      A folded *Series* is different and is drawn — it is one more line on a shared scale, not a
      bar that swallows the axis. */
  const drawn = useMemo(
    () =>
      xField
        ? { ...result, rows: result.rows.filter((r) => r[xField.name] !== FOLD_LABEL) }
        : result,
    [result, xField],
  );

  const named = visualization.seriesBy !== null;
  const labelled = named && visualization.type !== 'bar';
  // Room on the right for the direct labels, and only when there are some.
  const [containerRef, dimensions] = useChartDimensions(labelled ? { right: 92 } : {});
  const scales = useScales(drawn, xField, yField, dimensions, {
    banded: visualization.type === 'bar',
  });
  const series = useMemo(
    () => splitSeries(drawn.rows, visualization.seriesBy),
    [drawn.rows, visualization.seriesBy],
  );
  // Keyed on the result, so a new answer draws itself in and a hover does not.
  const reveal = useReveal(result);

  // A single row is drawable — one bar is a legitimate answer — so only the states that cannot
  // honestly be drawn take the named-state path. `too-many` is the renderability guard: 800
  // bars are not a chart, and a truncated result is not the whole answer.
  const state = degeneracy(result, visualization.y, {
    x: visualization.x,
    marks: MARK_CAP[visualization.type],
  });
  const drawable = state === null || state === 'single';

  /** Direct labels land at the end of their own line, which puts two of them on top of each
      other whenever two Series finish at a similar value. Spread down the ones that collide:
      a label a few pixels off its line still reads as belonging to it, and two labels sharing
      a pixel read as neither. */
  const labelYs = useMemo(() => {
    if (!labelled) return null;
    const ends = series.map((s, i) => ({
      i,
      y: lastPoint(s.rows, visualization.x, visualization.y, scales)?.value ?? null,
    }));
    const out = new Array<number | undefined>(series.length);
    let previous = -Infinity;
    for (const end of ends.filter((e) => e.y !== null).sort((a, b) => a.y! - b.y!)) {
      const y = Math.max(end.y!, previous + 12);
      out[end.i] = y;
      previous = y;
    }
    return out;
  }, [labelled, series, scales, visualization.x, visualization.y]);

  /** Where SVG gives way to canvas: the same points, the same scales, the same hit-testing, one
      element instead of a hundred thousand. */
  const onCanvas = visualization.type === 'scatter' && drawn.rows.length > CANVAS_ABOVE;

  /** The one pointer target over the whole plot area, whichever kind it is. */
  const surface = {
    rows: drawn.rows,
    x: visualization.x,
    y: visualization.y,
    scales,
    dimensions,
    onHover: (row: ResultRow | null, at: { x: number; y: number }) =>
      setHover(row === null ? null : { row, ...at }),
  };

  const common = (s: Series, i: number) => ({
    rows: s.rows,
    x: visualization.x,
    y: visualization.y,
    scales,
    dimensions,
    slot: i,
    field: xField,
    label: named && series.length > 1 ? s.label : undefined,
    onHover: (row: ResultRow | null, at: { x: number; y: number }) =>
      setHover(row === null ? null : { row, ...at }),
  });

  /** Where the tab stop starts: the first Series with a bar to draw. A Series whose every value
      is null draws no rect, so taking Series 0 on faith can leave a chart with no tab stop at
      all. */
  const entrySeries = useMemo(
    () => series.findIndex((s) => s.rows.some((r) => typeof r[visualization.y] === 'number')),
    [series, visualization.y],
  );

  const mark = (s: Series, i: number) => {
    const common_ = common(s, i);
    switch (visualization.type) {
      case 'bar':
        return (
          <Bars
            key={s.key}
            {...common_}
            subIndex={i}
            subCount={series.length}
            focusKey={focusKey}
            onFocusKey={setFocusKey}
            entry={i === entrySeries}
          />
        );
      case 'line':
        return <Line key={s.key} {...common_} reveal={reveal} labelY={labelYs?.[i]} />;
      case 'area':
        // An area chart is the fill plus the line, composed — not a third mark that knows both.
        return (
          <g key={s.key}>
            <Area {...common_} />
            <Line {...common_} reveal={reveal} labelY={labelYs?.[i]} />
          </g>
        );
      case 'scatter':
        // Above the threshold the canvas in the overlay draws the points and this contributes
        // the Series label alone.
        return <Points key={s.key} {...common_} labelY={labelYs?.[i]} drawn={!onCanvas} />;
    }
  };

  return (
    <figure className="analysis-chart">
      {/* Bars carry their Series only in colour, so grouped bars need the names spelled out.
          A line says its own name at its end, which is why this is bar-only. */}
      {drawable && series.length > 1 && visualization.type === 'bar' && (
        <ul className="chart-legend">
          {series.map((s, i) => (
            <li key={s.key}>
              <span className="swatch" style={{ background: seriesColor(i) }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {drawable ? (
        <ChartFrame
          dimensions={dimensions}
          containerRef={containerRef}
          result={result}
          type={visualization.type}
          describedBy={tableId}
          overlay={
            onCanvas &&
            series.map((s, i) => <PointsCanvas key={s.key} {...common(s, i)} pan={pan} />)
          }
        >
          {/* The axes move with the data: a panned chart whose ticks stayed put is mislabelled. */}
          <Grid scales={scales} dimensions={dimensions} pan={pan} />
          <YAxis scales={scales} dimensions={dimensions} pan={pan} />
          <XAxis scales={scales} dimensions={dimensions} field={xField} pan={pan} />
          {series.map(mark)}
          {/* Above the marks, so it receives the pointer for all of them at once. A scatter has
              marks the pointer can be over and hundreds of thousands of them, so it hit-tests a
              quadtree instead of inverting the x scale. */}
          {visualization.type === 'scatter' ? (
            <PointsHover {...surface} pan={pan} onPan={onCanvas ? setPan : undefined} />
          ) : (
            <HoverArea {...surface} />
          )}
        </ChartFrame>
      ) : (
        <DegenerateState
          state={state}
          marks={marksNeeded(result, visualization.x)}
          cap={MARK_CAP[visualization.type]}
          pointCap={CHART_BUDGET[visualization.type].points}
          truncated={result.truncated}
        />
      )}

      <figcaption>
        <span className="chart-caption">{chartCaption(result.summary)}</span>
        {/* A drag is the only way back from a drag, which is no way at all for anyone not using
            a pointer. The button is the way back, and it appears only once there is one. */}
        {(pan.x !== 0 || pan.y !== 0) && (
          <button type="button" className="ghost" onClick={() => setPan(NO_PAN)}>
            Reset view
          </button>
        )}
        {!table && (
          <button type="button" className="ghost" onClick={() => setOwnTable((v) => !v)}>
            {showTable ? 'Hide table' : 'View as table'}
          </button>
        )}
      </figcaption>

      <Tooltip
        hover={drawable ? hover : null}
        xField={xField}
        yField={yField}
        seriesBy={visualization.seriesBy}
        groupFields={groupFields}
      />

      <ResultTable result={result} id={tableId} hidden={!showTable} />
    </figure>
  );
}

/** A result that cannot honestly be drawn gets a named state, never an empty or illegible SVG.
    Each one names what happened and the nearest Question that would work — a refusal with no way
    forward is a dead end, and the numbers behind it are still in the table below. */
function DegenerateState({
  state,
  marks,
  cap,
  pointCap,
  truncated,
}: {
  state: Exclude<Degenerate, null | 'single'>;
  marks: number;
  cap: number;
  /** The chart type's point budget, which is what `truncated` means it exceeded. */
  pointCap: number;
  truncated: boolean;
}) {
  const n = (v: number) => v.toLocaleString('en-US');
  return (
    <p className="notice notice-warning" role="status">
      {state === 'empty'
        ? 'No rows matched. Remove a filter to widen the question.'
        : state === 'all-null'
          ? 'Every group came back with no value. Drawn as zeros that would read as real zeros, ' +
            'so it is not drawn.'
          : truncated
            ? `This result is longer than the ${n(pointCap)} points the application draws, so ` +
              'what came back is not the whole answer. Ask for a top-N, or bucket the dates by ' +
              'a coarser unit.'
            : `${n(marks)} categories is past the ${n(cap)} this chart can show without the ` +
              'marks becoming unreadable. Ask for a top-N, or group by something coarser.'}
    </p>
  );
}
