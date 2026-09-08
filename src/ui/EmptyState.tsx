/** What stands on the canvas before there is an Analysis: the recorded repertoire in Demo mode,
    three sample Questions with a key.

    Both modes fill the composer rather than asking on the visitor's behalf. Sending the Question
    yourself is one click shorter and it skips the loop — a visitor who never watches a Question
    leave the composer has not been shown how this works, only what it produces.

    Demo mode lists the repertoire in full. Free text is disabled there, so these are not a
    suggestion strip beside an input — they are the whole set of Questions that can be asked, and
    saying which they are is the difference between a fixed repertoire and an interface that
    appears broken. A Fixture names columns, so only the ones recorded against the Dataset
    actually loaded are offered, and a refining Question needs something to refine, so it appears
    only once there is an Analysis on screen.

    With a key the list is three, from one cheap call at load. Three is a starter, not a
    repertoire: free text is open, so their whole job is to be something to click instead of an
    empty canvas. */
import { ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { repertoireFor } from '../ai/fixtures';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';

/** The grammar's ceiling, stated wherever a Question is being invited. It is the honest half of
    the old BYOK paragraph and it survives as one line under whichever list is on screen. */
const CEILING =
  'It cannot join, compare period over period, forecast, or answer “why” — the model never sees ' +
  'a row, so it writes a specification rather than a query.';

export function EmptyState({ workspace }: { workspace: Workspace }) {
  const mode = useApp((s) => s.mode);
  return mode === 'byok' ? <Suggested workspace={workspace} /> : <Repertoire />;
}

/** Three Questions this Dataset can answer, proposed once per Dataset by the model that would
    answer them. `workspace.suggest` is idempotent per Dataset, so an effect is the right place
    for it — a remount when the last Analysis is deleted costs nothing. */
function Suggested({ workspace }: { workspace: Workspace }) {
  const label = useApp((s) => s.datasetHandle?.label);
  const suggestions = useApp((s) => s.suggestions);

  useEffect(() => {
    void workspace.suggest();
  }, [workspace, label]);

  const questions = suggestions && suggestions.for === label ? suggestions.questions : null;

  // Nothing usable came back, or nothing was asked for. The grammar is still worth stating: it
  // is what a visitor facing an open input needs to know before they type into it.
  if (questions !== null && questions.length === 0) {
    return (
      <section className="notice">
        <div className="notice-head">
          <span className="title">Ask anything this grammar can express</span>
        </div>
        <p className="notice-body">
          Group by a column, bucket a date, aggregate a measure, filter, sort, limit, and draw one
          chart of it. {CEILING}
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="strip">
        <span>Questions to start with</span>
        <span className="plain">— or ask anything else about this Dataset</span>
      </div>
      {questions === null ? (
        <p className="card-body muted">Reading the columns for three Questions to start with…</p>
      ) : (
        <ul>
          {questions.map((question, i) => (
            <li key={question}>
              <Row n={i + 1} question={question} />
            </li>
          ))}
        </ul>
      )}
      <p className="card-foot">{CEILING}</p>
    </section>
  );
}

function Repertoire() {
  const ref = useApp((s) => s.datasetHandle?.ref);
  const hasAnalysis = useApp((s) => s.activeAnalysisId !== null);

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
            <Row n={i + 1} question={f.question} kind={kindOf(f.input)} />
          </li>
        ))}
      </ul>
      {/* Where the composer's own note about the replay went. It belongs to the list of
          Questions the replay can answer, not to the input that cannot be typed into. */}
      <p className="card-foot">
        Demo mode replays recorded replies through the real validation and execution path · a
        refining Question needs something to refine, so it appears once there is an Analysis on
        screen · switch to Your API key to ask anything
      </p>
    </section>
  );
}

/** One Question, which fills the composer. Not `workspace.ask`: the composer is where a Question
    is sent from, and a list that sends for you never shows that. */
function Row({ n, question, kind }: { n: number; question: string; kind?: string }) {
  const setDraft = useApp((s) => s.setDraft);
  return (
    <button type="button" className="list-row" onClick={() => setDraft(question)}>
      <span className="n">{n}</span>
      <span className="label">{question}</span>
      {kind && <span className="kind">{kind}</span>}
      <ChevronRight className="chevron" />
    </button>
  );
}

/** What the Question produces: a chart type, or the name of the refusal it is recorded as. */
const kindOf = (reply: ReturnType<typeof repertoireFor>[number]['input']): string =>
  reply.kind === 'analysis' ? reply.visualization.type : reply.kind;
