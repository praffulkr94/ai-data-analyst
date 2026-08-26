/** The composer: the Question, the model picker, and one line saying what it cost.

    It is sticky to the bottom of the 1040px content column rather than to the window, and it is
    a fixed height. Both of those are load-bearing: a bottom-docked input that spans the viewport
    and grows is a chat shell, and this is not one. The readout that used to expand in place here
    — a `<details>` table and a JSON inspector — inflated the bar to 45vh, and it is now the
    single 11px line below the input. */
import { useState, type FormEvent } from 'react';
import { MODELS, MODEL_CHOICES } from '../ai/models';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';

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
    <div className="composer">
      <div className="composer-box">
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
          <div className="segmented" role="group" aria-label="Model">
            {MODEL_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={model === choice}
                title={MODELS[choice].note}
                onClick={() => setModel(choice)}
              >
                {MODELS[choice].label}
              </button>
            ))}
          </div>
          {inFlight ? (
            <button type="button" className="cancel" onClick={() => workspace.cancel()}>
              Cancel
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!canAsk || question.trim() === ''}>
              Ask
            </button>
          )}
        </form>
        <UsageLine />
      </div>
    </div>
  );
}

/** Tokens and cost, in one line.

    Every number is what the API reported on the stream — `message_start` for input and cache
    reads, `message_delta` for output. Never estimated, and never a second `count_tokens` call,
    which would cost a round trip to report on a round trip. The cached figure is shown
    separately on purpose: the minimum cacheable prefix is roughly 1,024 tokens and a shorter one
    silently fails to cache, so a caching claim that is not visible is one that is not checked. */
function UsageLine() {
  const usage = useApp((s) => s.usage);
  const mode = useApp((s) => s.mode);
  const model = useApp((s) => s.model);

  const last = usage.last;
  const recorded = last?.recorded ?? mode === 'demo';

  return (
    <p className="composer-foot">
      <span className="mode-note">
        {mode === 'demo'
          ? 'Demo mode replays recorded replies through the real validation and execution path.'
          : 'Your key, held in memory for this tab. Requests go straight from this browser to the API.'}
      </span>
      <span>{MODELS[last?.model ?? model].note}</span>
      <span className="divider" aria-hidden="true" />
      <span>
        {last ? (
          <>
            {num(last.inputTokens + last.cacheReadTokens)} in · {num(last.outputTokens)} out
            {last.cacheReadTokens > 0 && (
              <>
                {' · '}
                <span className="usage-cache" title="Served from the prompt cache at a tenth the price">
                  {num(last.cacheReadTokens)} cached
                </span>
              </>
            )}
            {' · '}
            {money(usage.cost)}
          </>
        ) : (
          'No questions asked yet'
        )}
      </span>
      {recorded && (
        <em className="tag" title="Replayed from a recording — nothing was charged">
          recorded
        </em>
      )}
    </p>
  );
}

const num = (n: number) => n.toLocaleString('en-US');
/** Sub-cent costs are the normal case here, so two decimals would read as free. */
const money = (n: number) => (n === 0 ? '$0.00' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
