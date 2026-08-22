import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';

/** The rail lists Analyses — things you can return to. A refusal is not one of them, which is
    why a Clarification is a transient notice rather than an entry here (ADR-0014). The Revision
    stepper and the updated marker arrive in milestone 6. */
export function Rail({ workspace }: { workspace: Workspace }) {
  const columns = useApp((s) => s.columns);
  const analyses = useApp((s) => s.analyses);
  const activeId = useApp((s) => s.activeAnalysisId);

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
            <li key={analysis.id}>
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
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
