import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createAnthropicTranslator } from './ai/anthropic';
import { createLoader } from './data/loader';
import { createSliceCache } from './table/sliceCache';
import { createTransport } from './worker/transport';
import { createWorkspace } from './workspace/workspace';
import './styles/tokens.css';
import './styles/app.css';

/** One worker for the life of the tab, and a loader and a SliceCache over it. All three live
    outside React: the transport writes application state, and the cache holds rows that must
    not re-render the tree when they arrive. */
const port = createTransport();
const loader = createLoader(port);
const cache = createSliceCache(port);

/** The `Workspace` owns the Request lifecycle and is constructed with a Translator. In milestone
    7 the Demo-mode Fixture Translator goes in the same slot; nothing else changes. */
const workspace = createWorkspace({
  translator: createAnthropicTranslator(),
  port,
  loader,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App loader={loader} cache={cache} port={port} workspace={workspace} />
  </StrictMode>,
);
