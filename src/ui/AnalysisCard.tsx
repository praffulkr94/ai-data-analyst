/** The active Analysis on the canvas: its title, the Revision on screen, the stepper between
    Revisions, and the two manual controls.

    The controls are the milestone's argument. A spec only the model can write is
    indistinguishable from blindly rendered model output; a spec two editors can write is
    demonstrably an object the application owns. Both editors produce the same Revision. */
import { useEffect, useMemo } from 'react';
import { AnalysisChart } from '../chart/AnalysisChart';
import { MODELS } from '../ai/models';
import {
  aggregationOptions,
  chartTypeOptions,
  metricAggregation,
  withAggregation,
  withChartType,
} from '../spec/edits';
import type { AggregationFn, AnalysisSpec } from '../spec/grammar';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';

export function AnalysisCard({ workspace }: { workspace: Workspace }) {
  const analysis = useApp((s) => s.analyses.find((a) => a.id === s.activeAnalysisId) ?? null);
  const stepRevision = useApp((s) => s.stepRevision);
  const id = analysis?.id ?? null;

  /** Cmd+Z steps back one Revision, Shift+Cmd+Z forward again. Undo is a Revision step and not
      a history of every action, which is why the hash is written with `replaceState` and Back
      stays the browser's. A text field's own undo is left alone. */
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey)) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }
      e.preventDefault();
      stepRevision(id, e.shiftKey ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, stepRevision]);

  if (!analysis) return null;
  const revision = analysis.revisions[analysis.at]!;
  const count = analysis.revisions.length;

  return (
    <section className="panel analysis">
      <div className="panel-head">
        <h2>{analysis.title}</h2>
        <span className="tag" title={MODELS[revision.model].note}>
          {MODELS[revision.model].label}
        </span>
        {count > 1 && (
          <div className="stepper" role="group" aria-label="Revisions">
            <button
              type="button"
              className="ghost"
              onClick={() => stepRevision(analysis.id, -1)}
              disabled={analysis.at === 0}
              aria-label="Previous revision"
            >
              &lsaquo;
            </button>
            <span aria-live="polite">
              {analysis.at + 1}/{count}
            </span>
            <button
              type="button"
              className="ghost"
              onClick={() => stepRevision(analysis.id, 1)}
              disabled={analysis.at === count - 1}
              aria-label="Next revision"
            >
              &rsaquo;
            </button>
          </div>
        )}
      </div>
      <p className="narration">{revision.spec.narration}</p>
      <Controls workspace={workspace} spec={revision.spec} />
      <AnalysisChart result={revision.result} visualization={revision.spec.visualization} />
    </section>
  );
}

/** The chart-type toggle and the aggregation dropdown, and nothing else. Axis and field pickers
    are a chart builder, which is a different product (DECISIONS §11).

    Both offer only what the semantic validator accepts, so a control cannot propose an analysis
    the application would then refuse. */
function Controls({ workspace, spec }: { workspace: Workspace; spec: AnalysisSpec }) {
  const columns = useApp((s) => s.columns);
  const schema = useMemo(() => ({ columns }), [columns]);
  const types = chartTypeOptions(spec, schema);
  const fns = aggregationOptions(spec, schema);
  const metric = metricAggregation(spec);

  if (types.length < 2 && fns.length < 2) return null;

  return (
    <div className="controls">
      {types.length > 1 && (
        <div className="segmented" role="group" aria-label="Chart type">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={spec.visualization.type === type}
              onClick={() => void workspace.revise(withChartType(spec, type))}
            >
              {type}
            </button>
          ))}
        </div>
      )}
      {metric && fns.length > 1 && (
        <label className="agg-picker">
          <span className="visually-hidden">Aggregation</span>
          <select
            value={metric.fn}
            onChange={(e) => void workspace.revise(withAggregation(spec, e.target.value as AggregationFn))}
          >
            {fns.map((fn) => (
              <option key={fn} value={fn}>
                {fn}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
