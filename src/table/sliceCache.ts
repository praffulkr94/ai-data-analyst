/** The SliceCache. Rows, RowIndexes and RowSlices live here — outside React, outside the
    Zustand store — because the table renders synchronously against whatever is cached and
    enqueues a fetch on a miss. Putting per-scroll-position row data in the store would
    re-render the whole application on every fling. */
import type { DataPort } from '../worker/port';
import type { ViewState } from '../engine/rowIndex';

/** One RowSlice. 100 rows is a few kilobytes, so a miss costs one small message. */
export const SLICE_ROWS = 100;
/** Roughly forty RowSlices — 4,000 rows, comfortably more than any viewport, and bounded so a
    long scroll through 99,040 rows does not accumulate the whole Dataset on the main thread. */
export const MAX_SLICES = 40;

export type Row = (string | null)[];

export type CacheView = {
  viewVersion: number;
  rowCount: number;
  columns: string[];
};

export type SliceCache = ReturnType<typeof createSliceCache>;

export function createSliceCache(port: DataPort) {
  let view: CacheView = { viewVersion: 0, rowCount: 0, columns: [] };
  const slices = new Map<number, Row[]>();
  const inflight = new Set<number>();
  /** The rows the viewport currently wants. A RowSlice arriving from outside it is discarded. */
  let wanted = { from: 0, to: 0 };
  const listeners = new Set<() => void>();
  /** Bumped whenever a render would produce different output, so `useSyncExternalStore` can
      compare a single number instead of the cache. */
  let revision = 0;

  const announce = () => {
    revision++;
    for (const l of listeners) l();
  };

  /** Drop the RowSlices furthest from what the viewport wants. */
  function evict(): void {
    if (slices.size <= MAX_SLICES) return;
    const middle = (wanted.from + wanted.to) / 2;
    [...slices.keys()]
      .sort((a, b) => Math.abs(b - middle) - Math.abs(a - middle))
      .slice(0, slices.size - MAX_SLICES)
      .forEach((k) => slices.delete(k));
  }

  async function fetchSlice(start: number): Promise<void> {
    if (inflight.has(start) || slices.has(start)) return;
    inflight.add(start);
    const res = await port.send({ type: 'slice', offset: start, limit: SLICE_ROWS }).done;
    inflight.delete(start);
    if (res.type !== 'slice:done') return;
    // Dropped on arrival, by version and by range — not by cancelling. Skeletons during a
    // fling are correct behaviour, so there is nothing to cancel.
    if (res.viewVersion !== view.viewVersion) return;
    if (res.offset + SLICE_ROWS < wanted.from || res.offset > wanted.to) return;
    slices.set(res.offset, res.rows);
    view = { ...view, columns: res.columns };
    evict();
    announce();
  }

  return {
    /** Send a ViewState to the worker and adopt the RowIndex it built. Every cached RowSlice
        belongs to the previous version and is dropped. */
    async setView(viewState: ViewState): Promise<void> {
      const res = await port.send({ type: 'view', viewState }).done;
      if (res.type !== 'view:done') return;
      slices.clear();
      inflight.clear();
      view = { viewVersion: res.viewVersion, rowCount: res.rowCount, columns: [] };
      announce();
      // One RowSlice requested up front so the first paint has data rather than a screenful of
      // skeletons — but not awaited: a new ordering is on screen the moment the RowIndex exists.
      void fetchSlice(Math.floor(wanted.from / SLICE_ROWS) * SLICE_ROWS);
    },

    /** Tell the cache which rows are on screen. Everything it needs and does not hold is
        requested; everything that arrives outside this range is discarded. */
    setRange(from: number, to: number): void {
      wanted = { from, to };
      for (let start = Math.floor(from / SLICE_ROWS) * SLICE_ROWS; start <= to; start += SLICE_ROWS) {
        if (start < view.rowCount) void fetchSlice(start);
      }
    },

    /** The row at a view position, or `null` if it has not arrived — in which case the table
        renders a skeleton rather than a blank or a frozen viewport. */
    row(i: number): Row | null {
      const slice = slices.get(Math.floor(i / SLICE_ROWS) * SLICE_ROWS);
      return slice?.[i % SLICE_ROWS] ?? null;
    },

    /** The column names the worker put in the RowSlice — the authoritative row shape. Empty
        until the first RowSlice lands. */
    columns: (): string[] => view.columns,

    get rowCount() {
      return view.rowCount;
    },
    get viewVersion() {
      return view.viewVersion;
    },
    getRevision: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
