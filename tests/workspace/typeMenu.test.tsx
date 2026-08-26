/** Light-dismiss on the column type menus.

    `<details>` gives an exclusive group and closes on pick; it gives nothing else. Escape, a
    click on the page background and a tab out all left the menu standing open, which reads as
    broken because the chip is drawn as a dropdown. `useLightDismiss` adds the two listeners once
    for every named menu on the page, and this is what fails if either goes. The hook is mounted
    here because `App` mounts it in the application; the surface under test is only a fragment of
    that page.

    These chips are row 6 of `docs/ui-primitives.md` — drawn as a dropdown, built as a disclosure.
    They are not retrofitted, which is the standing decision for existing code; the dataset
    switcher, which is new, is Radix (ADR-0027 §1).

    The menus are opened by setting `open` rather than by clicking the summary: jsdom does not
    implement the summary's default toggle, and the toggle is the browser's job anyway. What is
    under test is the dismissal. */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLoader, type Loader } from '../../src/data/loader';
import { createLocalPort } from '../../src/worker/localPort';
import { createSliceCache, type SliceCache } from '../../src/table/sliceCache';
import { DataSurface } from '../../src/ui/DataTable';
import { useLightDismiss } from '../../src/ui/lightDismiss';
import { useApp } from '../../src/store';
import { CSV, flush, ref, reset } from './harness';

// The grid takes its viewport height from an observer and nowhere else, and jsdom has none.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() {
      this.cb(
        [{ contentRect: { width: 900, height: 600 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
});

/** `App` in miniature: the surface plus the one listener the application mounts around it. */
function Page({ cache, loader }: { cache: SliceCache; loader: Loader }) {
  useLightDismiss();
  return <DataSurface cache={cache} loader={loader} />;
}

async function surface() {
  reset();
  const port = createLocalPort();
  const res = await port.send({ type: 'parse', source: { text: CSV }, ref, label: 'm.csv' }).done;
  if (res.type !== 'parse:done') throw new Error('fixture failed to parse');
  useApp.getState().setDataset(res.handle, null);
  render(<Page cache={createSliceCache(port)} loader={createLoader(port)} />);
  await flush();
  return document.querySelectorAll<HTMLDetailsElement>('details.type-menu');
}

afterEach(() => document.body.replaceChildren());

describe('the column type menu', () => {
  beforeEach(reset);

  it('shuts on Escape, and hands focus back to the chip that opened it', async () => {
    const menus = await surface();
    const menu = menus[0]!;
    menu.open = true;

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(menu.querySelector('summary'));
  });

  it('shuts on a pointer down anywhere outside it', async () => {
    const menus = await surface();
    const menu = menus[0]!;
    menu.open = true;

    fireEvent.pointerDown(screen.getByRole('heading', { level: 2 }));

    expect(menu.open).toBe(false);
  });

  it('survives a pointer down on its own items, or the pick would never fire', async () => {
    const menus = await surface();
    const menu = menus[0]!;
    menu.open = true;

    // The event a real click sends first. If this closed the menu, the button underneath would
    // be gone before `click` arrived — which is why the listener is not a `focusout`.
    fireEvent.pointerDown(menu.querySelector('ul button')!);

    expect(menu.open).toBe(true);
  });

  it('leaves an Escape alone when no menu is open', async () => {
    const menus = await surface();
    expect([...menus].some((m) => m.open)).toBe(false);
    // Nothing to assert but the absence of a throw: the handler must tolerate an empty document.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect([...menus].some((m) => m.open)).toBe(false);
  });

  /** The one dismissal that worked before the listeners existed, and the one they must not
      tempt anyone into deleting. Asserted through the attribute rather than the behaviour:
      jsdom implements neither the exclusive group nor the `name` IDL property. */
  it('keeps the exclusive group that shuts one menu when another opens', async () => {
    const menus = await surface();
    expect(menus.length).toBeGreaterThan(1);
    expect([...menus].every((m) => m.getAttribute('name') === 'column-type')).toBe(true);
  });
});
