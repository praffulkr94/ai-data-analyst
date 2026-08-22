/** One small Zustand store. Justified because the worker transport and the Request dispatcher
    write state from outside the React tree, and selector subscriptions let the chart re-render
    without re-rendering the table (DECISIONS §12). No middleware. */
import { create } from 'zustand';
import type { DatasetHandle, ParseReport } from './engine/handle';
import type { ViewState } from './engine/rowIndex';
import type { ColumnMeta, ColumnType } from './engine/types';

/** Demo mode is the default for a first-time visitor. There is no "Live" mode — its opposite
    is BYOK, labelled "Your API key". */
export type Mode = 'demo' | 'byok';

export type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; label: string; rows: number }
  | { status: 'ready' }
  | { status: 'failed'; message: string };

export type AppState = {
  mode: Mode;
  theme: 'light' | 'dark';
  datasetHandle: DatasetHandle | null;
  /** The editable copy of the DatasetSchema. A visitor's type override lands here first and is
      then re-encoded in the worker, so this is never a second inference path. */
  columns: ColumnMeta[];
  parseReport: ParseReport | null;
  load: LoadState;
  /** How the visitor has arranged the table. Inspection only — it never drives a chart. */
  viewState: ViewState;

  setMode: (mode: Mode) => void;
  toggleTheme: () => void;
  beginLoad: (label: string) => void;
  reportProgress: (rows: number) => void;
  failLoad: (message: string) => void;
  setDataset: (handle: DatasetHandle, report: ParseReport | null) => void;
  setColumnType: (name: string, type: ColumnType) => void;
  sortBy: (column: string) => void;
  toggleColumn: (column: string) => void;
};

export const useApp = create<AppState>((set) => ({
  mode: 'demo',
  theme: 'light',
  datasetHandle: null,
  columns: [],
  parseReport: null,
  load: { status: 'idle' },
  viewState: { sort: null, hidden: [] },

  setMode: (mode) => set({ mode }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
  beginLoad: (label) => set({ load: { status: 'loading', label, rows: 0 } }),
  reportProgress: (rows) =>
    set((s) => (s.load.status === 'loading' ? { load: { ...s.load, rows } } : {})),
  failLoad: (message) => set({ load: { status: 'failed', message } }),
  setDataset: (handle, report) =>
    set((s) => ({
      datasetHandle: handle,
      columns: handle.schema.columns,
      parseReport: report,
      load: { status: 'ready' },
      // A different Dataset has different columns, so a sort or a hidden column carried over
      // from the last one would name something that no longer exists.
      viewState: s.datasetHandle?.label === handle.label ? s.viewState : { sort: null, hidden: [] },
    })),
  setColumnType: (name, type) =>
    set((s) => ({
      columns: s.columns.map((c) => (c.name === name ? { ...c, type, overridden: true } : c)),
    })),

  /** One click sorts ascending, the next descending, the third clears it. */
  sortBy: (column) =>
    set((s) => {
      const sort = s.viewState.sort;
      const next =
        sort?.column !== column
          ? { column, dir: 'asc' as const }
          : sort.dir === 'asc'
            ? { column, dir: 'desc' as const }
            : null;
      return { viewState: { ...s.viewState, sort: next } };
    }),

  toggleColumn: (column) =>
    set((s) => {
      const hidden = s.viewState.hidden.includes(column)
        ? s.viewState.hidden.filter((c) => c !== column)
        : [...s.viewState.hidden, column];
      return {
        viewState: {
          // A hidden column cannot also be the sort column.
          sort: s.viewState.sort?.column === column ? null : s.viewState.sort,
          hidden,
        },
      };
    }),
}));
