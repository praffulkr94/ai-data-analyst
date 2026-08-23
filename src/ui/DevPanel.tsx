/** A hand-typed AnalysisSpec, validated and executed by the application, rendering a chart with
    no model anywhere in the path.

    This is the proof that milestone 3 exists for: the pipeline is application-owned, not a thin
    skin over model output. The AI layer arriving in milestone 5 replaces exactly one thing — who
    writes the JSON in this textarea. */
import { useState } from 'react';
import { armFault, type Fault } from '../ai/faults';
import { repertoireFor } from '../ai/fixtures';
import { AnalysisChart } from '../chart/AnalysisChart';
import type { AnalysisResult } from '../engine/result';
import { ModelReply, specFromReply, type AnalysisSpec } from '../spec/grammar';
import { validateSpec, type SpecViolation } from '../spec/validate';
import { useApp } from '../store';
import type { DataPort } from '../worker/port';
import type { Workspace } from '../workspace/workspace';

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

export function DevPanel({
  port,
  workspace,
  onWantKey,
}: {
  port: DataPort;
  workspace: Workspace;
  onWantKey: () => void;
}) {
  const columns = useApp((s) => s.columns);
  const [text, setText] = useState(EXAMPLE);
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });

  async function run(source = text): Promise<void> {
    // Structural first: Zod on shapes, enums and required fields, dataset-independent.
    let json: unknown;
    try {
      json = JSON.parse(source);
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
      chartType: spec.visualization.type,
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
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="ghost"
            onClick={() => {
              setText(preset.spec);
              void run(preset.spec);
            }}
          >
            {preset.label}
          </button>
        ))}
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

      <FailurePanel workspace={workspace} onWantKey={onWantKey} />
    </details>
  );
}

/** Every failure the taxonomy names, one click each (DECISIONS §18).

    They are armed rather than drawn: the fault damages the reply the Fixture Translator returns
    and everything after that is the real path — the same structural parse, the same semantic
    validator, the same single Repair, the same notice. A panel that rendered a picture of each
    failure would demonstrate the panel. */
function FailurePanel({
  workspace,
  onWantKey,
}: {
  workspace: Workspace;
  onWantKey: () => void;
}) {
  const ref = useApp((s) => s.datasetHandle?.ref);
  const repertoire = repertoireFor(ref?.kind === 'sample' ? ref.id : null);
  const ask = repertoire.find((f) => f.input.kind === 'analysis')?.question;
  const clarify = repertoire.find((f) => f.input.kind === 'clarification')?.question;
  const unsupported = repertoire.find((f) => f.input.kind === 'unsupported')?.question;

  /** Arm the fault, then ask. `times` is what separates the glitch the Repair hides from the
      one the visitor is told about. */
  const withFault = (fault: Fault, times: number) => () => {
    if (!ask) return;
    armFault(fault, times);
    void workspace.ask(ask);
  };

  if (!ask) {
    return (
      <p className="muted">
        The failure demonstrations replay a recorded reply and damage it, so they need a Dataset
        the demo repertoire was recorded against.
      </p>
    );
  }

  return (
    <section className="dev-failures">
      <h3>Failure states</h3>
      <p className="muted">
        Each arms a real failure on the next Question and asks it. Watch the composer and the
        notice, not this panel.
      </p>
      <ul className="dev-actions">
        <Fail label="Invalid key" onClick={onWantKey} note="paste anything; it is rejected in the dialog" />
        <Fail
          label="User cancel"
          note="the stream is torn down and nothing is left behind"
          onClick={() => {
            void workspace.ask(ask);
            setTimeout(() => workspace.cancel(), 700);
          }}
        />
        <Fail
          label="Raced response"
          note="two Questions, only the second lands"
          onClick={() => {
            void workspace.ask(ask);
            void workspace.ask(ask);
          }}
        />
        <Fail
          label="Malformed reply, repaired"
          note="one glitch the single Repair hides"
          onClick={withFault('malformed', 1)}
        />
        <Fail
          label="Malformed twice"
          note="two attempts, then a recoverable notice"
          onClick={withFault('malformed', 2)}
        />
        <Fail
          label="Unknown column"
          note="names the column and lists the valid ones"
          onClick={withFault('unknown-column', 2)}
        />
        <Fail
          label="Reply out of room"
          note="a max_tokens stop spends the same single Repair"
          onClick={withFault('max-tokens', 2)}
        />
        <Fail
          label="Prose, no tool call"
          note="also structural, also one Repair"
          onClick={withFault('no-tool', 2)}
        />
        <Fail
          label="Rate limited"
          note="a visible countdown, then it succeeds"
          onClick={withFault('rate-limit', 1)}
        />
        <Fail
          label="Overloaded"
          note="two waits, then it gives up and says so"
          onClick={withFault('overloaded', 3)}
        />
        {clarify && (
          <Fail
            label="Clarification"
            note="a transient notice with chips, never an Analysis"
            onClick={() => void workspace.ask(clarify)}
          />
        )}
        {unsupported && (
          <Fail
            label="Unsupported"
            note="the boundary named, with nearby Questions"
            onClick={() => void workspace.ask(unsupported)}
          />
        )}
      </ul>
    </section>
  );
}

