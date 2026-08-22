/** A Clarification, an Unsupported reply, or a failure that spent both attempts.

    None of these is an Analysis. They have no spec and no result, so modelling them as empty
    Analyses would force the Revision stepper, undo, the hash state and the accessible table each
    to special-case an entry containing nothing — and the rail lists things you can return to,
    which a refusal is not (ADR-0014).

    The options and suggestions are chips that start a *new* Request, so a refusal is a fork in
    the flow rather than a dead end in the history. */
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';

export function Notice({ workspace }: { workspace: Workspace }) {
  const notice = useApp((s) => s.pendingNotice);
  const dismiss = useApp((s) => s.dismissNotice);
  if (!notice) return null;

  const chips = notice.kind === 'clarification' ? notice.options : notice.kind === 'unsupported' ? notice.suggestions : [];

  return (
    <section
      className={`panel notice-card ${notice.kind === 'failed' ? 'notice-error' : ''}`}
      role={notice.kind === 'failed' ? 'alert' : 'status'}
    >
      <div className="panel-head">
        <strong>
          {notice.kind === 'clarification'
            ? 'Which did you mean?'
            : notice.kind === 'unsupported'
              ? 'Outside what this can express'
              : 'That did not work'}
        </strong>
        <button type="button" className="ghost" onClick={dismiss}>
          Dismiss
        </button>
      </div>
      <p>
        {notice.kind === 'clarification'
          ? notice.question
          : notice.kind === 'unsupported'
            ? notice.reason
            : notice.message}
      </p>
      {notice.kind === 'failed' && notice.violations.length > 0 && (
        <ul className="violations">
          {notice.violations.map((v, i) => (
            <li key={i}>
              <code>{v.path}</code> — {v.message}
            </li>
          ))}
        </ul>
      )}
      {chips.length > 0 && (
        <ul className="chip-strip">
          {chips.map((chip) => (
            <li key={chip}>
              <button type="button" className="chip chip-button" onClick={() => void workspace.ask(chip)}>
                {chip}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
