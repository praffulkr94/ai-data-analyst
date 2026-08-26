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
- `docs/adr/` — read the ADRs that touch the area you are about to work in. There are twenty-six.
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
npm run audit:contrast            # every contrast pair, both themes; exits non-zero on a regression
node scripts/build-datasets.mjs   # rebuilds public/data/*.csv.gz from data/raw/
node scripts/bench-run.mjs --machine "…"   # drives #/bench, writes docs/bench/. Needs the app up.
npm run test:e2e                  # the two Playwright flows over canned SSE. Needs the app up.
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
- `src/ai/` — the Translator seam and its two implementations. `tool.ts` generates the tool
  schemas from the Zod grammar, `prompt.ts` builds what is sent, `models.ts` holds the two models
  and the per-model normalizer, `partial.ts` is the tolerant reader for the chip strip. The API
  key lives in a module variable in `anthropic.ts` and nowhere else. ADR-0020.
  `fixtures.ts` is the demo repertoire as data and `fixtureTranslator.ts` replays it through the
  same `readMessage` the live stream uses. `faults.ts` is dev-only: it arms a damaged reply so
  every starred row of the failure taxonomy is one click away. `switching()` in `translator.ts`
  is what makes mode a per-Request choice of Translator and nothing else.
- `src/data/session.ts` — the URL hash and what a reload rebuilds from it. The only persistence
  there is. ADR-0022.
- `src/worker/kernel.ts` — everything the worker does, as a plain request-to-responses function.
  `dataset.worker.ts` adapts it to a real `Worker` in nine lines and `localPort.ts` adapts it
  in-process for the seam tests. One implementation, two adapters — do not fork it.
- `src/spec/` — the Zod grammar, the semantic validator, and `edits.ts`: the two manual edits and
  the option lists they offer, which are asked of the validator rather than restated.
- `src/chart/` — the three layers: dimensions, scales, dumb marks. A scatter adds three marks
  rather than a branch: `<Points>` (circles, and the Series label whether or not it drew them),
  `<PointsCanvas>` (one canvas per Series past `CANVAS_ABOVE`, over the plot area, transparent to
  the pointer), and `<PointsHover>` (the quadtree, which hit-tests for both renderers). The point
  and Series budgets live in `CHART_BUDGET` in the engine and travel on the `analyze` message —
  ADR-0023, read it before touching a cap.
- `src/table/` — the SliceCache and its React window.
- `src/ui/` — components.
- `src/perf.ts` — the whole of the instrumentation: `timed`, `mark`, a `since` that refuses to
  measure against a mark that is not there, and the two observers. No DOM, so `worker/kernel.ts`
  imports it too — a worker has its own performance timeline, and the phases inside a round trip
  are measured there and posted back as `Timings` on `parse:done` and `analyze:done`.
- `src/bench/` — the `#/bench` route, lazily imported by `main.tsx` and nothing else, so it is a
  chunk nobody who does not ask for it downloads. `paths.ts` holds the three paths and the two
  questions; `stats.ts` is the median, which every published number passes through and which is
  therefore tested. Driven by `scripts/bench-run.mjs`, output committed to `docs/bench/`.

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
- A thousands-separated number in a CSV has to be **quoted** — the separator is a comma. The first
  `messy.csv` wrote attendances as bare `52,341` and lost 1,943 of 2,021 rows to the tokeniser
  before the numeric rule it exists to demonstrate got a chance to run.
- `messy.csv`'s dirt rates are chosen against the 95% numeric rule, not sprinkled. One null token
  every seventeenth row pushes a column past the threshold and it infers categorical, at which
  point the file demonstrates the rule's absence rather than the rule.
- A retryable transport failure and a semantic one are two different bounded loops with two
  different budgets: `MAX_RETRIES` waits, `MAX_ATTEMPTS` repairs, and a wait must not consume a
  Repair. The SDK's own `maxRetries` is set to 0 — a retry the visitor cannot see is a wait they
  cannot understand.
