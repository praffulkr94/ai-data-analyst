import { useLayoutEffect, useState } from 'react';
import type { Loader } from './data/loader';
import type { Route } from './route';
import type { SliceCache } from './table/sliceCache';
import type { Workspace } from './workspace/workspace';
import { AnalysisCard } from './ui/AnalysisCard';
import { Composer } from './ui/Composer';
import { DataSurface } from './ui/DataTable';
import { DatasetPicker } from './ui/DatasetPicker';
import { EmptyState } from './ui/EmptyState';
import { Header } from './ui/Header';
import { InferenceGate } from './ui/InferenceGate';
import { InFlight } from './ui/InFlight';
import { KeyDialog } from './ui/KeyDialog';
import { LoadNews } from './ui/LoadNews';
import { LoadStage } from './ui/LoadStage';
import { Notice } from './ui/Notice';
import { Rail } from './ui/Rail';
import { TipProvider } from './ui/Tip';
import { useLightDismiss } from './ui/lightDismiss';
import { useApp } from './store';

export function App({
  route,
  loader,
  cache,
  workspace,
  wantsKey = false,
}: {
  /** Which surface is on screen. `#/data` is the rows and their types; `#/` is the analysis. */
  route: Route;
  loader: Loader;
  cache: SliceCache;
  workspace: Workspace;
  /** The reloaded link said BYOK. The key went with the tab, so the dialog opens rather than
      the mode quietly reverting to Demo behind the visitor's back. */
  wantsKey?: boolean;
}) {
  const theme = useApp((s) => s.theme);
  const status = useApp((s) => s.load.status);
  const hasDataset = useApp((s) => s.datasetHandle !== null);
  /** The strip's dismissal belongs to the Dataset it is about, so a switch brings back a strip
      the last one's × had closed. */
  const datasetLabel = useApp((s) => s.datasetHandle?.label);
  const hasAnalysis = useApp((s) => s.activeAnalysisId !== null);
  const inFlight = useApp((s) => s.request !== null);
  /** Shut by default. A quarter of the width is worth spending on a list of Analyses only once
      there is a list, and the 44px strip still carries the marker that says one changed. */
  const [railOpen, setRailOpen] = useState(false);
  const [keyDialog, setKeyDialog] = useState(wantsKey);
  /** Only the dialog the reload opened announces its dismissal. One the visitor opened from the
      header and closed has changed nothing, and saying so would be noise. */
  const [restoring, setRestoring] = useState(wantsKey);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  /** One listener for every `<details name>` menu on the page. That is the column type chips
      and nothing else now — the dataset switcher is Radix, which brings its own. */
  useLightDismiss();

  function closeKeyDialog(): void {
    setKeyDialog(false);
    if (restoring && useApp.getState().mode !== 'byok') {
      setAnnouncement(
        'Your key was not restored — it is only ever held in memory — so this session is in ' +
          'Demo mode. Enter it again from the header at any time.',
      );
    }
    setRestoring(false);
  }

  /** Layout, not passive: the attribute every token hangs off has to be set before the paint
      that follows the state change, and before any child effect reads a token back out. A
      scatter's canvas cannot inherit a CSS variable, so it reads `--series-n` in its own effect
      — and a passive effect here runs *after* that one, which left the canvas drawn in the
      palette of the theme just left. */
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <TipProvider>
      <div className="app">
        <Header
          route={route}
          railOpen={railOpen}
          workspace={workspace}
          onToggleRail={() => setRailOpen((v) => !v)}
          onWantKey={() => setKeyDialog(true)}
        />
        <div className="body">
          <Rail open={railOpen} onToggle={() => setRailOpen((v) => !v)} workspace={workspace} />
          <main className="content">
            {/* Before every other branch. A load in progress, and a failure the Dataset did not
                survive, both make the surface underneath untrue — a switch used to leave the
                outgoing Dataset's analyses on screen until the new one landed and then blank
                them. A first-run failure is not here: it belongs on the picker, next to the
                samples the visitor has to choose from again. */}
            {status === 'loading' || (status === 'failed' && hasDataset) ? (
              <LoadStage loader={loader} workspace={workspace} />
            ) : !hasDataset ? (
              <DatasetPicker loader={loader} />
            ) : status === 'inferring' ? (
              <InferenceGate loader={loader} workspace={workspace} />
            ) : route === 'data' ? (
              <DataSurface cache={cache} loader={loader} />
            ) : (
              /* One bounded column for the analysis and the composer both — that bound is the
                 whole distinction from a chat shell, so it stays column-width. */
              <div className="column">
                {announcement && (
                  <p className="notice notice-warning" role="status">
                    <span className="notice-head">
                      <span className="aside">{announcement}</span>
                      <button
                        type="button"
                        className="close"
                        aria-label="Dismiss"
                        onClick={() => setAnnouncement(null)}
                      >
                        &times;
                      </button>
                    </span>
                  </p>
                )}
                {/* Everything the load has to say, in one strip: the types when the gate did not
                    need to open, the rows the parser could not use, the cap. The detail is on
                    `#/data`, which the strip links to. */}
                <LoadNews key={datasetLabel} />
                <Notice workspace={workspace} loader={loader} />
                {inFlight && <InFlight />}
                {hasAnalysis ? (
                  <AnalysisCard workspace={workspace} cache={cache} />
                ) : (
                  !inFlight && <EmptyState workspace={workspace} />
                )}
                <Composer workspace={workspace} />
              </div>
            )}
          </main>
        </div>
        <KeyDialog open={keyDialog} onClose={closeKeyDialog} />
      </div>
    </TipProvider>
  );
}
