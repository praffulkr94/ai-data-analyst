import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';

/** The rail lists Analyses — things you can return to. A refusal is not one of them, which is
    why a Clarification is a transient notice rather than an entry here (ADR-0014).

    The updated marker is here because the dispatcher can land a Revision on an Analysis the
    visitor is not looking at, and a result that is silently invisible is the failure that marker
    exists to prevent. The stepper between an Analysis's Revisions is on the card, not here: the
    rail is for moving between Analyses. */
export function Rail({ workspace }: { workspace: Workspace }) {
  const columns = useApp((s) => s.columns);
  const analyses = useApp((s) => s.analyses);
  const activeId = useApp((s) => s.activeAnalysisId);
  const saveNoteRead = useApp((s) => s.saveNoteRead);
  const readSaveNote = useApp((s) => s.readSaveNote);

  return (
    <nav className="rail" aria-label="Analyses">
      {analyses.length === 0 ? (
        <p className="rail-empty">
          {columns.length === 0
            ? 'Load a Dataset to begin.'
            : 'No analyses yet. Ask a question below.'}
        </p>
      ) : (
        <ul className="rail-list">
          {analyses.map((analysis) => (
            <li key={analysis.id} className="rail-row">
              <button
                type="button"
                className={analysis.id === activeId ? 'rail-item on' : 'rail-item'}
                aria-current={analysis.id === activeId}
                onClick={() => workspace.selectCard(analysis.id)}
              >
                <span className="rail-title">{analysis.title}</span>
                {analysis.revisions.length > 1 && (
                  <span className="muted"> · {analysis.revisions.length} revisions</span>
                )}
                {analysis.updated && <span className="rail-updated">updated</span>}
              </button>
              <button
                type="button"
                className="rail-delete ghost"
                aria-label={`Delete ${analysis.title}`}
                onClick={() => workspace.deleteCard(analysis.id)}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Once, quietly, next to the list, the first time there is more than one thing to lose.
          There is no persistence — that is the accepted price of having no backend — and the
          failure being guarded against is not losing the work but losing it silently, so a
          visitor reloads and concludes the application is broken. */}
      {analyses.length > 1 && !saveNoteRead && (
        <p className="rail-note" role="status">
          Analyses aren't saved — copy the link to keep the one you're looking at.{' '}
          <button type="button" className="link" onClick={readSaveNote}>
            Got it
          </button>
        </p>
      )}
    </nav>
  );
}