- A mark that walks its rows in render costs that walk on **every** hover frame: the chart
  re-renders per pointer move, and `<Points>` mapping and sorting 98,899 rows took a hover frame
  to roughly a second. Memoize on the rows and the scales. `ResultTable` had the same problem from
  the other end and is now `memo`'d — safe there, where an `AnalysisResult` is an immutable value,
  and still not safe over the `DataTable`'s window (ADR-0017).
- A canvas cannot inherit a CSS custom property, so it reads `--series-n` in its own effect — and
  child effects run before parent effects, so the `data-theme` write in `App` has to be a
  `useLayoutEffect` or the canvas keeps the palette of the theme just left.
- `temporalLabel` receives three forms: a `Date` from a time scale, a stringified epoch from a
  band domain, and an **ISO day** from a `date` column that was grouped by rather than bucketed,
  because that is what `cellText` gives a date. It knew the first two, so a bar chart grouped by a
  raw date column labelled every tick "no value".
- A drag tracked in a local variable is reset by the re-render the drag itself causes: it moves
  one pixel and stops. It has to be a ref.
- `setPointerCapture` throws on a pointer id that is not down — which every synthetic event is —
  and jsdom does not implement it. The call is wrapped; the drag works without it, it just ends
  at the edge of the plot.
- jsdom has no 2D context, so nothing about the canvas can be asserted in the seam tests: they
  stub `getContext` to null and assert the elements are gone, the canvas is there, and the table
  beside it still is. The drawing itself is covered only by the browser check in the M8 commit.
- `zustand`'s plain `subscribe` fires on every `set`, narration frames included. Anything
  subscribing outside React — the hash writer does — needs its own cheap reference-equality guard
  on the values it actually cares about.
- There is no `jest-dom`, so there is no `toHaveAccessibleName`. Assert an accessible name with
  `screen.getByRole('img', { name: … })` — Testing Library computes it through
  `dom-accessibility-api`, which is already a dependency of `@testing-library/dom`.
- Chrome keeps a *sequential focus navigation starting point* that `blur()` does not move, so a
  scripted Tab walk resumes from the last thing clicked rather than from the top of the document.
  Rewind with Shift+Tab until focus falls off the top, then walk forward.
- Playwright's `locator.focus()` does not match `:focus-visible`, so a focus ring read after it is
  Chrome's default and not the application's. Read the ring after a real key press.
- A `PerformanceObserver` disconnected before its last entry has been delivered hands that entry
  to the *next* observer. Unfiltered, the worker path in `/bench` was credited with a 98 ms block
  that belonged to the path before it; entries are now checked against the moment their own path
  started.
- `performance.memory` is quantized and reported the same 45.2 MB for all three bench paths. It
  says nothing at this size and is not in the bench. `storeBytes` counts the ColumnStore exactly
  instead, and the row-objects comparison stays a DevTools heap snapshot (§13).
- A canvas frame that returns the pan to exactly `{0,0}` costs about five times one that moves it
  further out — 21 ms against 4.4 ms at 98,899 points, reproducibly, cause not established. It is
  recorded in `docs/bench/canvas-pan.json` under `anomaly`. Continuous panning never touches it.
- A dimension value is not its own label: a bucket holds epoch milliseconds and a `date` column an
  ISO day. `dimensionText` in `engine/result.ts` is the one place that knows, and `temporalLabel`
  lives in `engine/time.ts` rather than in `chart/marks.tsx` so the engine can reach it. The
  summary's extreme read "Highest: 1577836800000" until it did.
- Instrumentation in a render path needs a ceiling. `canvas:draw` is one mark and one measure per
  animation frame, nothing evicts user timing, and a continuous drag is sixty a second, so the
  timeline keeps the last `DRAWS_KEPT` frames and drops the rest. Anything else that measures
  inside a frame needs the same guard.
- A `route.fulfill` body arrives whole, so a canned SSE stream is read in one task and React
  coalesces every narration delta into a single render: the stream strip can appear and vanish
  between two Playwright polls, and asserting it was there from outside the page is a race.
  `scripts/e2e-run.mjs` records it with an in-page `MutationObserver` instead, and cancels while
  the fulfil is deliberately held rather than between two frames.
