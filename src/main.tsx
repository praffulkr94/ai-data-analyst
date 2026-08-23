import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createAnthropicTranslator } from './ai/anthropic';
import { createFixtureTranslator } from './ai/fixtureTranslator';
import { switching } from './ai/translator';
import { createLoader } from './data/loader';
import { readSession, resumeSession, trackSession } from './data/session';
import { createSliceCache } from './table/sliceCache';
import { createTransport } from './worker/transport';
import { useApp } from './store';
import { watchPerformance } from './perf';
import { createWorkspace } from './workspace/workspace';
import './styles/tokens.css';
import './styles/app.css';

/** `#bench` is the performance evidence and nothing else — no Dataset, no Translator, no
    Workspace — so it is loaded on demand and none of it is in the bundle a visitor downloads.
    It is not gated to dev builds: the numbers exist to be reproduced by a stranger, and one who
    cannot reach the page on the deployed URL cannot reproduce anything (DECISIONS §13). */
if (location.hash === '#bench') {
  const Bench = lazy(() => import('./bench/Bench'));
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={<p className="muted">Loading the benchmark…</p>}>
        <Bench />
      </Suspense>
    </StrictMode>,
  );
} else {
  /** Both observers, for the life of the page: long tasks on the main thread — the number §7
      rests on — and Event Timing over 16ms, which is INP. Installed before anything else runs,
      so a scripted scroll and submit is inside the window they cover. */
  watchPerformance();

  /** One worker for the life of the tab, and a loader and a SliceCache over it. All three live
      outside React: the transport writes application state, and the cache holds rows that must
      not re-render the tree when they arrive. */
  const port = createTransport();
  const loader = createLoader(port);
  const cache = createSliceCache(port);

  /** The `Workspace` owns the Request lifecycle and is constructed with a Translator. Both
      implementations sit behind that one seam and the mode picks between them per Request, so a
      mode switch changes the transport and nothing else. */
  const anthropic = createAnthropicTranslator();
  const fixtures = createFixtureTranslator({
    dataset: () => {
      const ref = useApp.getState().datasetHandle?.ref;
      return ref?.kind === 'sample' ? ref.id : null;
    },
  });

  const workspace = createWorkspace({
    translator: switching(() => (useApp.getState().mode === 'byok' ? anthropic : fixtures)),
    port,
    loader,
  });

  /** The hash is read once, before anything renders, and then kept in step for the rest of the
      session. `byok` in it is deliberately not acted on here: the key went with the tab, and the
      dialog the interface opens is what decides whether the mode comes back. */
  const session = readSession();
  if (session) resumeSession(session, { workspace, loader });
  trackSession();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App
        loader={loader}
        cache={cache}
        port={port}
        workspace={workspace}
        wantsKey={session?.mode === 'byok'}
      />
    </StrictMode>,
  );
}
