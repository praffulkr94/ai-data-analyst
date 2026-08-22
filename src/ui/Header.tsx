import { hasApiKey } from '../ai/anthropic';
import { useApp } from '../store';

/** The Demo / Your API key toggle is persistent and works in both directions — not a one-way
    door (DECISIONS §A1). Switching to the key side opens the dialog unless a key is already in
    memory from earlier in the session; switching back keeps that key.

    Every value here is read through a selector rather than by destructuring the whole store: a
    Request in flight writes narration into the store on every frame, and a component that
    subscribes to all of it would re-render sixty times a second for text it does not show. */
export function Header({ onWantKey }: { onWantKey: () => void }) {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const datasetHandle = useApp((s) => s.datasetHandle);

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
        {mode === 'demo' && (
          <span className="tag" title="Responses are recorded; validation and execution are real">
            recorded responses, real execution
          </span>
        )}
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
            onClick={() => (hasApiKey() ? setMode('byok') : onWantKey())}
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
