/** The repertoire, in full, as the canvas's own surface.

    Free text is disabled in Demo mode, so these are not a suggestion strip beside an input —
    they are the whole set of Questions that can be asked. Saying which they are is the
    difference between a fixed repertoire and an interface that appears broken, which is why the
    heading claims the whole list rather than a selection.

    A Fixture names columns, so only the ones recorded against the Dataset actually loaded are
    offered. A refining Question needs something to refine, so it appears only once there is an
    Analysis on screen. */
import { repertoireFor } from '../ai/fixtures';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';

export function EmptyState({ workspace }: { workspace: Workspace }) {
  const ref = useApp((s) => s.datasetHandle?.ref);
  const mode = useApp((s) => s.mode);
  const hasAnalysis = useApp((s) => s.activeAnalysisId !== null);
  const inFlight = useApp((s) => s.request !== null);

  if (mode === 'byok') {
    return (
      <section className="notice">
        <div className="notice-head">
          <span className="title">Ask anything this grammar can express</span>
        </div>
        <p className="notice-body">
          Group by a column, bucket a date, aggregate a measure, filter, sort, limit, and draw one
          chart of it. It cannot join, compare period over period, forecast, or answer “why” —
          the model never sees a row, so it writes a specification rather than a query.
        </p>
      </section>
    );
  }

  const fixtures = repertoireFor(ref?.kind === 'sample' ? ref.id : null).filter(
    (f) => hasAnalysis || f.input.kind !== 'analysis' || f.input.intent !== 'refine',
  );

  if (fixtures.length === 0) {
    return (
      <section className="notice notice-warning">
        <div className="notice-head">
          <span className="title">Nothing was recorded against this Dataset</span>
        </div>
        <p className="notice-body">
          Demo mode replays recorded answers. Load <strong>International football matches</strong>,
          or switch to <strong>Your API key</strong> to ask anything.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="strip">
        <span>The Questions demo mode can answer</span>
        <span className="plain">— the whole recorded repertoire, not a selection</span>
      </div>
      <ul>
        {fixtures.map((f, i) => (
          <li key={f.question}>
            <button
              type="button"
              className="list-row"
              disabled={inFlight}
              onClick={() => void workspace.ask(f.question)}
            >
              <span className="n">{i + 1}</span>
              <span className="label">{f.question}</span>
              <span className="kind">{kindOf(f.input)}</span>
              <span className="chevron" aria-hidden="true">
                &rsaquo;
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="card-foot">
        A refining Question needs something to refine, so it appears once there is an Analysis on
        screen · switch to Your API key to ask anything
      </p>
    </section>
  );
}

/** What the Question produces: a chart type, or the name of the refusal it is recorded as. */
const kindOf = (reply: ReturnType<typeof repertoireFor>[number]['input']): string =>
  reply.kind === 'analysis' ? reply.visualization.type : reply.kind;
