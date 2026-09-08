/** A Clarification, an Unsupported reply, or a failure that spent both attempts.

    None of these is an Analysis. They have no spec and no result, so modelling them as empty
    Analyses would force the Revision stepper, undo, the hash state and the accessible table each
    to special-case an entry containing nothing — and the rail lists things you can return to,
    which a refusal is not (ADR-0014). The card says so out loud: *not saved as an analysis*.

    The options and suggestions are chips that start a *new* Request, so a refusal is a fork in
    the flow rather than a dead end in the history. And where the validator already knows the
    fix, the chip **is** the fix: a spec refused because `month` is categorical offers to retype
    that column and ask again, rather than describing what the visitor should go and do. */
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import type { Loader } from '../data/loader';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';

const HEADING = {
  clarification: 'Which did you mean?',
  unsupported: 'Outside what this can express',
  failed: 'That did not work',
} as const;

const STRIPE = {
  clarification: 'notice',
  unsupported: 'notice notice-warning',
  failed: 'notice notice-critical',
} as const;

/** Beside the heading, never instead of it. The left stripe is a colour and DECISIONS §A5 forbids
    colour carrying meaning alone, so the icon is a third redundant signal next to the words and
    the stripe — worth having because it is the one of the three that reads at a glance. */
const MARK = {
  clarification: Info,
  unsupported: TriangleAlert,
  failed: CircleAlert,
} as const;

export function Notice({ workspace, loader }: { workspace: Workspace; loader?: Loader }) {
  const notice = useApp((s) => s.pendingNotice);
  const dismiss = useApp((s) => s.dismissNotice);
  if (!notice) return null;

  const chips =
    notice.kind === 'clarification'
      ? notice.options
      : notice.kind === 'unsupported'
        ? notice.suggestions
        : [];

  /** Violations whose fix is a column type. `validate.ts` names the column; retyping it and
      re-asking the same Question is the whole repair. */
  const failed = notice.kind === 'failed' ? notice : null;
  const Mark = MARK[notice.kind];
  const retypable =
    failed && loader ? failed.violations.filter((v) => v.code === 'not-temporal' && v.column) : [];

  return (
    <section
      className={STRIPE[notice.kind]}
      role={notice.kind === 'failed' ? 'alert' : 'status'}
    >
      <div className="notice-head">
        <Mark className="notice-mark" />
        <span className="title">{HEADING[notice.kind]}</span>
        <span className="aside">not saved as an analysis</span>
        <button type="button" className="close" aria-label="Dismiss" onClick={dismiss}>
          <X />
        </button>
      </div>
      <p className="notice-body">
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
              <code>{v.path}</code>
              <span>{v.message}</span>
            </li>
          ))}
        </ul>
      )}

      {(chips.length > 0 || retypable.length > 0) && (
        <ul className="chip-strip">
          {retypable.map((v) => (
            <li key={v.path}>
              <button
                type="button"
                className="chip chip-button"
                onClick={() => {
                  void loader!.retype(v.column!, 'date');
                  if (failed?.question) void workspace.ask(failed.question);
                }}
              >
                Treat <code>{v.column}</code> as a date and retry
              </button>
            </li>
          ))}
          {chips.map((chip) => (
            <li key={chip}>
              <button
                type="button"
                className="chip chip-button"
                onClick={() => void workspace.ask(chip)}
              >
                {chip}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