const Fail = ({
  label,
  note,
  onClick,
}: {
  label: string;
  note: string;
  onClick: () => void;
}) => (
  <li>
    <button type="button" className="ghost" onClick={onClick} title={note}>
      {label}
    </button>
  </li>
);

/** Specifications rather than screenshots: the degenerate states, and the scatter that is the
    whole of M8. Executed through the same textarea above, so what they prove is that these come
    out of the pipeline rather than out of a mock. */
const PRESETS = [
  {
    label: 'Empty result',
    spec: EXAMPLE.replace(
      '"filters": [],',
      '"filters": [{ "op": "eq", "column": "city", "value": "Atlantis" }],',
    ),
  },
  {
    label: 'Too many marks',
    spec: `{
  "kind": "analysis",
  "intent": "new",
  "title": "Matches per day",
  "narration": "Counting matches for every single day, which is more bars than a chart can hold.",
  "operation": {
    "filters": [],
    "groupBy": [],
    "timeBucket": { "column": "date", "unit": "day" },
    "aggregations": [{ "id": "m", "fn": "count", "column": null, "label": "matches" }],
    "derived": [],
    "sort": { "by": "date", "dir": "asc" },
    "limit": null
  },
  "visualization": { "type": "bar", "x": "date", "y": "m", "seriesBy": null }
}`,
  },
  {
    /** Load the `team_matches` sample first — the columns are that file's. 98,899 (date, team)
        pairs, one per row of the file bar the teams that played twice in a day, and both axes
        are measures, which is what makes it a scatter rather than a bar chart of pairs.

        Two small integers overplot onto a grid, because nothing in this Dataset is continuous.
        That is the honest shape of it: what is being demonstrated is 98,899 points drawn,
        panned and hit-tested, and the count is in the caption and the table. */
    label: '98,899-point scatter (team_matches)',
    spec: `{
  "kind": "analysis",
  "intent": "new",
  "title": "Goals for against goals against",
  "narration": "One point per team-match, both axes measures — 98,899 of them.",
  "operation": {
    "filters": [],
    "groupBy": ["date", "team"],
    "timeBucket": null,
    "aggregations": [
      { "id": "gf", "fn": "sum", "column": "goals_for", "label": "goals for" },
      { "id": "ga", "fn": "sum", "column": "goals_against", "label": "goals against" }
    ],
    "derived": [],
    "sort": null,
    "limit": null
  },
  "visualization": { "type": "scatter", "x": "gf", "y": "ga", "seriesBy": null }
}`,
  },
];

const issue = (i: { path: PropertyKey[]; message: string }) =>
  `${i.path.join('.') || '(root)'}: ${i.message}`;
