/** The composer: the Question, the model picker, and — with a key — one line saying what it cost.

    It is sticky to the bottom of the 1040px content column rather than to the window, and it is
    a fixed height. Both of those are load-bearing: a bottom-docked input that spans the viewport
    and grows is a chat shell, and this is not one. The readout that used to expand in place here
    — a `<details>` table and a JSON inspector — inflated the bar to 45vh, and it is now the
    single 11px line below the input.

    What is *not* here any more is anything about the model or the cost in Demo mode. The line
    that named the model was written for BYOK and rendered in both, where it was worse than
    redundant: the replay stamps whichever choice is selected onto the recorded counts, so it
    said "Haiku 4.5 — no thinking" when no model had run at all. The facts it carried are now on
    the picker's own tooltip, where the control they describe is. And the token/cost readout was
    only ever specced for BYOK (DECISIONS §A1) — it leaked into Demo mode because this line did
    not branch on mode. */
import { useEffect, useRef, type FormEvent } from 'react';
import { MODELS, MODEL_CHOICES, priceNote, type ModelChoice } from '../ai/models';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';
import { Tip } from './Tip';

/** Why the picker is inert in Demo mode. It says only that, per the rule that a disabled control
    explains its own unavailability and nothing else — the model's price and thinking budget are
    facts about a choice that cannot be made here. */
const DEMO_TIP = ['Model choice needs your API key.', 'Demo mode replays recorded replies.'];

const tipFor = (choice: ModelChoice) => [MODELS[choice].note, priceNote(choice)];

export function Composer({ workspace }: { workspace: Workspace }) {
  const ready = useApp((s) => s.load.status === 'ready');
  const mode = useApp((s) => s.mode);
  const model = useApp((s) => s.model);
  const setModel = useApp((s) => s.setModel);
  const inFlight = useApp((s) => s.request !== null);
  const question = useApp((s) => s.draft);
  const setDraft = useApp((s) => s.setDraft);
  const input = useRef<HTMLInputElement>(null);

  const demo = mode === 'demo';

  /** A starter Question is filled in from a different component, so the caret has to follow it
      here or the visitor is left looking at a populated box that is not focused. Focusing an
      input that already has focus does nothing, which is what makes this safe to run on every
      keystroke rather than only on the ones that came from a click. */
  useEffect(() => {
    if (question !== '') input.current?.focus();
  }, [question]);

  /** Free text is Demo mode's one restriction: the Fixtures answer a fixed repertoire and
      nothing else. `readOnly` rather than `disabled`, so a Question chosen from the list above
      can still land here and be sent — which is the whole point of filling the composer instead
      of asking on the visitor's behalf. Nothing else can get in, so the Fixture Translator's
      refusal stays a guard rather than becoming a UX. */
  function submit(e: FormEvent): void {
    e.preventDefault();
    const text = question.trim();
    if (!text || !ready) return;
    setDraft('');
    void workspace.ask(text);
  }

  return (
    <div className="composer">
      <div className="composer-box">
        <form className="composer-row" onSubmit={submit}>
          <input
            ref={input}
            type="text"
            value={question}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              !ready
                ? 'Load a Dataset to ask a question'
                : demo
                  ? 'Choose a Question above — add a key to ask anything'
                  : 'Ask a question about this Dataset…'
            }
            readOnly={demo}
            disabled={!ready}
            aria-label="Question"
          />
          <div className="segmented" role="group" aria-label="Model">
            {MODEL_CHOICES.map((choice) => (
              <Tip key={choice} label={demo ? DEMO_TIP : tipFor(choice)}>
                {/* `aria-disabled`, not `disabled`: a natively disabled button receives no
                    pointer events, so the tooltip explaining why it is unavailable would never
                    open — and a reason only a mouse can reach is a reason nobody can. */}
                <button
                  type="button"
                  aria-pressed={model === choice}
                  aria-disabled={demo || undefined}
                  onClick={() => {
                    if (!demo) setModel(choice);
                  }}
                >
                  {MODELS[choice].label}
                </button>
              </Tip>
            ))}
          </div>
          {inFlight ? (
            <button type="button" className="cancel" onClick={() => workspace.cancel()}>
              Cancel
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!ready || question.trim() === ''}>
              Ask
            </button>
          )}
        </form>
        {!demo && <UsageLine />}
      </div>
    </div>
  );
}

/** Tokens and cost, in one line, and only with a key. Nothing else: the sentence about where the
    key is held describes the *mode*, so it is on the mode toggle's own tooltip in the header.

    Every number is what the API reported on the stream — `message_start` for input and cache
    reads, `message_delta` for output. Never estimated, and never a second `count_tokens` call,
    which would cost a round trip to report on a round trip. The cached figure is shown
    separately on purpose: the minimum cacheable prefix is roughly 1,024 tokens and a shorter one
    silently fails to cache, so a caching claim that is not visible is one that is not checked.

    The `recorded` tag survives for exactly one case: a session that asked in Demo mode and then
    switched to a key, where the last counts on screen really are a replay. It is not derived
    from the mode any more, because in Demo mode this whole line is gone. */
function UsageLine() {
  const usage = useApp((s) => s.usage);
  const last = usage.last;

  return (
    <p className="composer-foot">
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
      {last?.recorded && (
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
