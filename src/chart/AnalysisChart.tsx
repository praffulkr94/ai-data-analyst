/** Composes the three layers into a chart for one AnalysisResult. Everything type-specific is
    the choice of mark; nothing else branches on the chart type. */
import { useId, useMemo, useState } from 'react';
import { FOLD_LABEL, POINT_CAP } from '../engine/operation';
import {
  degeneracy,
  marksNeeded,
  type AnalysisResult,
  type Degenerate,
  type ResultRow,
} from '../engine/result';
import type { Visualization } from '../spec/grammar';
import { ChartFrame } from './ChartFrame';
import {
  Area,
  Bars,
  Grid,
  HoverArea,
  lastPoint,
  Line,
  MARK_CAP,
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
}: {
  result: AnalysisResult;
  visualization: Visualization;
}) {
  const [showTable, setShowTable] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  /** One hover value for the whole chart. Marks report into it; nothing else subscribes. */
  const [hover, setHover] = useState<Hover | null>(null);
  const tableId = useId();

  const xField = result.fields.find((f) => f.name === visualization.x);
  const yField = result.fields.find((f) => f.name === visualization.y);

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

  const mark = (s: Series, i: number) => {
    const common = {
      rows: s.rows,
      x: visualization.x,
      y: visualization.y,
      scales,
      dimensions,
      slot: i,
      label: named && series.length > 1 ? s.label : undefined,
      onHover: (row: ResultRow | null, at: { x: number; y: number }) =>
        setHover(row === null ? null : { row, ...at }),
    };
    switch (visualization.type) {
      case 'bar':
        return (
          <Bars
            key={s.key}
            {...common}
            subIndex={i}
            subCount={series.length}
            // ponytail: one focusable bar per Series, which is reachable but not ordered.
            // Roving tabindex across marks is M9's item.
            focusIndex={focusIndex}
            onFocusIndex={setFocusIndex}
          />
        );
      case 'line':
        return <Line key={s.key} {...common} reveal={reveal} labelY={labelYs?.[i]} />;
      case 'area':
        // An area chart is the fill plus the line, composed — not a third mark that knows both.
        return (
          <g key={s.key}>
            <Area {...common} />
            <Line {...common} reveal={reveal} labelY={labelYs?.[i]} />
          </g>
        );
      default:
        // Scatter arrives with `<Points>` in M8.
        return null;
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
        >
          <Grid scales={scales} dimensions={dimensions} />
          <YAxis scales={scales} dimensions={dimensions} />
          <XAxis scales={scales} dimensions={dimensions} field={xField} />
          {series.map(mark)}
          {/* Above the marks, so it receives the pointer for all of them at once. */}
          <HoverArea
            rows={drawn.rows}
            x={visualization.x}
            y={visualization.y}
            scales={scales}
            dimensions={dimensions}
            onHover={(row, at) => setHover(row === null ? null : { row, ...at })}
          />
        </ChartFrame>
      ) : (
        <DegenerateState
          state={state}
          marks={marksNeeded(result, visualization.x)}
          cap={MARK_CAP[visualization.type]}
          truncated={result.truncated}
        />
      )}

      <figcaption>
        <span className="chart-caption">{chartCaption(result.summary)}</span>
        <button type="button" className="ghost" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide table' : 'View as table'}
        </button>
      </figcaption>

      <Tooltip
        hover={drawable ? hover : null}
        xField={xField}
        yField={yField}
        seriesBy={visualization.seriesBy}
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
  truncated,
}: {
  state: Exclude<Degenerate, null | 'single'>;
  marks: number;
  cap: number;
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
            ? `This result is longer than the ${n(POINT_CAP)} points the application draws, so ` +
              'what came back is not the whole answer. Ask for a top-N, or bucket the dates by ' +
              'a coarser unit.'
            : `${n(marks)} categories is past the ${n(cap)} this chart can show without the ` +
              'marks becoming unreadable. Ask for a top-N, or group by something coarser.'}
    </p>
  );
}
