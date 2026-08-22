import { useEffect } from 'react';
import type { Loader } from './data/loader';
import { Composer } from './ui/Composer';
import { DatasetPicker } from './ui/DatasetPicker';
import { Header } from './ui/Header';
import { Rail } from './ui/Rail';
import { SchemaPanel } from './ui/SchemaPanel';
import { useApp } from './store';

export function App({ loader }: { loader: Loader }) {
  const theme = useApp((s) => s.theme);
  const hasDataset = useApp((s) => s.datasetHandle !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      <Header />
      <Rail />
      <main className="canvas">{hasDataset ? <SchemaPanel loader={loader} /> : <DatasetPicker loader={loader} />}</main>
      <Composer />
    </div>
  );
}
