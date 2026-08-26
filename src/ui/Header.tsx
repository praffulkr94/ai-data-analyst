import { hasApiKey } from '../ai/anthropic';
import { navigate, type Route } from '../route';
import { useApp } from '../store';

/** The top bar: what is loaded, where you are, and which mode you are in.

    The Demo / Your API key toggle is persistent and works in both directions — not a one-way
    door (DECISIONS §A1). Switching to the key side opens the dialog unless a key is already in
    memory from earlier in the session; switching back keeps that key.

    Every value here is read through a selector rather than by destructuring the whole store: a
    Request in flight writes narration into the store on every frame, and a component that
    subscribes to all of it would re-render sixty times a second for text it does not show. */
export function Header({
  route,
  railOpen,
  onToggleRail,
  onWantKey,
}: {
  route: Route;
  railOpen: boolean;
  onToggleRail: () => void;
  onWantKey: () => void;
}) {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const datasetHandle = useApp((s) => s.datasetHandle);

  return (
    <header className="header">
      <button
        type="button"
        className="icon-button"
        aria-label="Analyses"
        aria-expanded={railOpen}
        onClick={onToggleRail}
      >
        <BarsIcon />
      </button>
      <span className="brand">Analyst</span>
      <span className="divider" aria-hidden="true" />
      {datasetHandle && (
        <button type="button" className="dataset-chip" onClick={() => navigate('data')}>
          <span className="dot" aria-hidden="true" />
          {datasetHandle.label}
          <span className="muted">{datasetHandle.rowCount.toLocaleString()} rows</span>
        </button>
      )}
      <div className="header-right">
        {datasetHandle && (
          <button
            type="button"
            className="ghost"
            aria-current={route === 'data'}
            onClick={() => navigate(route === 'data' ? 'home' : 'data')}
          >
            {route === 'data' ? 'Analysis' : 'Data'}
          </button>
        )}
        <div className="segmented" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}>
            Demo
          </button>
          <button
            type="button"
            aria-pressed={mode === 'byok'}
            onClick={() => (hasApiKey() ? setMode('byok') : onWantKey())}
          >
            Your API key
          </button>
        </div>
        <button
          type="button"
          className="icon-button bordered"
          aria-label={theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme'}
          onClick={toggleTheme}
        >
          <HalfDiscIcon />
        </button>
      </div>
    </header>
  );
}

const BarsIcon = () => (
  <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true" fill="currentColor">
    <rect y="0" width="12" height="1.5" rx="0.75" />
    <rect y="4.25" width="12" height="1.5" rx="0.75" />
    <rect y="8.5" width="12" height="1.5" rx="0.75" />
  </svg>
);

/** Half filled, half outlined — the same disc in either theme, so the control does not itself
    change appearance with the thing it toggles. */
const HalfDiscIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
    <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 0.75 A5.25 5.25 0 0 0 6 11.25 Z" fill="currentColor" />
  </svg>
);
