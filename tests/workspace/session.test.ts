/** The hash, and what a reload rebuilds from it.

    There is no persistence, so this is the only thing that survives a refresh. What the tests
    hold is the three things it carries, that it never carries a fourth, and that a Dataset whose
    columns have moved on since the link was made produces SpecViolations rather than a throw. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSession, resumeSession, sessionOf, trackSession } from '../../src/data/session';
import { useApp } from '../../src/store';
import { analyses, analysis, attempt, flush, reset, setup, titles } from './harness';
import { specFromReply } from '../../src/spec/grammar';

const spec = () => specFromReply(analysis('Matches by team') as never);

describe('what the hash carries', () => {
  beforeEach(reset);

  it('round-trips the mode, the DatasetRef and the Revision on screen', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('how many matches per team?');
    await flush();
    await script.resolve(0, attempt(analysis('Matches by team')));

    const stop = trackSession();
    useApp.getState().setMode('byok');
    stop();

    const back = readSession(location.hash);
    expect(back).toEqual({
      mode: 'byok',
      dataset: { kind: 'sample', id: 'matches' },
      spec: spec(),
    });
  });

  /** A reset leaves nothing to carry, so the payload has to go. The bug this covers is not the
      screen — that was right — it is the address, which went on describing a Dataset that had
      been thrown away, so copying the link handed someone a session the sender no longer had. */
  it('clears the payload when the workspace is reset', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('how many matches per team?');
    await flush();
    await script.resolve(0, attempt(analysis('Matches by team')));

    const stop = trackSession();
    useApp.getState().setMode('byok');
    expect(readSession(location.hash)).not.toBeNull();

    workspace.reset();
    stop();

    expect(readSession(location.hash)).toBeNull();
    expect(location.hash).toBe('#/');
  });

  /** One Analysis, not all of them. The use case is sharing a chart; encoding a session grows
      the URL without bound and buys back only what a reload was never promised. */
  it('carries one Analysis however many there are, and no rows', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('one');
    await flush();
    await script.resolve(0, attempt(analysis('First')));
    workspace.selectCard(null);
    void workspace.ask('two');
    await flush();
    await script.resolve(1, attempt(analysis('Second')));

    expect(titles()).toEqual(['First', 'Second']);
    const session = sessionOf(useApp.getState());
    expect(session.spec?.title).toBe('Second');
    expect(JSON.stringify(session)).not.toContain('Scotland');
  });

  /** Stepping back is what the visitor is looking at, and a link is a link to that. */
  it('carries the Revision on screen rather than the newest one', async () => {
    const { workspace, script } = await setup();
    void workspace.ask('one');
    await flush();
    await script.resolve(0, attempt(analysis('First')));
    void workspace.ask('two');
    await flush();
    await script.resolve(1, attempt(analysis('Second', 'home_team', 'refine')));

    const id = analyses()[0]!.id;
    useApp.getState().stepRevision(id, -1);
    expect(sessionOf(useApp.getState()).spec?.title).toBe('First');
  });

  it('never pushes a history entry, so Back still means back', async () => {
    await setup();
    const push = vi.spyOn(history, 'pushState');
    const replace = vi.spyOn(history, 'replaceState');
    const stop = trackSession();
    useApp.getState().setMode('byok');
    stop();
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
    replace.mockRestore();
  });

  /** A first-run visitor has nothing to share, and an address bar that grows a hash the moment
      the page opens looks like the application did something. */
  it('leaves the address bar alone until there is something to carry', () => {
    // A first run, which jsdom does not hand back on its own — the previous test left a payload
    // in `location`, and clearing a stale one is now a write like any other.
    history.replaceState(null, '', '#');
    const replace = vi.spyOn(history, 'replaceState');
    const stop = trackSession();
    useApp.getState().setMode('byok');
    stop();
    expect(replace).not.toHaveBeenCalled();
    replace.mockRestore();
  });

  it('starts clean rather than half-restored when the hash is not one of ours', () => {
    expect(readSession('#not-base64-at-all!!')).toBeNull();
    expect(readSession('')).toBeNull();
    expect(readSession('#' + btoa('{"v":99}'))).toBeNull();
  });
});

describe('a reload', () => {
  beforeEach(reset);

  it('re-fetches a sample, re-runs the analysis, and clears the pending restore', async () => {
    const { workspace } = await setup();
    // `setup` has already parsed the Dataset, so the arrival the subscription waits for is
    // simulated by re-announcing it — the loader path is covered by its own tests.
    const handle = useApp.getState().datasetHandle!;
    useApp.setState({ datasetHandle: null });

    resumeSession({ mode: 'demo', dataset: handle.ref, spec: spec() }, {
      workspace,
      loader: { loadSample: async () => {}, loadFile: async () => {} } as never,
    });
    expect(useApp.getState().restore).not.toBeNull();

    useApp.getState().setDataset(handle, null);
    await flush();
    expect(titles()).toEqual(['Matches by team']);
    expect(useApp.getState().restore).toBeNull();
  });

  it('asks for an uploaded file by name rather than pretending it can restore it', () => {
    resumeSession(
      {
        mode: 'demo',
        dataset: { kind: 'upload', filename: 'matches-export.csv', rowCount: 49_520 },
        spec: spec(),
      },
      { workspace: {} as never, loader: {} as never },
    );
    expect(useApp.getState().restore?.ref).toEqual({
      kind: 'upload',
      filename: 'matches-export.csv',
      rowCount: 49_520,
    });
    expect(analyses()).toEqual([]);
  });

  it('renders the violations when the Dataset no longer matches the link, rather than throwing', async () => {
    const { workspace } = await setup();
    const stale = specFromReply(analysis('Revenue by region', 'revenu') as never);
    await expect(workspace.restore(stale)).resolves.toBeUndefined();
    expect(analyses()).toEqual([]);
    const notice = useApp.getState().pendingNotice as {
      kind: string;
      violations: { code: string; message: string }[];
    };
    expect(notice.kind).toBe('failed');
    expect(notice.violations[0]!.code).toBe('unknown-column');
    expect(notice.violations[0]!.message).toContain('revenu');
  });
});
