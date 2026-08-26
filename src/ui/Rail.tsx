import { navigate } from '../route';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';

/** The rail lists Analyses — things you can return to. A refusal is not one of them, which is
    why a Clarification is a transient notice rather than an entry here (ADR-0014).

    It starts shut, as 44px of icons: a quarter of the width is worth spending on a list only
    once there is a list. The one thing the shut strip still has to say is that a Revision landed
    somewhere the visitor cannot see — the dot — because a result that is silently invisible is
    the failure the updated marker exists to prevent. The stepper between an Analysis's Revisions
    is on the card, not here: the rail is for moving between Analyses. */
export function Rail({
  open,
  onToggle,
  workspace,
}: {
  open: boolean;
  onToggle: () => void;
  workspace: Workspace;
}) {
  const columns = useApp((s) => s.columns);
  const analyses = useApp((s) => s.analyses);
  const activeId = useApp((s) => s.activeAnalysisId);
  const saveNoteRead = useApp((s) => s.saveNoteRead);
  const readSaveNote = useApp((s) => s.readSaveNote);
  const selectAnalysis = useApp((s) => s.selectAnalysis);

  /** Starting a new Analysis is deselecting the current one: the canvas falls back to the
      repertoire, and the next Question lands on a new card rather than as a Revision. */
  const startNew = () => {
    selectAnalysis(null);
    navigate('home');
  };

  if (!open) {
    return (
      <nav className="rail-strip" aria-label="Analyses">
        <button
          type="button"
          className="icon-button"
          aria-label={`Analyses (${analyses.length})`}
          aria-expanded={false}
          onClick={onToggle}
        >
          <ChartIcon />
          {analyses.some((a) => a.updated) && <span className="updated-dot" aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="New analysis"
          onClick={startNew}
        >
          +
        </button>
      </nav>
    );
  }

  return (
    <nav className="rail" aria-label="Analyses">
      <div className="rail-head">
        <span>Analyses</span>
        <button type="button" className="close" aria-label="Collapse the rail" onClick={onToggle}>
          &lsaquo;
        </button>
      </div>

      <div className="rail-body">
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
                  {analysis.updated && <span className="rail-updated">updated</span>}
                  {analysis.revisions.length > 1 && (
                    <span className="rail-rev">
                      {analysis.at + 1}/{analysis.revisions.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="rail-delete"
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
            Analyses aren't saved — copy the link to keep the one you're looking at.
            <button type="button" className="close" aria-label="Got it" onClick={readSaveNote}>
              &times;
            </button>
          </p>
        )}
      </div>

      <div className="rail-foot">
        <button type="button" onClick={startNew}>
          <span className="muted">+</span>New analysis
        </button>
      </div>
    </nav>
  );
}

const ChartIcon = () => (
  <svg width="13" height="12" viewBox="0 0 13 12" aria-hidden="true" fill="currentColor">
    <rect x="0" y="7" width="3" height="5" rx="1" />
    <rect x="5" y="0" width="3" height="12" rx="1" />
    <rect x="10" y="4" width="3" height="8" rx="1" />
  </svg>
);