- Extensionless imports are why a `.mjs` script can `import '../src/ai/fixtures.ts'` (Node strips
  the types) but not `tool.ts`, which imports `../spec/grammar` without an extension and fails to
  resolve. A script that needs a name from a module like that copies the three-line map.
- There is no `--text-faint`. `--text-muted` is 5.05:1 on white and the AA floor for 12px text is
  4.5:1, so a third, fainter grey has nowhere legible to live. `npm run audit:contrast` fails if a
  fourth series slot drops below 3:1, or if anything else regresses.

## Where M10 stands

The UI restructure. Four commits on top of M9, `npm test` green at 439 across 30 files,
`npm run test:e2e` on both flows, `npm run audit:contrast` unchanged.

**M10 has no ledger items in issue #1.** The whole restructure was done outside the progress
ledger, so the state of record — which this document says wins over it — does not know M10
happened. Whoever picks this up should add the items and tick them, or decide the ledger closed
at M9 and say so there. Do not read the unticked M9 list as the whole of what is outstanding.

What landed:

- **The shell and nine surfaces** — `docs/ux-restructure.md` is the audit that produced it,
  ADR-0026 the decision. `main.tsx` hoists the worker, loader, cache and Workspace to module
  scope so `#/bench` and back does not re-parse. `DevPanel`, `SchemaPanel` and `UsageReadout` are
  deleted. New: `route.ts`, `spec/format.ts`, `EmptyState`, `InFlight`, `InferenceGate`.
- **The tools are no longer `strict`** — the grammar compiles to one the API rejects outright.
  ADR-0025. `ModelReply.safeParse` at `message_stop` is now the only thing enforcing shape.
- **Three degenerate Fixtures** landed before the preset buttons came down, so the keyless demo
  still reaches an empty result, the cardinality guard and the 98,899-point scatter.
- **The type menu got light-dismiss** — Escape and click-away, 17 lines in `Grid`,
  `typeMenu.test.tsx`. `pointerdown` not `focusout`, and the test that proves why is the one
  firing `pointerdown` on a menu item: a focus-based dismiss would shut the menu before its own
  click fired, on every browser where a button does not take focus when clicked.
- **`docs/ui-primitives.md`** — the assessment behind DECISIONS §15's *Radix first for new work*.

Verified by hand in a browser, over stubbed SSE, and **not covered by any automated test** — if
you change these paths, re-drive them:

- The `not-temporal` fix chip: two attempts spent → notice → *treat `x` as a date and retry* →
  retype → re-ask → Analysis lands. Reachable by bucketing a categorical column by time.
- The key dialog's `rejected` branch, on a 401 from the one-token verify.
- The rail's `updated` dot: dispatch a refine against one Analysis, navigate to another while it
  is in flight. Marker on the expanded row, dot on the collapsed 44px strip, cleared on read.

The unit tests that do guard the halves of the first one are `validate.test.ts` (the violation
carries `column`) and `failures.test.ts` (the failed notice carries `question`).

## Where M9 stands

Twelve of the fifteen ledger items are ticked, and at the close of M9 `npm test` was green at
419, `npm run test:browser` at 5, `npm run test:e2e` on both flows. (Current counts are in the
M10 section above; the numbers here are left as they were when the milestone closed.) **The three that are left all need
something this repository does not have**, and they are unticked rather than faked:

- A live API key — the model comparison over the same 20 Questions, and with it the two entries
  in the next section that are ahead of their tests.
- A person — the 90-second recording that belongs at the top of the README. The README says it
  is outstanding; delete that paragraph when it is not.
- Credentials — the deploy. `#/bench` is deliberately not dev-gated so it works on the deployed
  URL (ADR-0024); check that it does.

What landed in this last stretch, and the parts of it worth knowing before touching anything:

- **`npm run test:e2e` is real** — `scripts/e2e-run.mjs`, a plain `.mjs` with `assert`, no
  `@playwright/test`, needing the app up the way `bench-run.mjs` does. It routes
  `**/v1/messages` for both calls the application makes (the one-token key check and the
  streamed tool use) and builds the SSE frames from `src/ai/fixtures.ts`.
