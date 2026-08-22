/** One small Zustand store. Justified because the worker transport and the Request dispatcher
    write state from outside the React tree, and selector subscriptions let the chart re-render
    without re-rendering the table (DECISIONS §12). No middleware. */
import { create } from 'zustand';
import type { ModelChoice, TokenCounts } from './ai/models';
import type { Usage } from './ai/translator';
import type { DatasetHandle, ParseReport } from './engine/handle';
import type { AnalysisResult } from './engine/result';
import type { ViewState } from './engine/rowIndex';
import type { ColumnMeta, ColumnType } from './engine/types';
import type { AnalysisSpec } from './spec/grammar';
import type { SpecViolation } from './spec/validate';

/** Demo mode is the default for a first-time visitor. There is no "Live" mode — its opposite
    is BYOK, labelled "Your API key". */
export type Mode = 'demo' | 'byok';

/** One immutable version of an Analysis. `intent` is not here: a Revision's index says what the
    intent claimed, and a stored copy could disagree with it (ADR-0014). */
export type Revision = {
  spec: AnalysisSpec;
  result: AnalysisResult;
  /** Which model produced it, so a card can say. */
  model: ModelChoice;
};

/** A titled question-and-answer unit — what the rail lists and what a visitor returns to. */
export type Analysis = {
  id: string;
  title: string;
  revisions: Revision[];
  /** Set when a Revision landed while the visitor was looking at a different Analysis. Without
      it the finished work is silently invisible. */
  updated: boolean;
};

/** A reply with no spec and no result. Modelled as a transient notice rather than an empty
    Analysis: the rail lists things you can return to, and a refusal is not one (ADR-0014).

    It lives in its own slot rather than inside the Request, because a staleness guard's early
    return would otherwise blank the visitor's explanation mid-read. */
export type Notice =
  | { kind: 'clarification'; question: string; options: string[] }
  | { kind: 'unsupported'; reason: string; suggestions: string[] }
  | { kind: 'failed'; message: string; violations: SpecViolation[] };

/** The one Request in flight. Per-token narration lives here and never in `analyses`, so the
    streaming element re-renders and the rail does not. */
export type RequestState = {
  id: number;
  question: string;
  status: 'thinking' | 'repairing' | 'executing';
  narration: string;
  chips: string[];
};

export type UsageState = {
  /** The Request most recently completed. */
  last: Usage | null;
  /** Every Request this session, including ones whose results were discarded — they were still
      charged for. */
  total: TokenCounts;
  requests: number;
};

const NO_TOTAL: TokenCounts = {
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
};

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

  model: ModelChoice;
  analyses: Analysis[];
  activeAnalysisId: string | null;
  pendingNotice: Notice | null;
  request: RequestState | null;
  usage: UsageState;

  setMode: (mode: Mode) => void;
  setModel: (model: ModelChoice) => void;
  selectAnalysis: (id: string | null) => void;
  deleteAnalysis: (id: string) => void;
  startRequest: (id: number, question: string) => void;
  appendNarration: (id: number, text: string) => void;
  setChips: (id: number, chips: string[]) => void;
  setRequestStatus: (id: number, status: RequestState['status']) => void;
  endRequest: (id: number) => void;
  /** Unconditional, for the visitor's own cancel — there is no newer Request to protect. */
  cancelRequest: () => void;
  recordUsage: (usage: Usage, current: boolean) => void;
  setNotice: (notice: Notice) => void;
  dismissNotice: () => void;
  /** Append a Revision to the Analysis captured at dispatch, creating it if this is its first. */
  landRevision: (target: string | null, id: string, title: string, revision: Revision) => void;
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

  model: 'smart',
  analyses: [],
  activeAnalysisId: null,
  pendingNotice: null,
  request: null,
  usage: { last: null, total: NO_TOTAL, requests: 0 },

  setMode: (mode) => set({ mode }),
  setModel: (model) => set({ model }),

  /** A pure view change. It cancels nothing — discarding work the visitor asked for to service a
      navigation is hostile — and it clears the Analysis's updated marker, which has been read. */
  selectAnalysis: (id) =>
    set((s) => ({
      activeAnalysisId: id,
      analyses: s.analyses.map((a) => (a.id === id ? { ...a, updated: false } : a)),
    })),

  deleteAnalysis: (id) =>
    set((s) => ({
      analyses: s.analyses.filter((a) => a.id !== id),
      activeAnalysisId: s.activeAnalysisId === id ? null : s.activeAnalysisId,
    })),

  startRequest: (id, question) =>
    set({
      request: { id, question, status: 'thinking', narration: '', chips: [] },
      // A new submission clears the last refusal: it is the visitor's answer to it.
      pendingNotice: null,
    }),

  appendNarration: (id, text) =>
    set((s) =>
      s.request?.id === id ? { request: { ...s.request, narration: s.request.narration + text } } : {},
    ),

  setChips: (id, chips) =>
    set((s) => (s.request?.id === id ? { request: { ...s.request, chips } } : {})),

  setRequestStatus: (id, status) =>
    set((s) => (s.request?.id === id ? { request: { ...s.request, status } } : {})),

  endRequest: (id) => set((s) => (s.request?.id === id ? { request: null } : {})),

  cancelRequest: () => set({ request: null }),

  /** The session total counts every Request that completed, because every one was charged for.
      Only the current Request becomes the `last` figure. */
  recordUsage: (usage, current) =>
    set((s) => ({
      usage: {
        last: current ? usage : s.usage.last,
        requests: s.usage.requests + 1,
        total: {
          inputTokens: s.usage.total.inputTokens + usage.inputTokens,
          cacheReadTokens: s.usage.total.cacheReadTokens + usage.cacheReadTokens,
          cacheWriteTokens: s.usage.total.cacheWriteTokens + usage.cacheWriteTokens,
          outputTokens: s.usage.total.outputTokens + usage.outputTokens,
        },
      },
    })),

  setNotice: (pendingNotice) => set({ pendingNotice }),
  dismissNotice: () => set({ pendingNotice: null }),

  landRevision: (target, id, title, revision) =>
    set((s) => {
      const existing = s.analyses.find((a) => a.id === target);
      if (!existing) {
        return {
          analyses: [...s.analyses, { id, title, revisions: [revision], updated: false }],
          activeAnalysisId: id,
        };
      }
      return {
        analyses: s.analyses.map((a) =>
          a.id === existing.id
            ? {
                ...a,
                title,
                revisions: [...a.revisions, revision],
                // Quiet marker: the result landed on an Analysis the visitor is not looking at.
                updated: s.activeAnalysisId !== a.id,
              }
            : a,
        ),
      };
    }),
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
      // Analyses name columns of the Dataset they were asked against, so a different one leaves
      // them meaningless rather than merely stale.
      analyses: s.datasetHandle?.label === handle.label ? s.analyses : [],
      activeAnalysisId: s.datasetHandle?.label === handle.label ? s.activeAnalysisId : null,
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
