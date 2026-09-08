import { ChartColumn, ChevronDown, Contrast, PanelLeft } from 'lucide-react';
import { hasApiKey } from '../ai/anthropic';
import { navigate, type Route } from '../route';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';
import { DatasetMenu } from './DatasetMenu';
import { Tip } from './Tip';

/** The top bar: what is loaded, where you are, and which mode you are in.

    The chip that names the Dataset is the control that switches it — see `DatasetMenu`. The
    Data button beside it is now the only route to `#/data`, and it is not rendered while the
    inference gate stands in front of the workspace.

    The brand starts the session again — no Dataset, no thread, back on the picker with a clean
    address. It is a reset and not a route: the picker is by definition the screen with nothing
    loaded behind it, so "go to the picker" without dropping the Dataset would be a panel you
    back out of rather than a home screen. `workspace.reset` says the rest.

    The Demo / Your API key toggle is persistent and works in both directions — not a one-way
    door (DECISIONS §A1). Switching to the key side opens the dialog unless a key is already in
    memory from earlier in the session; switching back keeps that key. Either direction clears
    the thread and lands on the picker — `workspace.setMode` says why.

    Each half of that toggle says on hover what the mode actually does with a key. That sentence
    used to sit permanently under the composer's input, which is the wrong place twice over: it
    describes the mode rather than the Question, and it was on screen in the one mode where it is
    not true.

    Every value here is read through a selector rather than by destructuring the whole store: a
    Request in flight writes narration into the store on every frame, and a component that
    subscribes to all of it would re-render sixty times a second for text it does not show. */
export function Header({
  route,
  railOpen,
  workspace,
  onToggleRail,
  onWantKey,
}: {
  route: Route;
  railOpen: boolean;
  workspace: Workspace;
  onToggleRail: () => void;
  onWantKey: () => void;
}) {
  const mode = useApp((s) => s.mode);
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const datasetHandle = useApp((s) => s.datasetHandle);
  const inferring = useApp((s) => s.load.status === 'inferring');

  return (
    <header className="header">
      <button
        type="button"
        className="icon-button"
        aria-label="Analyses"
        aria-expanded={railOpen}
        onClick={onToggleRail}
      >
        <PanelLeft />
      </button>
      <button
        type="button"
        className="brand"
        title="Start again"
        onClick={() => workspace.reset()}
      >
        <ChartColumn />
        Analyst
      </button>
      <span className="divider" aria-hidden="true" />
      {datasetHandle && (
        <DatasetMenu workspace={workspace} className="dataset-chip">
          <span className="dot" aria-hidden="true" />
          {datasetHandle.label}
          <span className="muted">{datasetHandle.rowCount.toLocaleString()} rows</span>
          <ChevronDown className="menu-caret" />
        </DatasetMenu>
      )}
      <div className="header-right">
        {/* Not while the gate is up: the gate *is* the data surface at that moment, so there
            is nothing for this to go to, and a live-looking control that does nothing is worse
            than no control. The chip beside it stays, because it still works. */}
        {datasetHandle && !inferring && (
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
          <Tip label={DEMO_MODE_TIP} side="bottom">
            <button
              type="button"
              aria-pressed={mode === 'demo'}
              onClick={() => workspace.setMode('demo')}
            >
              Demo
            </button>
          </Tip>
          <Tip label={KEY_MODE_TIP} side="bottom">
            <button
              type="button"
              aria-pressed={mode === 'byok'}
              onClick={() => (hasApiKey() ? workspace.setMode('byok') : onWantKey())}
            >
              Your API key
            </button>
          </Tip>
        </div>
        <button
          type="button"
          className="icon-button bordered"
          aria-label={theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme'}
          onClick={toggleTheme}
        >
          <Contrast />
        </button>
      </div>
    </header>
  );
}

/** What each mode is, and the one fact about a key worth stating before it is pasted: it is held
    in memory and it goes nowhere but the API. There is no backend to send it to. */
const KEY_MODE_TIP = [
  'Ask anything this Dataset can answer.',
  'Your key, held in memory for this tab. Requests go straight from this browser to the API.',
];

const DEMO_MODE_TIP = [
  'Answers a fixed set of Questions, with no key.',
  'Recorded replies, replayed through the real validation and execution path.',
];

/* The theme control is lucide's `Contrast` — half filled, half outlined. It is the same disc in
   either theme on purpose, so the control does not itself change appearance with the thing it
   toggles, which is the one property the hand-rolled icon it replaces was drawn for. */
