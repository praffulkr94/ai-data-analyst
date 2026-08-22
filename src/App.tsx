import { useEffect } from 'react';
import type { Loader } from './data/loader';
import type { SliceCache } from './table/sliceCache';
import { Composer } from './ui/Composer';
import { DataTable } from './ui/DataTable';
import { DatasetPicker } from './ui/DatasetPicker';
import { Header } from './ui/Header';
import { Rail } from './ui/Rail';
import { SchemaPanel } from './ui/SchemaPanel';
import { useApp } from './store';

export function App({ loader, cache }: { loader: Loader; cache: SliceCache }) {
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
