import { useEffect, useState } from 'react';
import type { Loader } from './data/loader';
import type { SliceCache } from './table/sliceCache';
import type { DataPort } from './worker/port';
import type { Workspace } from './workspace/workspace';
import { AnalysisCard } from './ui/AnalysisCard';
import { Composer } from './ui/Composer';
import { DataTable } from './ui/DataTable';
import { DatasetPicker } from './ui/DatasetPicker';
import { DevPanel } from './ui/DevPanel';
import { Header } from './ui/Header';
import { KeyDialog } from './ui/KeyDialog';
import { Notice } from './ui/Notice';
import { Rail } from './ui/Rail';
import { SchemaPanel } from './ui/SchemaPanel';
import { useApp } from './store';

export function App({
  loader,
  cache,
  port,
  workspace,
  wantsKey = false,
}: {
  loader: Loader;
  cache: SliceCache;
  port: DataPort;
  workspace: Workspace;
  /** The reloaded link said BYOK. The key went with the tab, so the dialog opens rather than
      the mode quietly reverting to Demo behind the visitor's back. */
  wantsKey?: boolean;
}) {
  const theme = useApp((s) => s.theme);
  const hasDataset = useApp((s) => s.datasetHandle !== null);
  const [keyDialog, setKeyDialog] = useState(wantsKey);
  /** Only the dialog the reload opened announces its dismissal. One the visitor opened from the
      header and closed has changed nothing, and saying so would be noise. */
  const [restoring, setRestoring] = useState(wantsKey);
  const [announcement, setAnnouncement] = useState<string | null>(null);

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      <Header onWantKey={() => setKeyDialog(true)} />
      <Rail workspace={workspace} />
      <main className="canvas">
        {announcement && (
          <p className="notice notice-warning announcement" role="status">
            {announcement}
            <button type="button" className="link" onClick={() => setAnnouncement(null)}>
              Dismiss
            </button>
          </p>
        )}
        {hasDataset ? (
          <>
            <Notice workspace={workspace} />
            <AnalysisCard workspace={workspace} />
            <SchemaPanel loader={loader} />
            <DevPanel port={port} workspace={workspace} onWantKey={() => setKeyDialog(true)} />
            <DataTable cache={cache} />
          </>
        ) : (
          <DatasetPicker loader={loader} />
        )}
      </main>
      <Composer workspace={workspace} />
      <KeyDialog open={keyDialog} onClose={closeKeyDialog} />
    </div>
  );
}
