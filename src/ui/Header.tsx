import { useApp } from '../store';

/** The Demo / Your API key toggle is persistent and works in both directions — not a one-way
    door (DECISIONS §A1). The key dialog behind it arrives in milestone 5. */
export function Header() {
  const { mode, setMode, theme, toggleTheme, datasetHandle } = useApp();
  return (
    <header className="header">
      <span className="brand">AI Data Analyst</span>
      {datasetHandle && (
        <span className="dataset-chip" title={`${datasetHandle.rowCount.toLocaleString()} rows`}>
          {datasetHandle.label}
          <span className="muted"> · {datasetHandle.rowCount.toLocaleString()} rows</span>
        </span>
      )}
      <div className="header-right">
        <div className="segmented" role="group" aria-label="Mode">
          <button
            type="button"
            aria-pressed={mode === 'demo'}
            className={mode === 'demo' ? 'on' : ''}
            onClick={() => setMode('demo')}
          >
            Demo
          </button>
          <button
            type="button"
            aria-pressed={mode === 'byok'}
            className={mode === 'byok' ? 'on' : ''}
            onClick={() => setMode('byok')}
          >
            Your API key
          </button>
        </div>
        <button type="button" className="ghost" onClick={toggleTheme}>
          {theme === 'light' ? 'Dark' : 'Light'}
        </button>
      </div>
    </header>
  );
}
