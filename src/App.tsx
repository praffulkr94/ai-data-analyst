import { useEffect } from 'react';
import type { Loader } from './data/loader';
import type { SliceCache } from './table/sliceCache';
import type { DataPort } from './worker/port';
import { Composer } from './ui/Composer';
import { DataTable } from './ui/DataTable';
import { DatasetPicker } from './ui/DatasetPicker';
import { DevPanel } from './ui/DevPanel';
import { Header } from './ui/Header';
import { Rail } from './ui/Rail';
import { SchemaPanel } from './ui/SchemaPanel';
import { useApp } from './store';

export function App({
  loader,
  cache,
  port,
}: {
  loader: Loader;
  cache: SliceCache;
  port: DataPort;
}) {
  const theme = useApp((s) => s.theme);
  const hasDataset = useApp((s) => s.datasetHandle !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      <Header />
      <Rail />
      <main className="canvas">
        {hasDataset ? (
          <>
            <SchemaPanel loader={loader} />
            <DevPanel port={port} />
            <DataTable cache={cache} />
          </>
        ) : (
          <DatasetPicker loader={loader} />
        )}
      </main>
      <Composer />
    </div>
  );
}
