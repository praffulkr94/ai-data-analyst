/** Composes the three layers into a chart for one AnalysisResult. Everything type-specific is
    the choice of mark; nothing else branches on the chart type. */
import { useId, useMemo, useState } from 'react';
import { FOLD_LABEL } from '../engine/operation';
import { degeneracy, type AnalysisResult } from '../engine/result';
import type { Visualization } from '../spec/grammar';
import { ChartFrame } from './ChartFrame';
import { Bars, Grid, XAxis, YAxis } from './marks';
import { ResultTable } from './ResultTable';
import { chartCaption } from './summaryText';
import { useChartDimensions } from './useChartDimensions';
import { useScales } from './useScales';

export function AnalysisChart({
  result,
  visualization,
}: {
  result: AnalysisResult;
  visualization: Visualization;
}) {
  const [showTable, setShowTable] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const tableId = useId();

  const xField = result.fields.find((f) => f.name === visualization.x);
  const yField = result.fields.find((f) => f.name === visualization.y);

  /** The fold is in the result, the table and the caption, but not among the marks: an "Other"
      bar holding most of the Dataset flattens the fifteen groups the Question was about, and a
      reader cannot compare what they cannot see. The caption states its size instead. */
  const drawn = useMemo(
    () =>
      xField
        ? { ...result, rows: result.rows.filter((r) => r[xField.name] !== FOLD_LABEL) }
        : result,
    [result, xField],
  );

  const [containerRef, dimensions] = useChartDimensions();
  const scales = useScales(drawn, xField, yField, dimensions, {
    banded: visualization.type === 'bar',
  });

  // A single row is drawable — one bar is a legitimate answer — so only the two states that
  // cannot honestly be drawn take the named-state path.
  const state = degeneracy(result, visualization.y);
  const drawable = state === null || state === 'single';

  return (
    <figure className="analysis-chart">
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
          <XAxis scales={scales} dimensions={dimensions} temporal={xField?.temporal ?? false} />
          <Bars
            rows={drawn.rows}
            x={visualization.x}
            y={visualization.y}
            scales={scales}
            dimensions={dimensions}
            focusIndex={focusIndex}
            onFocusIndex={setFocusIndex}
          />
        </ChartFrame>
      ) : (
        <DegenerateState state={state} />
      )}

      <figcaption>
        <span className="chart-caption">{chartCaption(result.summary)}</span>
        <button type="button" className="ghost" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide table' : 'View as table'}
        </button>
      </figcaption>

      <ResultTable result={result} id={tableId} hidden={!showTable} />
    </figure>
  );
}

/** A result that cannot honestly be drawn gets a named state, never an empty SVG. */
function DegenerateState({ state }: { state: 'empty' | 'all-null' }) {
  return (
    <p className="notice notice-warning">
      {state === 'empty'
        ? 'No rows matched. Remove a filter to widen the question.'
        : 'Every group came back with no value. Drawn as zeros that would read as real zeros, ' +
          'so it is not drawn.'}
    </p>
  );
}
