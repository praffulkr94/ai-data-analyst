/** The composer: the Question, the model picker, and the readout of what it cost.

    The streaming strip above the input is the payoff — a narration sentence typed live tells the
    visitor they were understood before any data moves, and the chip strip beside it fills in as
    the specification's fields become readable. Both are display only. */
import { useEffect, useState, type FormEvent } from 'react';
import { repertoireFor } from '../ai/fixtures';
import { MODELS, MODEL_CHOICES, type ModelChoice } from '../ai/models';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';
import { UsageReadout } from './UsageReadout';

export function Composer({ workspace }: { workspace: Workspace }) {
  const ready = useApp((s) => s.load.status === 'ready');
  const mode = useApp((s) => s.mode);
  const model = useApp((s) => s.model);
  const setModel = useApp((s) => s.setModel);
  const inFlight = useApp((s) => s.request !== null);
  const [question, setQuestion] = useState('');

  // Free text is disabled in Demo mode: the Fixtures answer a fixed repertoire and nothing else.
  const canAsk = ready && mode === 'byok';

  function submit(e: FormEvent): void {
    e.preventDefault();
    const text = question.trim();
    if (!text || !canAsk) return;
    setQuestion('');
    void workspace.ask(text);
  }

  return (
    <footer className="composer">
      <StreamStrip />
      {ready && mode === 'demo' && <Repertoire workspace={workspace} />}
      <form className="composer-row" onSubmit={submit}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            !ready
              ? 'Load a Dataset to ask a question'
              : canAsk
                ? 'Ask a question about this Dataset…'
                : 'Demo mode answers the Questions above — add a key to ask anything'
          }
          disabled={!canAsk}
          aria-label="Question"
        />
        <label className="model-picker">
          <span className="visually-hidden">Model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelChoice)}
            title={MODELS[model].note}
          >
            {MODEL_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {MODELS[choice].label}
              </option>
            ))}
          </select>
        </label>
        {inFlight ? (
          <button type="button" className="ghost" onClick={() => workspace.cancel()}>
            Cancel
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!canAsk || question.trim() === ''}>
            Ask
          </button>
        )}
      </form>
      {ready && <UsageReadout />}
    </footer>
  );
}

/** The demo repertoire, as chips. Free text is disabled in Demo mode, so these are not a
    convenience — they are the whole set of Questions that can be asked, and saying which they are
    is the difference between a fixed repertoire and an interface that appears broken.

    A Fixture names columns, so only the ones recorded against the Dataset actually loaded are
    offered. A refining Question needs something to refine, so it appears only once there is an
    Analysis on screen. */
function Repertoire({ workspace }: { workspace: Workspace }) {
  const ref = useApp((s) => s.datasetHandle?.ref);
  const hasAnalysis = useApp((s) => s.activeAnalysisId !== null);
  const inFlight = useApp((s) => s.request !== null);

  const fixtures = repertoireFor(ref?.kind === 'sample' ? ref.id : null).filter(
    (f) => hasAnalysis || f.input.kind !== 'analysis' || f.input.intent !== 'refine',
  );

  if (fixtures.length === 0) {
    return (
      <p className="composer-hint muted">
        Demo mode replays recorded answers, and none were recorded against this Dataset. Load{' '}
        <strong>International football matches</strong>, or switch to{' '}
        <strong>Your API key</strong> to ask anything.
      </p>
    );
  }

  return (
    <div className="repertoire">
      <p className="composer-hint muted" id="repertoire-hint">
        Demo mode answers these {fixtures.length} Questions, replaying recorded responses through
        the real validation and execution path. Switch to <strong>Your API key</strong> to ask
        anything.
      </p>
      <ul className="chip-strip" aria-labelledby="repertoire-hint">
        {fixtures.map((f) => (
          <li key={f.question}>
            <button
              type="button"
              className="chip chip-button"
              disabled={inFlight}
              onClick={() => void workspace.ask(f.question)}
            >
              {f.question}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ticks once a second, and only while there is something to count down. The deadline is in the
    store and the tick is not: a store that re-published every second would re-render everything
    subscribed to it for a number one element shows. */
function useCountdown(until: number | null): number {
  const [left, setLeft] = useState(() => remaining(until));
  useEffect(() => {
    setLeft(remaining(until));
    if (until === null) return;
    const timer = setInterval(() => setLeft(remaining(until)), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return left;
}

const remaining = (until: number | null) =>
  until === null ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000));

/** Subscribes to the Request slice and nothing else, so sixty narration flushes a second never
    re-render the rail or the chart. */
function StreamStrip() {
  const request = useApp((s) => s.request);
  const secondsLeft = useCountdown(request?.retryAt ?? null);
  if (!request) return null;
  return (
    <div className="stream" aria-live="polite">
      <span className="stream-status">
        {request.status === 'thinking'
          ? 'Thinking…'
          : request.status === 'repairing'
            ? 'Correcting…'
            : request.status === 'waiting'
              ? `${request.waiting} Retrying in ${secondsLeft}s`
              : 'Computing…'}
      </span>
      <p className="narration">{request.narration}</p>
      {request.chips.length > 0 && (
        <ul className="chip-strip">
          {request.chips.map((chip, i) => (
            <li key={`${chip}-${i}`} className="chip">
              {chip}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