- **`README.md`** carries the honest framing: 0 ms of main-thread blocking against 2,627 ms, and
  the worker path 23 ms *slower* end to end. Two numbers to know before quoting them elsewhere:
  `blockedMs` in `docs/bench/` is the **sum over all nine runs** of a path, not one run, and
  columnar aggregation is *slower* than the object path on the 98,899-group question — 122 ms
  against 34 ms — so §7's "measurably tighter loop" did not survive measurement.
- **`docs/over-engineering-audit.md`** is the audit pass. Seven of its eleven findings are
  applied; two are the author's call (dropping `@tanstack/react-table` contradicts §6, and
  `Intl.NumberFormat` would change what an axis tick says), and two were withdrawn on
  inspection with the reason recorded. Read it before "simplifying" something it already
  considered.
- **The review pass** found two things and fixed both: `canvas:draw` was a mark and a measure
  per animation frame with nothing evicting them, and the README claimed `storeBytes` counts
  exactly when it charges strings at V8's worst case.
- **ADR-0024** is the milestone ADR — why the evidence is a page a stranger can re-run, and why
  the numbers that undercut §7 were published as they came out.

## Known to be ahead of its tests

Three entries at the time of writing. The two that are ledger items — caching and the Fixtures —
are deliberately left unticked; the third is a gap the same key closes.

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

**The Fixtures are hand-authored, not captured.** `src/ai/fixtures.ts` holds thirteen replies
written against the grammar rather than recorded from the API, for the same reason as above: no
key. They are structurally and semantically valid — `tests/workspace/fixtures.test.ts` parses every
one with Zod and runs every analysis through `validateSpec` against a hand-written `matches.csv`
DatasetSchema — and the replay chunks and paces them the way a real stream arrives. What is missing
is that the *wording* is mine rather than the model's, so Demo mode shows a plausible model rather
than an observed one.

**Whoever has a key: re-record them.** Ask each of the thirteen `question` strings in BYOK mode
with the Smart model, and replace that Fixture's `narration`, `input` and `usage` with what came
back. The narration is the text before the tool call, the input is the tool call verbatim, and the
usage is the four numbers from the readout. `fixtures.test.ts` will fail loudly if a re-recorded
reply drifts outside the grammar or names a column that does not exist. Then tick the item.

**Three of the Fixtures are degenerate on purpose, and they are hand-authored like the rest.**
M10 deleted the developer panel, whose three preset buttons were the only way to reach an empty
result, the cardinality guard and the 98,899-point scatter without a key. Those three are now
ordinary repertoire Questions — *"How many matches has Atlantis hosted?"*, *"How many matches were
played each day?"*, and *"How do goals scored compare with goals conceded?"* against
`team_matches`. Their specifications are valid; what is degenerate is the execution. They join the
re-recording debt above: the scatter one in particular claims a `usage` figure nobody measured.

**The primitives are hand-rolled, and that was never a recorded decision.** `docs/ui-primitives.md`
is the assessment: which drawn components are hand-rolled, what each is missing against the
design, and what a retrofit costs in measured bytes and tab stops. The short version is that four
surfaces build the same segmented toggle independently, the `#/data` type control is drawn as a
dropdown and built as a disclosure, and `<dialog>`/`<details>`/`<select>` should stay native
whatever else happens.

**The standing decision is in DECISIONS §15: new overlay work reaches for Radix first, installed
on first use.** It is not in `package.json` today — check before you import it. Existing controls
are not retrofitted; §5.3 of the assessment costs that out if it is ever wanted.

The type menu's light-dismiss ceiling is closed: Escape and click-away are handled in `Grid`
(`typeMenu.test.tsx`). What is still missing there is arrow-key navigation and `role="menu"`, and
there is a `ponytail:` comment at `DataTable.tsx` naming Radix's Dropdown Menu as the point to
stop growing the keyboard handling by hand.

**The 1280 laptop breakpoint is one media query, not a reviewed layout.** The design's own note —
the dataset chip drops its row count at ≤1280 — is implemented. Nothing else at that width has
been looked at. The four widths that *were* measured for horizontal overflow are in ADR-0026.

If you leave a grammar field half-wired or an implementation ahead of its tests, add it here and
leave its ledger item unticked.
