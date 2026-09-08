/** The active Analysis: its title, the Revision on screen, the stepper between Revisions, the
    two manual controls, the chart, and the two disclosures under it.

    The controls are the milestone's argument. A spec only the model can write is
    indistinguishable from blindly rendered model output; a spec two editors can write is
    demonstrably an object the application owns. Both editors produce the same Revision. */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AnalysisChart } from '../chart/AnalysisChart';
import {
  aggregationOptions,
  chartTypeOptions,
  metricAggregation,
  withAggregation,
  withChartType,
} from '../spec/edits';
import { formatSpec } from '../spec/format';
import type { AggregationFn, AnalysisSpec } from '../spec/grammar';
import { useApp } from '../store';
import type { SliceCache } from '../table/sliceCache';
import type { Workspace } from '../workspace/workspace';
import { DrillDown } from './DataTable';

export function AnalysisCard({
  workspace,
  cache,
}: {
  workspace: Workspace;
  /** Absent where there is no worker to read rows from — the card is then the chart and its
      specification, with no drill-down under them. */
  cache?: SliceCache;
}) {
  const analysis = useApp((s) => s.analyses.find((a) => a.id === s.activeAnalysisId) ?? null);
  const stepRevision = useApp((s) => s.stepRevision);
  const id = analysis?.id ?? null;
  const [asTable, setAsTable] = useState(false);

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
  const spec = revision.spec;

  return (
    <section className="card analysis">
      <div className="card-head">
        <div className="card-title-row">
          <h2>{analysis.title}</h2>
          <span className="spacer" style={{ flex: 1 }} />
          {count > 1 && (
            <div className="stepper segmented" role="group" aria-label="Revisions">
              <button
                type="button"
                onClick={() => stepRevision(analysis.id, -1)}
                disabled={analysis.at === 0}
                aria-label="Previous revision"
                title="Cmd+Z"
              >
                <ChevronLeft />
              </button>
              <span aria-live="polite">
                {analysis.at + 1}/{count}
              </span>
              <button
                type="button"
                onClick={() => stepRevision(analysis.id, 1)}
                disabled={analysis.at === count - 1}
                aria-label="Next revision"
                title="Shift+Cmd+Z"
              >
                <ChevronRight />
              </button>
            </div>
          )}
          <CopyLink />
        </div>
        <p className="narration">{spec.narration}</p>
      </div>

      <Controls
        workspace={workspace}
        spec={spec}
        asTable={asTable}
        onToggleTable={() => setAsTable((v) => !v)}
      />

      <div className="card-body">
        <AnalysisChart
          result={revision.result}
          visualization={spec.visualization}
          table={{ shown: asTable, onToggle: () => setAsTable((v) => !v) }}
        />
      </div>

      <div>
        <details className="disclosure">
          <summary>view the query the model wrote</summary>
          <pre className="dsl">{formatSpec(spec)}</pre>
          <p className="dsl-note">
            Read-only. The specification is edited through the controls above, never as text.
          </p>
        </details>
        {cache && <DrillDown cache={cache} />}
      </div>
    </section>
  );
}

/** The link is the hash, which `trackSession` already keeps in step with the Analysis on screen
    — so this copies the address bar rather than building anything. */
function CopyLink() {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(location.href);
        setDone(true);
        setTimeout(() => setDone(false), 1_500);
      }}
    >
      {done ? 'Copied' : 'Copy link'}
    </button>
  );
}

/** The chart-type toggle, the aggregation dropdown, and the table switch. Axis and field pickers
    are a chart builder, which is a different product (DECISIONS §11).

    Both editors offer only what the semantic validator accepts, so a control cannot propose an
    analysis the application would then refuse. */
function Controls({
  workspace,
  spec,
  asTable,
  onToggleTable,
}: {
  workspace: Workspace;
  spec: AnalysisSpec;
  asTable: boolean;
  onToggleTable: () => void;
}) {
  const columns = useApp((s) => s.columns);
  const schema = useMemo(() => ({ columns }), [columns]);
  const types = chartTypeOptions(spec, schema);
  const fns = aggregationOptions(spec, schema);
  const metric = metricAggregation(spec);

  return (
    <div className="card-bar">
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
      <span className="spacer" />
      <button type="button" aria-pressed={asTable} onClick={onToggleTable}>
        {asTable ? 'View as chart' : 'View as table'}
      </button>
    </div>
  );
}
