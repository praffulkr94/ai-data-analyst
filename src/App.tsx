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
}: {
  loader: Loader;
  cache: SliceCache;
  port: DataPort;
  workspace: Workspace;
}) {
  const theme = useApp((s) => s.theme);
  const hasDataset = useApp((s) => s.datasetHandle !== null);
  const [keyDialog, setKeyDialog] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      <Header onWantKey={() => setKeyDialog(true)} />
      <Rail workspace={workspace} />
      <main className="canvas">
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
      <KeyDialog open={keyDialog} onClose={() => setKeyDialog(false)} />
    </div>
  );
}
