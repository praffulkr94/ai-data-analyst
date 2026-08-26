/** What is on screen while a Dataset is being replaced.

    The reported sequence: load a Dataset, ask a Question, go to `#/data`, switch Datasets. The
    route went home — correctly — and the *outgoing* Dataset's chart was rendered there for as
    long as the new file took to parse, then vanished when it landed. Two faults in one: a load
    with no sign it was running, and a surface still describing a Dataset that was on its way
    out.

    `App` answers both with one branch, and it comes before every other: while `load.status` is
    `loading` the surface is `LoadStage` and nothing else. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { createLoader } from '../../src/data/loader';
import { createSliceCache } from '../../src/table/sliceCache';
import { createWorkspace } from '../../src/workspace/workspace';
import { useApp } from '../../src/store';
import { CSV, ref, reset, scripted } from './harness';
import { createLocalPort } from '../../src/worker/localPort';

/** The whole application, with a Dataset loaded and an Analysis on screen — the state the
    reported sequence starts from. */
async function app(route: 'home' | 'data') {
  reset();
  const port = createLocalPort();
  const loader = createLoader(port);
  const cache = createSliceCache(port);
  const workspace = createWorkspace({ translator: scripted().translator, port, loader });
  const res = await port.send({ type: 'parse', source: { text: CSV }, ref, label: 'm.csv' }).done;
  if (res.type !== 'parse:done') throw new Error('fixture failed to parse');
  useApp.getState().setDataset(res.handle, null);
  return { render: () => render(<App route={route} loader={loader} cache={cache} workspace={workspace} />) };
}

describe('the surface while a Dataset is being replaced', () => {
  beforeEach(reset);
  // Without this the previous test's tree stays mounted and re-renders against the next test's
  // store, which is how a `#/data` App from one case ends up mounting the grid in another.
  afterEach(cleanup);

  it('is the progress card, and not the Dataset on its way out', async () => {
    const { render: mount } = await app('data');
    useApp.getState().beginLoad('team_matches.csv');
    mount();

    expect(screen.getByText(/Loading team_matches.csv/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    // The two surfaces that describe the Dataset being replaced.
    expect(document.querySelector('.data-surface')).toBeNull();
    expect(document.querySelector('section.card.analysis')).toBeNull();
  });

  /** A file refused at the door is not a state the application has to recover from — nothing was
      touched — so the workspace stays up and the message rides the strip. */
  it('goes back to the workspace when a file is refused', async () => {
    const { render: mount } = await app('home');
    useApp.getState().beginLoad('notes.pdf');
    useApp.getState().failLoad('notes.pdf is not a CSV.');
    mount();

    expect(document.querySelector('.stage .progress')).toBeNull();
    expect(screen.getByText('That file was not loaded.')).toBeTruthy();
    expect(screen.getByText(/notes\.pdf is not a CSV/)).toBeTruthy();
  });

  /** The worker died and the ColumnStore went with it, so there is no workspace to go back to. */
  it('stays on the stage when the failure took the rows with it', async () => {
    const { render: mount } = await app('home');
    useApp.getState().failLoad('The worker stopped.', true);
    mount();

    expect(screen.getByText('The Dataset is gone')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Mode' })).toBeTruthy();
  });
});
