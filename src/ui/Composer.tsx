/** The composer: the Question, the model picker, and — with a key — what the last one cost.

    Two rows inside one box, which is the shape of every composer a visitor has used: the Question
    across the full width, and the controls under it. The Question is a textarea that grows a line
    at a time to `MAX_TEXT_HEIGHT` and then scrolls, so a Question three lines long is one you can
    read while writing it — a single line that scrolls sideways is not.

    It is sticky to the bottom of the 1040px content column rather than to the window, and it is
    *bounded* rather than fixed. Both of those are load-bearing: a bottom-docked input that spans
    the viewport and grows without limit is a chat shell, and this is not one. The readout that
    used to expand in place here — a `<details>` table and a JSON inspector — inflated the bar to
    45vh, and it is now eleven pixels of text in the control row. Folding it into that row is
    what pays for most of the taller input: the line it used to have to itself was 23px, so the
    bar rests at 85px rather than the 71px it would have cost with both.

    What is *not* here any more is anything about the model or the cost in Demo mode. The line
    that named the model was written for BYOK and rendered in both, where it was worse than
    redundant: the replay stamps whichever choice is selected onto the recorded counts, so it
    said "Haiku 4.5 — no thinking" when no model had run at all. The facts it carried are now on
    the picker's own tooltip, where the control they describe is. And the token/cost readout was
    only ever specced for BYOK (DECISIONS §A1) — it leaked into Demo mode because this line did
    not branch on mode. */
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { MODELS, MODEL_CHOICES, priceNote, type ModelChoice } from '../ai/models';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';
import { Tip } from './Tip';

/** Why the picker is inert in Demo mode. It says only that, per the rule that a disabled control
    explains its own unavailability and nothing else — the model's price and thinking budget are
    facts about a choice that cannot be made here. */
const DEMO_TIP = ['Model choice needs your API key.', 'Demo mode replays recorded replies.'];

const tipFor = (choice: ModelChoice) => [MODELS[choice].note, priceNote(choice)];

/** What Demo mode says where the token readout would be. The row below the Question holds the
    picker on the left and Ask on the right, and with no key there is nothing between them — this
    is the one fact that belongs in that gap, and it is about the reply rather than the mode. The
    longer sentence about the replay path is on the repertoire's own foot line. */
const DEMO_NOTE = 'Recorded reply · no key needed';

/** The cap, in pixels of text. Eight 20px lines: longer than any Question this grammar can
    express, and about a fifth of a 900px viewport. Past it the box stops growing and the caret
    scrolls inside it — an input docked at the bottom that grows without limit is a chat shell. */
const MAX_TEXT_HEIGHT = 160;

export function Composer({ workspace }: { workspace: Workspace }) {
  const ready = useApp((s) => s.load.status === 'ready');
  const mode = useApp((s) => s.mode);
  const model = useApp((s) => s.model);
  const setModel = useApp((s) => s.setModel);
  const inFlight = useApp((s) => s.request !== null);
  const question = useApp((s) => s.draft);
  const setDraft = useApp((s) => s.setDraft);
  const input = useRef<HTMLTextAreaElement>(null);

  const demo = mode === 'demo';

  /** A starter Question is filled in from a different component, so the caret has to follow it
      here or the visitor is left looking at a populated box that is not focused. Focusing an
      input that already has focus does nothing, which is what makes this safe to run on every
      keystroke rather than only on the ones that came from a click.

      The height is set here rather than on change for the same reason: the draft is the store's,
      so a Question that arrives from the list above has to size the box exactly as typing does.
      Measuring needs the height released first — `scrollHeight` of an element pinned to a height
      is that height. No `overflow` toggle: the height only falls short of the content at the cap,
      which is the one moment a scrollbar should appear, and `auto` shows it then and not before. */
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    if (question !== '') el.focus();
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXT_HEIGHT)}px`;
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

  /** A textarea does not submit its form on Enter, so the send has to be re-established by hand
      — and once it is, Shift+Enter is the newline. Nothing is intercepted while the browser is
      composing (an IME candidate list takes Enter to commit a character, and stealing it there
      sends half a word). */
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit(e);
  }

  return (
    <div className="composer">
      {/* The box is the form: the Question on its own line, then one row of controls under it.
          The token readout is in that row rather than on a line of its own below it, which is
          what pays for the taller input — the resting height is what it was as a single line. */}
      <form className="composer-box" onSubmit={submit}>
        <textarea
          ref={input}
          className="composer-text"
          rows={1}
          value={question}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={keyDown}
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
        <div className="composer-row">
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
          {demo ? (
            <span className="composer-usage">
              <span>{DEMO_NOTE}</span>
            </span>
          ) : (
            <UsageLine />
          )}
          {inFlight ? (
            <button type="button" className="cancel" onClick={() => workspace.cancel()}>
              Cancel
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!ready || question.trim() === ''}>
              Ask
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Tokens and cost, and only with a key. It sits between the picker and Ask, in the control row
    under the Question, rather than on a line of its own — a second line of chrome under a box
    that now grows is height spent on eleven pixels of text. Nothing else: the sentence about
    where the key is held describes the *mode*, so it is on the mode toggle's own tooltip.

    Every number is what the API reported on the stream — `message_start` for input and cache
    reads, `message_delta` for output. Never estimated, and never a second `count_tokens` call,
    which would cost a round trip to report on a round trip. The cached figure is shown
    separately on purpose: the minimum cacheable prefix is roughly 1,024 tokens and a shorter one
    silently fails to cache, so a caching claim that is not visible is one that is not checked.

    The `recorded` tag survives for exactly one case: a session that asked in Demo mode and then
    switched to a key, where the last counts on screen really are a replay. It is not derived
    from the mode any more, because in Demo mode this is replaced by `DEMO_NOTE`. */
function UsageLine() {
  const usage = useApp((s) => s.usage);
  const last = usage.last;

  return (
    <span className="composer-usage">
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
    </span>
  );
}

const num = (n: number) => n.toLocaleString('en-US');
/** Sub-cent costs are the normal case here, so two decimals would read as free. */
const money = (n: number) => (n === 0 ? '$0.00' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
