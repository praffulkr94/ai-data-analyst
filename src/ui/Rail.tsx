import { useApp } from '../store';

/** The rail lists Analyses — things you can return to. A refusal is not one of them, which is
    why a Clarification is a transient notice rather than an entry here (ADR-0014). Analyses
    arrive in milestone 6. */
export function Rail() {
  const columns = useApp((s) => s.columns);
  return (
    <nav className="rail" aria-label="Analyses">
      <p className="rail-empty">
        {columns.length === 0
          ? 'Load a Dataset to begin.'
          : 'No analyses yet. Ask a question below.'}
      </p>
    </nav>
  );
}
