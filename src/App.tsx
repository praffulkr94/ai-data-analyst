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
import { Notice } from './ui/Notice';
import { Rail } from './ui/Rail';
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
  const hasAnalysis = useApp((s) => s.activeAnalysisId !== null);
  const inFlight = useApp((s) => s.request !== null);
  const report = useApp((s) => s.parseReport);
  /** Shut by default. A quarter of the width is worth spending on a list of Analyses only once
      there is a list, and the 44px strip still carries the marker that says one changed. */
  const [railOpen, setRailOpen] = useState(false);
  const [keyDialog, setKeyDialog] = useState(wantsKey);
  /** Only the dialog the reload opened announces its dismissal. One the visitor opened from the
      header and closed has changed nothing, and saying so would be noise. */
  const [restoring, setRestoring] = useState(wantsKey);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [truncationRead, setTruncationRead] = useState(false);

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
    <div className="app">
      <Header
        route={route}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
        onWantKey={() => setKeyDialog(true)}
      />
      <div className="body">
        <Rail open={railOpen} onToggle={() => setRailOpen((v) => !v)} workspace={workspace} />
        <main className="content">
          {!hasDataset ? (
            <DatasetPicker loader={loader} />
          ) : status === 'inferring' ? (
            <InferenceGate loader={loader} />
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
              {/* What the file cost to read, once, dismissibly — the detail is on `#/data`.
                  A malformed row never fails the file, so this is news rather than an error. */}
              {report && (report.skipped > 0 || report.truncated) && !truncationRead && (
                <p className="notice notice-serious" role="status">
                  <span className="notice-head">
                    <span className="aside">
                      {report.truncated && 'Capped at 500,000 rows — the rest of the file was not read. '}
                      {report.skipped > 0 &&
                        `Parsed ${(report.totalRows - report.skipped).toLocaleString()} of ` +
                          `${report.totalRows.toLocaleString()} · ${report.skipped.toLocaleString()} skipped`}
                    </span>
                    <button
                      type="button"
                      className="close"
                      aria-label="Dismiss"
                      onClick={() => setTruncationRead(true)}
                    >
                      &times;
                    </button>
                  </span>
                </p>
              )}
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
  );
}
