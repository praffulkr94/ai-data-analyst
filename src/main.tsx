import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createLoader } from './data/loader';
import { createSliceCache } from './table/sliceCache';
import { createTransport } from './worker/transport';
import './styles/tokens.css';
import './styles/app.css';

/** One worker for the life of the tab, and a loader and a SliceCache over it. All three live
    outside React: the transport writes application state, and the cache holds rows that must
    not re-render the tree when they arrive. */
const port = createTransport();
const loader = createLoader(port);
const cache = createSliceCache(port);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App loader={loader} cache={cache} port={port} />
  </StrictMode>,
);
