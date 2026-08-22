/** A hand-typed AnalysisSpec, validated and executed by the application, rendering a chart with
    no model anywhere in the path.

    This is the proof that milestone 3 exists for: the pipeline is application-owned, not a thin
    skin over model output. The AI layer arriving in milestone 5 replaces exactly one thing — who
    writes the JSON in this textarea. */
import { useState } from 'react';
import { AnalysisChart } from '../chart/AnalysisChart';
import type { AnalysisResult } from '../engine/result';
import { ModelReply, specFromReply, type AnalysisSpec } from '../spec/grammar';
import { validateSpec, type SpecViolation } from '../spec/validate';
import { useApp } from '../store';
import type { DataPort } from '../worker/port';

const EXAMPLE = `{
  "kind": "analysis",
  "intent": "new",
  "title": "Matches by city",
  "narration": "Counting matches for each host city.",
  "operation": {
    "filters": [],
    "groupBy": ["city"],
    "timeBucket": null,
    "aggregations": [{ "id": "m", "fn": "count", "column": null, "label": "matches" }],
    "derived": [],
    "sort": { "by": "m", "dir": "desc" },
    "limit": null
  },
  "visualization": { "type": "bar", "x": "city", "y": "m", "seriesBy": null }
}`;

type Outcome =
  | { state: 'idle' }
  | { state: 'structural'; message: string }
  | { state: 'semantic'; violations: SpecViolation[] }
  | { state: 'done'; spec: AnalysisSpec; result: AnalysisResult };

export function DevPanel({ port }: { port: DataPort }) {
  const columns = useApp((s) => s.columns);
  const [text, setText] = useState(EXAMPLE);
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });

  async function run(): Promise<void> {
    // Structural first: Zod on shapes, enums and required fields, dataset-independent.
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      setOutcome({ state: 'structural', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    const parsed = ModelReply.safeParse(json);
    if (!parsed.success) {
      setOutcome({ state: 'structural', message: parsed.error.issues.map(issue).join('\n') });
      return;
    }
    if (parsed.data.kind !== 'analysis') {
      setOutcome({
        state: 'structural',
        message: `This is a ${parsed.data.kind} reply, which carries no spec to execute.`,
      });
      return;
    }

    // Then semantic: against the DatasetSchema actually loaded.
    const spec = specFromReply(parsed.data);
    const violations = validateSpec(spec, { columns });
    if (violations.length > 0) {
      setOutcome({ state: 'semantic', violations });
      return;
    }

    const res = await port.send({
      type: 'analyze',
      operation: spec.operation,
      metric: spec.visualization.y,
      seriesBy: spec.visualization.seriesBy,
    }).done;
    if (res.type === 'analyze:done') setOutcome({ state: 'done', spec, result: res.result });
    else if (res.type === 'error') setOutcome({ state: 'structural', message: res.message });
  }

  return (
    <details className="dev-panel" open>
      <summary>Hand-typed specification</summary>
      <p className="muted">
        No model is involved. The application validates this against the loaded DatasetSchema,
        executes it in the worker, and draws the result.
      </p>
      <textarea
        aria-label="AnalysisSpec as JSON"
        spellCheck={false}
        rows={14}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="dev-actions">
        <button type="button" className="primary" onClick={() => void run()}>
          Execute
        </button>
        <button type="button" className="ghost" onClick={() => setText(EXAMPLE)}>
          Reset
        </button>
      </div>

      {outcome.state === 'structural' && (
        <pre className="notice notice-error" role="alert">
          {outcome.message}
        </pre>
      )}

      {outcome.state === 'semantic' && (
        <div className="notice notice-error" role="alert">
          <strong>{outcome.violations.length} violations.</strong>
          <ul>
            {outcome.violations.map((v, i) => (
              <li key={i}>
                <code>{v.path}</code> — {v.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {outcome.state === 'done' && (
        <section className="analysis">
          <h3>{outcome.spec.title}</h3>
          <p className="narration">{outcome.spec.narration}</p>
          <AnalysisChart result={outcome.result} visualization={outcome.spec.visualization} />
        </section>
      )}
    </details>
  );
}

const issue = (i: { path: PropertyKey[]; message: string }) =>
  `${i.path.join('.') || '(root)'}: ${i.message}`;
