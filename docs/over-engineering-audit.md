# Over-engineering audit

One pass over the whole tree, hunting complexity only — not correctness, not security, not
performance. Findings are listed, nothing is applied; each line is `<tag> what to cut. what
replaces it. [path]`.

Told before it started, and not findings: the hand-rolled worker RPC (not Comlink), d3 submodules
with hand-rendered axes (not a charting library), the worker-resident ColumnStore (not
array-of-objects), and the absence of TanStack Query are deliberate and spec-mandated —
`DECISIONS.md` §A9 and ADR-0013. Accidental complexity everywhere else was fair game, and
`src/bench/` and `src/perf.ts` were audited for the first time.

## Findings, biggest cut first

1. **`delete:`** `d3-scale-chromatic` and `@types/d3-scale-chromatic` are dependencies that no file
   imports. The palette is six CSS custom properties (ADR-0012) and `seriesColor` reads them.
   Two package entries out. Note that ADR-0008 names the package in its chosen submodule list, so
   that sentence goes stale with the dep. [`package.json`]
2. **`yagni:`** `@tanstack/react-table` in the DataTable. Its entire contribution is a header list,
   a visibility filter and `getRowModel()` over the ~30 rows already on screen — `manualSorting`,
   `manualFiltering` and `manualPagination` turn the rest off, and the worker owns sort, filter and
   the RowIndex. `names.filter((n) => !hidden.includes(n))` and mapping `visible` replaces it: one
   dependency and roughly 15 lines. **This one is the author's call, not a defect** — DECISIONS §6
   decided TanStack Table in fully manual mode deliberately. [`src/ui/DataTable.tsx`]
3. **`stdlib:`** `measure()` in the bench re-implements `timedAsync` from `src/perf.ts` —
   same mark, same measure, same `[value, ms]` tuple — and `timedAsync` has no other caller, so
   the codebase currently ships the helper twice and uses neither from the other side. Keep one.
   [`src/bench/paths.ts:41`, `src/perf.ts:22`]
4. **`shrink:`** Two cancellable sleeps: `delay()` in the Workspace and `sleep()` in the Fixture
   Translator, both ~12 lines, both rejecting with `Cancelled`, both wiring an `abort` listener
   around a `setTimeout`. One of them, shared. [`src/workspace/workspace.ts:87`,
   `src/ai/fixtureTranslator.ts:47`]
5. **`native:`** Hand-rolled base64url — `btoa`, a `String.fromCharCode(...)` spread and three
   regex replaces on the way out, the mirror image on the way in. This is a Chromium-only project
   by decision, and Chromium has the primitive: `new TextEncoder().encode(text).toBase64({
   alphabet: 'base64url', omitPadding: true })` and `Uint8Array.fromBase64(raw, { alphabet:
   'base64url' })`. About 8 lines, and it drops the spread that would blow the stack on a large
   enough hash. [`src/data/session.ts`]
6. **`delete:`** `disarmFaults` is exported and called by nothing. `takeFault` consumes the arming
   and the dev panel never disarms. [`src/ai/faults.ts:23`]
7. **`yagni:`** `workspace.latestSpec()` — a method on the facade whose only caller in the
   repository is one assertion in `tests/workspace/analysis.test.ts`. The test can read the store
   directly, the way its neighbours do. [`src/workspace/workspace.ts`]
8. **`delete:`** `export type { SpecViolation }` at the foot of `workspace.ts` — a pass-through
   re-export nobody imports from there; every consumer takes it from `spec/validate`.
   [`src/workspace/workspace.ts:384`]
9. **`shrink:`** `MARK_CAP` is a four-entry Record of which three entries alias
   `CHART_BUDGET[type].points`; only `bar: 60` carries information. `type === 'bar' ? 60 :
   CHART_BUDGET[type].points` says the same thing in one line. [`src/chart/marks.tsx:21`]
10. **`yagni:`** Twelve exports with no importer — `SCATTER_POINT_CAP`, `HISTORY_KEPT`,
    `MAX_ATTEMPTS`, `columnStats`, `describeColumn`, `inferColumn`, `sampleIndices`,
    `outputFields`, `formatAxisValue`, `prefersReducedMotion`, `REVEAL_MS`, `decode` — each used
    only inside the file that defines it. Drop the keyword, not the code: no runtime change, a
    smaller public surface, and the next reader stops wondering who depends on them.
11. **`native:`** `d3-format` for exactly two formats. `Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2 })` is `,.2~f` exactly; `{ notation: 'compact' }` is the axis
    abbreviation only approximately — it renders `43K` where `~s` renders `43.3k`. One dependency
    and its `@types`, at the cost of changing what a tick says: a judgement call, not a free cut.
    [`src/chart/marks.tsx:42`]

net: -55 lines, -3 runtime dependencies (-5 `package.json` entries counting `@types`) possible.
Findings 2 and 11 change behaviour or contradict a settled decision and should be decided rather
than applied.

## Looked at and lean already

- `src/store.ts` — every action has a caller; no middleware, no persistence layer, no derived
  state cached that a selector could compute.
- `src/styles/app.css` — all 81 class selectors are referenced from a component. No dead rules.
- The two seams (`src/engine/`, `src/workspace/`) — no interface with one implementation, no
  factory, no options bag nobody sets. Every optional parameter in the engine (`headN`, `randomN`,
  `random`, `rowLimit`, `metric`, `seriesBy`) is exercised by a test, which is what makes inference
  and the executor deterministic under test rather than speculative flexibility.
- `d3-array`'s `min`/`max` in `useScales` look like `Math.min`/`Math.max` with a dependency
  attached, and they are not: a scatter's `AnalysisResult` carries up to `SCATTER_POINT_CAP`
  rows — 98,899 on `team_matches` — and `Math.min(...values)` over that many arguments is a
  `RangeError`, not a smaller diff. It stays.
- `src/bench/` — the three paths, two questions and the JSON dump, with nothing cached, memoised or
  warmed on purpose. Only finding 3 above.
- `src/ui/DevPanel.tsx` — it does duplicate the validate-then-execute pipeline rather than routing
  through the Workspace, and that is the point of it (§18, and the panel renders violations the
  Workspace would turn into a notice). Accepted cost, not a finding.
- The four spec-mandated areas — out of scope by instruction, and left alone.
