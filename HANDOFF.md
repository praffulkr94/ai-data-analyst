# Handoff

This document is deliberately thin and carries **no project state**. It is authoritative for
nothing. Where things stand comes from three places and only those three:

1. **The progress ledger at the bottom of GitHub issue #1** — `gh issue view 1`. The ticked boxes
   are the state of record. Tick them as you go and commit; a handoff can land at any moment.
2. **`git log`** — one commit per completed ledger item or small group, each naming what was
   verified and with which numbers.
3. **A passing test suite** — `npm test`. If it is green, what it covers works.

If this document ever disagrees with `DECISIONS.md`, `docs/adr/`, `CONTEXT.md` or issue #1,
they win. Precedence is `DECISIONS.md` → `docs/adr/*` → `CONTEXT.md` → issue #1 → commits.

## Read before touching anything

- `AGENTS.md` — the map of the other documents.
- `CONTEXT.md` — the vocabulary. Authoritative over wording everywhere, including in commit
  messages and test names. Analysis, Revision, Request — never "turn". ColumnStore — never bare
  "store". RowSlice — never "window". ModelReply — never `SpecResponse`. Translator — never
  `SpecGenerator`. A concept you need that is missing from the glossary is a signal, not a
  licence to invent one.
- `docs/adr/` — read the ADRs that touch the area you are about to work in. There are nineteen.
- Issue #1 — the whole spec, and the only place the work is decomposed.

## The constraint that has to travel with you

Reproduced from `DECISIONS.md` §A9 and ADR-0013, because a code-minimisation plugin is installed
and injects its instructions at session start, on every prompt, and into **every subagent**:

> The hand-rolled worker RPC (not Comlink), d3 submodules with hand-rendered axes (not a charting
> library), the worker-resident ColumnStore (not array-of-objects), and the absence of TanStack
> Query are deliberate, spec-mandated choices, not oversights, and must not be simplified away.
> Each exists to make a specific engineering competency visible. Accidental complexity elsewhere
> remains fair game.

**Any subagent prompt that touches those four areas must carry that paragraph inline.** A subagent
has not read `DECISIONS.md`; told "build the chart layer" it will reach for Recharts.

## Running it

```
npm run dev          # Vite on :5173
npm test             # the two seams — engine (Node) and workspace (jsdom)
npm run test:all     # adds the browser project, which needs a real Worker
npm run typecheck    # tsc -b, run this often
npm run build
node scripts/build-datasets.mjs   # rebuilds public/data/*.csv.gz from data/raw/
```

Chromium only, by decision. `npx playwright install chromium` once.

## How the code is laid out

Two modules carry the testable behaviour and they are the two seams fixed by ADR-0011. Everything
else is wiring around them.

- `src/engine/` — **`DataEngine`**. Pure, no DOM, no worker, no network, callable from Node.
  Parsing, inference, the ColumnStore, the RowIndex, the Operation executor, the ChartSummary.
  Tests in `tests/engine/`.
- `src/workspace/` — **`Workspace`**, the facade the UI calls. **Does not exist yet**; it arrives
  in M5 and owns the Request lifecycle. Tests go in `tests/workspace/`, which currently holds the
  semantic validator and the SliceCache.
- `src/worker/kernel.ts` — everything the worker does, as a plain request-to-responses function.
  `dataset.worker.ts` adapts it to a real `Worker` in nine lines and `localPort.ts` adapts it
  in-process for the seam tests. One implementation, two adapters — do not fork it.
- `src/spec/` — the Zod grammar and the semantic validator.
- `src/chart/` — the three layers: dimensions, scales, dumb marks.
- `src/table/` — the SliceCache and its React window.
- `src/ui/` — components.

## Conventions that are not obvious from the code

- **Commit per completed ledger item**, not per milestone, so an unplanned handoff loses at most
  one unit of work. Tick the issue ledger in the same pass.
- **TDD at the seams.** Expectations must come from an independent source — a hand-worked example
  or the naive reference implementation in `tests/engine/reference.ts`. A test that recomputes an
  aggregation the way the code under test computes it asserts only self-consistency.
- **Charts are tested through their accessible data table, never through SVG geometry.** The
  harness is `tests/workspace/analysisChart.test.tsx`: real `DataEngine`, real marks, and a
  `ResizeObserver` stub reporting a fixed 900px, because `useChartDimensions` takes its width from
  an observer and nowhere else and jsdom has none. Where a rule is only observable in the path — a
  line breaking at a gap — count subpaths, never coordinates.
- **Tests that care about a ColumnType state it.** A small fixture falls under the 95% numeric
  threshold and infers categorical; `tests/engine/operation.test.ts` has the helper for this.
  Inference has its own tests and does not need testing again through the executor.
- **Say 99,040, never "100k+"** (`DECISIONS.md` §A6). Numbers in commit messages are measured, not
  estimated — if you quote one, you ran it.
- **Aggregation is the cheapest step and is not the justification for the worker.** Read ADR-0004
  before quoting a performance number.

## Traps already paid for

- A React memo over `SliceCache` reads must include the cache revision. `row` is a stable reader
  over mutating state, so a memo keyed only on the row range paints once and never updates.
  ADR-0017 spells this out.
- Papa's default 10MB `chunkSize` reads the hero Dataset in one synchronous callback, and a
  callback cannot receive the `cancel` message that would stop it. The kernel sets 512KB.
- Vite's dev server serves a `.gz` with `Content-Encoding: gzip`, so the browser has already
  decompressed it; other hosts pass the bytes through. The kernel sniffs the two-byte magic
  number rather than assuming either.
- A plain `Omit` over a discriminated union collapses it. `src/worker/port.ts` uses a
  distributive one.
- d3's `timeFormat` renders in **local** time and a bucket start is a UTC midnight, so it relabels
  every boundary west of Greenwich — 1872-11-30 reads 1872-11-29 in New York. Use `utcFormat`. The
  engine suite is expected to pass under `TZ=America/Los_Angeles` as well as UTC; run it both ways
  after touching anything that formats a date.
- A band domain is a Set of strings. A two-dimension result has several rows per x value, so they
  collapse onto one band unless the domain is deduplicated, and `new Date(String(epochMs))` is an
  Invalid Date rather than the moment.

## One thing known to be ahead of its tests

Nothing, at the time of writing. `timeBucket` was the outstanding case and M4 tested it across the
five units and the 1872–2026 span. If you leave a grammar field half-wired or an implementation
ahead of its tests, say so here and leave its ledger item unticked.
