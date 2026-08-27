import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createAnthropicTranslator, proposeQuestions } from './ai/anthropic';
import { createFixtureTranslator } from './ai/fixtureTranslator';
import { switching } from './ai/translator';
import { createLoader } from './data/loader';
import { readSession, resumeSession, trackSession } from './data/session';
import { parseHash, watchRoute } from './route';
import { createSliceCache } from './table/sliceCache';
import { createTransport } from './worker/transport';
import { useApp } from './store';
import { watchPerformance } from './perf';
import { createWorkspace } from './workspace/workspace';
import './styles/tokens.css';
import './styles/app.css';

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
  // The other thing that reaches the API: the three sample Questions a keyed workspace opens on.
  // Injected here for the same reason the Translator is — a test that omits it gets no network.
  propose: proposeQuestions,
});

/** The hash is read once, before anything renders, and then kept in step for the rest of the
    session. `byok` in it is deliberately not acted on here: the key went with the tab, and the
    dialog the interface opens is what decides whether the mode comes back. */
const session = readSession();
if (session) resumeSession(session, { workspace, loader });
trackSession();

/** `#/bench` is the performance evidence and nothing else — no Dataset, no Translator, no
    Workspace — so it is loaded on demand and none of it is in the bundle a visitor downloads.
    It is not gated to dev builds: the numbers exist to be reproduced by a stranger, and one who
    cannot reach the page on the deployed URL cannot reproduce anything (DECISIONS §13). */
const Bench = lazy(() => import('./bench/Bench'));

/** The only thing the route changes is which surface renders. Everything the route could throw
    away — the worker, the parsed Dataset, the Workspace — is constructed above, so leaving for
    the bench page and coming back does not re-parse anything. */
function Root() {
  const [route, setRoute] = useState(() => parseHash().route);
  useEffect(() => watchRoute(setRoute), []);

  if (route === 'bench') {
    return (
      <Suspense fallback={<p className="muted">Loading the benchmark…</p>}>
        <Bench />
      </Suspense>
    );
  }
  return (
    <App
      route={route}
      loader={loader}
      cache={cache}
      workspace={workspace}
      wantsKey={session?.mode === 'byok'}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
