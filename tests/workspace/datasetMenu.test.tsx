/** The dataset switcher's menu semantics.

    The reason this is Radix and not the `<details name>` disclosure the column type chips use:
    that disclosure is row 6 of `docs/ui-primitives.md` — a surface drawn as a dropdown and built
    as a disclosure, recorded there as a gap. A screen reader met it as a disclosure triangle, and
    a keyboard user had no way through it but Tab.

    What is asserted here is the part a hand-rolled menu keeps failing to have: the trigger is a
    menu button, the panel is a menu, the samples are its items, and the keyboard opens it. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLoader } from '../../src/data/loader';
import { createWorkspace } from '../../src/workspace/workspace';
import { createLocalPort } from '../../src/worker/localPort';
import { DatasetMenu } from '../../src/ui/DatasetMenu';
import { SAMPLES } from '../../src/data/samples';
import { useApp } from '../../src/store';
import { reset, scripted } from './harness';

function menu() {
  const port = createLocalPort();
  const workspace = createWorkspace({
    translator: scripted().translator,
    port,
    loader: createLoader(port),
  });
  render(
    <DatasetMenu workspace={workspace} className="dataset-chip">
      International football matches
    </DatasetMenu>,
  );
  return screen.getByRole('button', { name: /International football matches/ });
}

describe('the dataset switcher', () => {
  beforeEach(reset);
  afterEach(cleanup);

  it('is a menu button, which a disclosure never was', () => {
    expect(menu().getAttribute('aria-haspopup')).toBe('menu');
  });

  it('opens from the keyboard, with every sample as an item', () => {
    const trigger = menu();
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getAllByRole('menuitem').length).toBe(SAMPLES.length + 1); // + "Pick a file…"
  });

  /** The Dataset already loaded is marked rather than offered, so the menu says where you are as
      well as where you can go. */
  it('ticks the Dataset that is loaded', () => {
    useApp.setState({
      datasetHandle: { label: 'x', rowCount: 1, ref: { kind: 'sample', id: SAMPLES[0]!.id } } as never,
    });
    fireEvent.keyDown(menu(), { key: 'Enter' });

    // The tick is an icon rather than a glyph, so the assertion is on the mark being drawn in
    // that row's slot and nowhere else.
    const items = screen.getAllByRole('menuitem');
    expect(items[0]!.querySelector('.tick svg')).toBeTruthy();
    expect(items[1]!.querySelector('.tick svg')).toBeNull();
  });
});
