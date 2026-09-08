/** The URL hash, and what a reload can rebuild from it.

    It carries exactly three things: the mode, a DatasetRef, and one AnalysisSpec. One Analysis,
    not all of them — the use case is sharing a chart, and encoding a whole session grows the URL
    without bound. There is no other persistence: IndexedDB is cut, so everything else is lost on
    reload. The failure guarded against is not losing the work, which is the accepted price of
    having no backend; it is losing it *silently*, so a visitor reloads and concludes the
    application is broken.

    Written with `replaceState`, into the `s` parameter of the hash — the route occupies the path
    (see `route.ts`). `pushState` would hijack the Back button, and undo is Cmd+Z. */
import { formatHash, parseHash } from '../route';
import { specFromReply, ModelReply, type AnalysisSpec } from '../spec/grammar';
import { useApp, type AppState, type Mode } from '../store';
import type { DatasetRef } from '../engine/handle';
import type { Workspace } from '../workspace/workspace';
import { sampleById } from './samples';
import type { Loader } from './loader';

export type Session = {
  mode: Mode;
  dataset: DatasetRef | null;
  /** The Revision the visitor is looking at, not the newest one. A link is a link to the chart
      on screen; handing back a Revision they had stepped away from would be a different chart. */
  spec: AnalysisSpec | null;
};

/** Bumped if the shape changes. An old link then decodes to nothing and starts clean, which is
    a better outcome than restoring half of it. */
const VERSION = 1;

const encode = (session: Session): string =>
  base64url(JSON.stringify({ v: VERSION, ...session }));

function decode(hash: string): Session | null {
  const raw = parseHash(hash).payload;
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64url(raw));
  } catch {
    return null;
  }
  const body = parsed as { v?: number; mode?: Mode; dataset?: DatasetRef; spec?: unknown };
  if (body?.v !== VERSION) return null;
  return {
    mode: body.mode === 'byok' ? 'byok' : 'demo',
    dataset: body.dataset ?? null,
    spec: readSpec(body.spec),
  };
}

/** A hash is untrusted input — anyone can type one — so the spec in it goes through the same Zod
    grammar a model reply does before anything is executed. */
function readSpec(value: unknown): AnalysisSpec | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = ModelReply.safeParse({ kind: 'analysis', intent: 'new', ...value });
  return parsed.success && parsed.data.kind === 'analysis' ? specFromReply(parsed.data) : null;
}

export const sessionOf = (s: AppState): Session => {
  const active = s.analyses.find((a) => a.id === s.activeAnalysisId);
  return {
    mode: s.mode,
    dataset: s.datasetHandle?.ref ?? null,
    spec: active?.revisions[active.at]?.spec ?? null,
  };
};

export const readSession = (hash = location.hash): Session | null => decode(hash);

/** Keeps the hash in step with the workspace. The guard is on the three values that go into it
    and not on the whole state: a Request in flight publishes narration on every frame, and
    re-encoding a specification sixty times a second to write the same hash is pure waste. */
export function trackSession(store = useApp): () => void {
  let previous: unknown[] = [];
  return store.subscribe((s) => {
    const active = s.analyses.find((a) => a.id === s.activeAnalysisId);
    const key = [s.mode, s.datasetHandle?.ref, active?.revisions[active.at]];
    if (key.length === previous.length && key.every((v, i) => v === previous[i])) return;
    previous = key;
    const session = sessionOf(s);
    const { route, payload: written } = parseHash();
    const payload = session.dataset || session.spec ? encode(session) : '';
    // Nothing to carry and nothing stale to clear: a first-run visitor's address bar stays as it
    // is rather than growing a hash that says the application did something.
    //
    // The second half of that condition is the whole point. A reset also has nothing to carry,
    // and returning early on that basis alone is how the address went on describing a Dataset
    // that had been thrown away — the screen was right and the link was a lie.
    if (!payload && !written) return;
    history.replaceState(
      null,
      '',
      `${location.pathname}${location.search}${formatHash(route, payload)}`,
    );
  });
}

/** Acts on the hash a reload arrived with.

    A sample is re-fetched and re-executed without asking. An upload cannot be: the rows are
    unrecoverable, so the file is named and the visitor is asked for it. The mode is *not*
    restored to `byok` here — the key is gone with the tab, and flipping the mode before there is
    a key to answer with would leave the interface claiming a capability it has lost. */
export function resumeSession(
  session: Session,
  { workspace, loader, store = useApp }: { workspace: Workspace; loader: Loader; store?: typeof useApp },
): void {
  if (!session.dataset) return;
  store.getState().awaitRestore({ ref: session.dataset, spec: session.spec });

  /** Restores as soon as a Dataset arrives, whichever way it arrived — the sample re-fetched
      just below, or the uploaded file the visitor re-selects. Subscribing rather than awaiting
      keeps the two paths one path. */
  const stop = store.subscribe((s, prev) => {
    if (s.datasetHandle === prev.datasetHandle || !s.datasetHandle) return;
    const pending = s.restore;
    stop();
    store.getState().awaitRestore(null);
    if (pending?.spec) void workspace.restore(pending.spec);
  });

  if (session.dataset.kind === 'sample') {
    const sample = sampleById(session.dataset.id);
    if (sample) void loader.loadSample(sample);
    else {
      stop();
      store.getState().awaitRestore(null);
    }
  }
}

/* ---- base64url ----------------------------------------------------------------------------
   `btoa` takes bytes, and a team name is not ASCII, so the JSON is encoded to UTF-8 first. */

const base64url = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64url = (text: string): string => {
  const bytes = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));
};
