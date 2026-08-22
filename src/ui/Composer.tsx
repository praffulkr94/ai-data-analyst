/** The composer: the Question, the model picker, and the readout of what it cost.

    The streaming strip above the input is the payoff — a narration sentence typed live tells the
    visitor they were understood before any data moves, and the chip strip beside it fills in as
    the specification's fields become readable. Both are display only. */
import { useState, type FormEvent } from 'react';
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
                : 'Demo mode answers a fixed set of Questions'
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
      {ready && mode === 'demo' && (
        <p className="composer-hint muted">
          Demo mode replays recorded model responses through the real validation and execution
          path. Switch to <strong>Your API key</strong> to ask anything.
        </p>
      )}
      {ready && <UsageReadout />}
    </footer>
  );
}

/** Subscribes to the Request slice and nothing else, so sixty narration flushes a second never
    re-render the rail or the chart. */
function StreamStrip() {
  const request = useApp((s) => s.request);
  if (!request) return null;
  return (
    <div className="stream" aria-live="polite">
      <span className="stream-status">
        {request.status === 'thinking'
          ? 'Thinking…'
          : request.status === 'repairing'
            ? 'Correcting…'
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
