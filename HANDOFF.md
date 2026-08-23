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
- `docs/adr/` — read the ADRs that touch the area you are about to work in. There are twenty-one.
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
- `src/workspace/` — **`Workspace`**, the facade the UI calls. Owns the Request lifecycle:
  dispatch, the Translator call, structural then semantic validation, the single Repair, worker
  execution, the staleness guards, and appending a Revision. Constructed with a Translator, which
  is what makes it testable without HTTP. Tests in `tests/workspace/`.
- `src/ai/` — the Translator seam and the Anthropic implementation behind it. `tool.ts` generates
  the tool schemas from the Zod grammar, `prompt.ts` builds what is sent, `models.ts` holds the
  two models and the per-model normalizer, `partial.ts` is the tolerant reader for the chip strip.
  The API key lives in a module variable in `anthropic.ts` and nowhere else. ADR-0020.
- `src/worker/kernel.ts` — everything the worker does, as a plain request-to-responses function.
  `dataset.worker.ts` adapts it to a real `Worker` in nine lines and `localPort.ts` adapts it
  in-process for the seam tests. One implementation, two adapters — do not fork it.
- `src/spec/` — the Zod grammar, the semantic validator, and `edits.ts`: the two manual edits and
  the option lists they offer, which are asked of the validator rather than restated.
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
- **The `Workspace` seam tests share `tests/workspace/harness.ts`** — the scripted Translator, the
  `attempt`/`analysis` builders, the gated port, and a `setup` that parses a four-row CSV through
  the real kernel. Three files use it now (`workspace`, `analysis`, `analysisCard`); use it rather
  than forking a fourth copy.
- **Every edit to an Analysis goes through the `Workspace`**, spoken or manual. `workspace.revise`
  is the manual path and it is deliberately `ask` without the Translator — same validation, same
  worker execution, same captured target, same Revision (ADR-0021). A control that writes a
  Revision into the store directly is a second dispatcher.
- **Tests that care about a ColumnType state it.** A small fixture falls under the 95% numeric
  threshold and infers categorical; `tests/engine/operation.test.ts` has the helper for this.
  Inference has its own tests and does not need testing again through the executor.
- **Say 99,040, never "100k+"** (`DECISIONS.md` §A6). Numbers in commit messages are measured, not
  estimated — if you quote one, you ran it.
- **Aggregation is the cheapest step and is not the justification for the worker.** Read ADR-0004
  before quoting a performance number.
- **A Zustand component that destructures the whole store re-renders on every narration frame.**
  Use selectors. `Header` did the former and had to be changed.

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
- Strict tool use takes a narrower JSON Schema than Zod emits. `oneOf` must become `anyOf`, every
  object needs `additionalProperties: false`, and `maxLength`, `maxItems`, `minItems` and the
  numeric bounds are rejected. `toStrictSchema` in `src/ai/tool.ts` is the one place that knows,
  and its allowlist is what to change when the subset moves.
- `messages.parse()` is non-streaming, so it cannot be used here at all. `messages.stream()` plus
  hand-validation with the same Zod schema at `message_stop` is the only path.
- In the tolerant partial-JSON reader, whether an unterminated string is a key or a value depends
  on the container it sits in, not just on the character before it: a comma inside `{` precedes a
  key, the same comma inside `[` precedes a value.
- The staleness guard that matters is the one after the worker responds, and testing it needs a
  port that holds its answer. Three model calls resolving out of order pass with that guard
  deleted; only a Request superseded *while its worker job runs* catches it.
- A line or an area chart over a categorical x-axis is a SpecViolation — a line joins its points,
  which implies an order a category does not have. The four-row fixture's natural spec is a count
  by `home_team`, so any test about chart types needs a `timeBucket` spec instead, or the toggle
  it is testing legitimately offers nothing.
- `ViewState` now carries `filters`, applied by `buildRowIndex` through the same `filterRows` the
  Operation executor uses. Do not add a second filter implementation for the table.

## Known to be ahead of its tests

One entry, at the time of writing. Its ledger item is deliberately left unticked.

**Prompt caching is implemented and unverified.** The `cache_control` breakpoint is on the last
system block and the readout shows `cache_read_input_tokens` as its own figure, but nobody has
seen that number come back above zero, because doing so needs a live API key and this repository
has none.

What *is* tested is the property caching depends on: `tests/workspace/prompt.test.ts` asserts the
tools + system prefix is byte-identical across two different Questions and across a Repair, so no
silent invalidator has crept in. The minimum cacheable prefix is roughly 1,024 tokens and a shorter
one fails to cache without saying so, which is the whole reason the figure is on screen. **First
task for whoever has a key: ask two Questions in one session and assert
`usage.cache_read_input_tokens > 0`, then tick the item.**

If you leave a grammar field half-wired or an implementation ahead of its tests, add it here and
leave its ledger item unticked.
