# AI Data Analyst — V1 Architecture Decisions

Outcome of a grilling session with a four-agent panel (PM, staff frontend engineer,
adversarial critic, reviewer/adjudicator). This is the document the implementation
plan derives from. Every decision here is settled unless marked OPEN.

## Fixed constraints (author's decisions)

- Built by Claude Code (agent-built). Build labor is cheap; the scarce resources are
  **comprehension/defensibility** and **verification**.
- Author reviews all code in one pass at the end and iterates. So: one concept per
  module, named after the concept; no module over ~200 lines without a reason.
- No backend. Static deploy. BYOK + demo mode.

## Verified facts

- Browser-direct Anthropic calls work: TS SDK `dangerouslyAllowBrowser: true`, CORS via
  the `anthropic-dangerous-direct-browser-access: true` request header.
- `messages.parse()` is non-streaming, so it is incompatible with the streaming
  decision below. Use `client.messages.stream()` + a `strict: true` tool and validate
  with the same Zod schema by hand at `message_stop`.

---

## 1. The premise, restated honestly

The LLM is an intent translator that returns a validated spec. **It never returns a
number, a finding, or a claim about the data.** New explicit non-goal: *"This is not a
chatbot."* Chart captions are computed deterministically by the app from the
aggregation result — never written by the model.

Because `strict: true` enforces schema conformance server-side, "we Zod-validate
untrusted LLM output" is NOT the headline. The **semantic** validation layer is.

## 2. The no-key visitor — Demo Mode (highest-ROI addition)

Demo Mode is the **default first-run path**, not a fallback. Pre-captured real Claude
SSE transcripts for ~12 canonical questions, replayed through the identical
`Translator` seam with realistic chunk timing. Only the *transport* is faked —
Zod validation, semantic validation, worker execution and D3 rendering are all real.

The same fixture layer is the Playwright mock. Dual-use is why this beats a proxy.

- Primary CTA "Try the demo"; "Use your own key" secondary.
- Honest badge: "Demo mode — canned responses, real execution."
- Free-text in demo mode returns "Demo mode answers these 12 questions — add a key."
- 90-second screen recording at the top of the README.

## 3. No backend — the honest version

A ~40-line rate-limited Cloudflare Worker proxy was seriously considered and is the
closest call in this document. It loses on the dual-use argument above. The README must
say this honestly rather than claiming backends are unnecessary:

> A proxy would be ~40 lines and would let visitors use the AI without a key. I chose
> fixture replay because it gives the same visitor outcome with zero infrastructure and
> zero cost exposure, and the same fixture layer is the Playwright mock. BYOK is the
> unlimited path. If this were a product, the proxy is the first thing I'd add — for
> rate limiting and prompt management, not for secrecy.

## 4. The spec DSL (the brief's most concrete defect, now fixed)

`§3`'s `{groupBy, metric, aggregation}` has **no time bucketing**, so the first
"revenue over time" question plots one point per raw timestamp — a garbage line chart
on the most common BI question there is. Filters/sort/limit were implied but unspecified.

```ts
const Filter = z.discriminatedUnion('op', [
  z.object({ op: z.enum(['eq','neq']),            column: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ op: z.enum(['gt','gte','lt','lte']), column: z.string(), value: z.number() }),
  z.object({ op: z.literal('in'),                 column: z.string(), values: z.array(z.string()).min(1).max(50) }),
  z.object({ op: z.literal('between'),            column: z.string(), from: z.number(), to: z.number() }),
  z.object({ op: z.literal('dateRange'),          column: z.string(), from: z.string(), to: z.string() }),
  z.object({ op: z.enum(['isNull','isNotNull']),  column: z.string() }),
]);

const Aggregation = z.object({
  id: z.string(),
  fn: z.enum(['sum','avg','count','countDistinct','min','max','median']),
  column: z.string().nullable(),          // null iff fn === 'count'
  label: z.string(),
});

const DerivedMetric = z.object({ id: z.string(), label: z.string(), numerator: z.string(), denominator: z.string() });

const Operation = z.object({
  filters: z.array(Filter).max(5).default([]),                 // AND only
  groupBy: z.array(z.string()).max(2).default([]),
  timeBucket: z.object({ column: z.string(), unit: z.enum(['day','week','month','quarter','year']) }).nullable().default(null),
  aggregations: z.array(Aggregation).min(1).max(3),
  derived: z.array(DerivedMetric).max(1).default([]),
  sort: z.object({ by: z.string(), dir: z.enum(['asc','desc']) }).nullable().default(null),
  limit: z.number().int().min(1).max(1000).nullable().default(null),
});

const Visualization = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['bar','line','area']), x: z.string(), y: z.string(), seriesBy: z.string().nullable().default(null) }),
  z.object({ type: z.literal('scatter'),          x: z.string(), y: z.string(), seriesBy: z.string().nullable().default(null) }),
]);

export const ModelReply = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('analysis'), intent: z.enum(['new','refine']), title: z.string().max(60),
             narration: z.string().max(160), operation: Operation, visualization: Visualization }),
  z.object({ kind: z.literal('clarification'), question: z.string(), options: z.array(z.string()).min(2).max(4) }),
  z.object({ kind: z.literal('unsupported'), reason: z.string(), suggestions: z.array(z.string()).min(1).max(3) }),
]);
```

`timeBucket` is separate from `groupBy` because the x-axis needs to know it's temporal.

**Deliberately cannot answer:** joins/multi-table; window functions and
period-over-period ("vs last month"); per-group growth ranking ("which region grew
fastest"); cohorts; forecasting; causal "why"; OR/nested filters; arbitrary expressions
beyond one ratio.

**UX when it can't:** never an error. `unsupported` returns a reason + 1–3 clickable
nearest-supported chips; `clarification` returns 2–4 options. Both are card variants.
A designed refusal that names its own boundary is a better artifact than a bigger
grammar — and the ceiling is a direct, accepted consequence of not sending rows to the
model. Say that in the README.

## 5. Data core — worker-resident columnar

The main thread **never holds the row set**. It holds only
`DatasetHandle { id, rowCount, columns: ColumnMeta[], sampleRows }`.

Layout: `Float64Array` for numerics and epoch-ms dates. Dictionary encoding
(`{ codes: Int32Array, values: string[] }`) for string columns measured under 50%
cardinality; plain `string[]` above. `NaN`/`-1` null sentinels + per-column `nullCount`.
Rejected: Arrow, bitmask null vectors, a generic type system.

Papa Parse runs **inside** the worker in chunk mode (a one-shot 100k-row
string→objects pass is a 2–4s block wherever it runs).

Protocol — hand-rolled discriminated-union RPC with correlation ids. **No Comlink**: it
hides the exact mechanism the project exists to demonstrate.

```
→ parse(jobId, file)            ← parse:progress(rows) / parse:done(handle)
→ view(jobId, viewState)        ← view:done({ viewVersion, rowCount })   // never rows
→ slice(jobId, offset, limit)   ← slice:done({ rows, viewVersion })     // ≤ few hundred
→ analyze(jobId, spec)          ← analyze:done({ result, truncated })    // ≤1000 points
→ cancel(jobId)
```

One worker, not a pool (a pool needs either duplicated datasets or SharedArrayBuffer).
Cancellation is cooperative: long loops check a `cancelledJobs` set every ~8–16k rows.
`terminate()` is the nuclear option and loses the dataset — never the primary path.
SharedArrayBuffer/COOP-COEP: **no** — it breaks static hosting for a benefit this
design doesn't need. Documented as considered-and-rejected.

## 6. Virtualized table over worker-owned rows

Riskiest part of the project and therefore the best interview story.

- Worker computes an `Int32Array` **RowIndex** for sort/filter, returns only
  `{ viewVersion, rowCount }`.
- Main thread keeps an SliceCache of ~40 slices × 100 rows; renders synchronously against it;
  a miss renders a skeleton row and enqueues a fetch.
- **Fixed row height is mandatory** — dynamic measurement plus async data is where this
  design dies.
- Stale responses are dropped by comparing `viewVersion` and current range **on
  arrival**, not by cancelling. Skeletons during a fling are correct behavior.
- TanStack Table runs in fully manual mode (`manualSorting`, `manualFiltering`,
  `getCoreRowModel` only) — a headless column/header/state manager, never a data engine.

## 7. The performance story — reframed to survive interrogation

The brief's framing was a straw man. A `Map` groupBy over 100k parsed rows is ~15–30ms,
and naively `postMessage`-ing rows costs more main-thread serialization than the compute
it escapes. One interviewer question kills it.

**Honest framing, verbatim in the README:** *aggregation is the cheapest step and is not
the justification.* The worker exists to **own the dataset** and keep **parsing, type
inference/coercion, index building and sorting** off the main thread. Aggregation runs
there because that is where the data lives.

Three headline numbers:

1. **Long-task time during load + first analysis of a 150k-row dataset.** Naive
   main-thread path: blocking tasks in the hundreds of ms. Worker path: **zero long
   tasks on main**, INP under 200ms during a concurrent scroll. This is the money
   number, and it's about parse/inference/sort — not groupBy.
2. **Table render:** unvirtualized 150k×N (tab hangs / 20s+) vs ~30 rendered rows,
   first paint <100ms.
3. **Memory + aggregate-loop time**, row-objects vs columnar: typically 3–6× memory
   reduction plus a measurably tighter loop.

## 8. AI layer

**Mechanism:** streamed strict tool use. Zod is the single source of truth; the tool's
`input_schema` is generated from it at module init so drift is impossible.

**Two validation layers, deliberately separated:**

- **Structural (Zod, dataset-independent):** shapes, enums, required fields.
- **Semantic (a pure TS function, `validateAgainstSchema(spec, datasetSchema)`):**
  column exists; metric is numeric; illegal aggregation for type; groupBy cardinality
  cap; Visualization/result-shape compatibility; Visualization fields exist in the **output** of the
  operation, not just the source columns.

Not Zod refinements with a context object — this validator is the highest-value
unit-test target in the codebase and belongs as plain TS with a rich typed error list.

**Repair: exactly one retry, semantic failures only.** Append the failed tool call plus
`tool_result { is_error: true }` carrying the structured errors ("column `revenu` does
not exist; available numeric columns: revenue, units"). Then a recoverable card error
with suggestions as chips. A `for` loop with `maxAttempts = 2` is not orchestration —
and stating exactly where it *would* become orchestration is the strongest defense of
the no-LangGraph decision.

**What streams, frame by frame:**

1. 0ms — user bubble, "Thinking…" shimmer, cancel button visible.
2. ~400ms–1.5s — the `narration` field streams as text deltas, typed live. This is the
   payoff: the user knows they were understood before any data moves.
3. concurrently — `input_json_delta` accumulates; a chip strip fills in as fields become
   parseable (`region` → `revenue` → `avg` → `bar`), via a tolerant partial-JSON reader
   **for display only**. Never feed partial JSON to Zod.
4. `message_stop` — parse → Zod → semantic → worker.
5. +10–40ms — chart animates in; status collapses to a deterministic app-computed ChartSummary.

**Cancellation/staleness: latest-wins, one monotonic `requestId` counter spanning both async
boundaries. No queue.** Per-boundary cancellation produces the invisible bug where the second
Request's model call aborts but the first Request's worker job still lands and overwrites the chart. Every
continuation opens with `if (request.requestId !== currentRequestId) return` — after LLM resolve, after
validation, after worker resolve. Worker cancel is best-effort; the staleness guard is what
makes correctness independent of it. History appends **only on success**, so an abandoned
Request never poisons the next Request's context.

Three questions in four seconds → exactly one chart renders.

## 9. Conversation model — analysis cards, not chat

Left rail lists cards. A follow-up creates a **new revision inside the selected card**
(`‹ 2/3 ›` stepper) and mutates the canvas in place; a new topic creates a new card. The
model's `intent: 'new' | 'refine'` decides which.

Refine requests receive **the previous spec plus the last 2–3 exchanges — not the full
history**; the model patches a spec object. Spec revisions are immutable values, so undo
is a free step-back wired to Cmd+Z. No branching trees.

## 10. Rendering

Six d3 submodules: `d3-scale`, `d3-shape`, `d3-array`, `d3-time-format`, `d3-format`,
`d3-scale-chromatic` (+ `d3-quadtree` for scatter hit-testing, `d3-interpolate` if
needed). **No `d3-axis`, `d3-selection`, `d3-transition`, or the `d3` meta-package.**
~30kB vs ~250kB, and React owns every DOM node — which is the actual answer to "how did
you divide React and D3."

Ticks come from `scale.ticks()` rendered as React `<g>`. Three abstraction layers and no
more: `useChartDimensions()` (ResizeObserver + margin convention), `useScales()`
(memoized), and dumb marks (`<Bars> <Line> <Area> <Points> <XAxis> <YAxis> <Grid>
<Tooltip>`) composed under `<ChartFrame>`. **Forbidden:** a `<Chart type="bar">`
mega-component with 40 props.

All four chart types ship. Canvas for **scatter above 5k points**; SVG below and for all
aggregate charts (which are ≤1000 points by construction). Quadtree hit-testing.

Tooltips: a single portal element positioned from pointer coords + quadtree/scale
inversion. Never a `<title>` per mark, never per-mark React state. ResizeObserver entries
are the only measurement source — no `getBoundingClientRect()` in effects.

## 11. Table ↔ chart coupling

One direction only: the active analysis filters the table view, shown as a removable
chip. **Table sort/filter never drives the chart** — two sources of truth for the spec is
a genuine product bug.

Manual controls: chart-type toggle and aggregation dropdown only. These strengthen
rather than weaken the AI story — natural language becomes *one of two editors over the
same app-owned spec*, which proves the spec is a real object rather than blindly-rendered
model output. Manual and AI edits produce identical revision objects in one history. No
axis/field pickers (that's a chart builder).

## 12. State

Zustand, one small store, ~5 slices, no middleware zoo. Justified specifically because
the worker RPC layer and the Request dispatcher write state from outside the React tree, and
selector subscriptions let the chart re-render without re-rendering the table.

- **Zustand:** `datasetHandle`, `columns`, `analyses[]`, `activeAnalysisId`, `viewState`, `chartOverrides`
- **Worker module (outside React):** rows, RowIndexs, SliceCache — exposed via `useRowSlice(range)`
- **React local:** dialogs, composer input, hover, dropdowns, tooltip position

**TanStack Query: rejected.** No server cache, no refetch, no invalidation, and its
caching model fights single-flight-latest-wins. The reasoned rejection is worth more than
the dependency — write the ADR.

**Re-render storms:** stream deltas into a ref, flush on `requestAnimationFrame` at
≤60fps into a narrow slice only the streaming bubble subscribes to. Chips update on field
completion, not per delta. Never put per-token text in the same slice as `analyses[]`.

## 13. Performance evidence

A dev-only, code-split **`/bench` route** running each operation N≥7 times across three
paths (main-thread naive row-objects, main-thread columnar, worker columnar), reporting
medians with min/max. Credibility comes from reproducibility by a stranger, not a table in
a README. **The author personally re-runs it before any number ships.**

APIs: `performance.mark`/`measure` around parse, inference, index build, aggregate, first
chart paint (including inside the worker); `PerformanceObserver` on `'longtask'` during a
scripted scroll+submit; `PerformanceObserver` on `'event'` with `durationThreshold: 16`
for INP; DevTools heap snapshots for the columnar memory comparison. Plus a Playwright +
CDP trace run for interaction numbers. Commit the raw JSON; name machine and Chrome
version; never report a single run.

## 14. Testing

- **Unit seam:** a `Translator` interface injected at app root. Real impl wraps the
  Anthropic SDK; tests inject a scripted fake. Vitest never touches HTTP. This is a
  *test* seam, not a provider abstraction.
- **E2E:** Playwright `page.route('**/v1/messages')` returning canned **SSE** bodies with
  real `message_start` / `content_block_delta` / `input_json_delta` / `message_stop`
  frames — SSE parsing and abort behavior is where the real bugs live. No MSW.
- **Tested:** type inference against nasty CSVs; aggregation correctness (nulls,
  single-group, cardinality truncation) property-tested against a naive reference; every
  branch of the semantic validator; **the staleness test** — fire gens 1,2,3 resolving out
  of order, assert only gen 3 lands (the single highest-value test in the project).
- **Theater, skipped:** SVG path snapshots, tests asserting Zod rejects a missing field,
  "renders without crashing," coverage thresholds.
- **Worker:** transforms are plain exported TS, unit-tested in Node (90% of the value).
  One integration suite in `vitest --browser` (Playwright provider) where
  `new Worker(url, {type:'module'})` actually exists — correlation-id matching, cancel
  mid-job, out-of-order responses.
- Chromium only.

## 15. Accessibility

The chart's aggregated data table **is** the accessible representation — exposed both to
screen readers (`aria-describedby` → visually-hidden `<table>`) and as a visible "View as
table" toggle. The visible toggle is the key move: it makes the a11y representation a
product feature that can't silently rot.

Chart `role="img"` with a generated summary label ("Bar chart, average revenue by region,
5 categories, highest: West at $1.2M"). Keyboard-navigable marks for **bar only** (roving
tabindex, arrow keys, per-bar `aria-label`) — doing bar well beats doing four badly.
`prefers-reduced-motion` honored in the transition hook. Never encode a category by color
alone.

**Cut:** arrow-key traversal for line/area/scatter; `aria-live` on tooltip hover
(announcement spam); a bare `tabindex="0"` on the SVG passed off as keyboard support.

## 16. Milestones

Each leaves a working app and adds one ADR.

1. **Shell + sample dataset + schema inference.** Done: loads `sales.csv` in a worker,
   shows inferred schema with type overrides. No chart yet.
2. **Virtualized table over worker-resident ColumnStore.** Done: 150k rows scroll at
   60fps, sort/filter worker-side, skeletons on fling, `viewVersion` drops stale windows.
3. **Spec → worker → bar chart, hardcoded spec, no AI.** Done: a hand-typed spec in a dev
   panel renders a correct bar chart. *This milestone proves the pipeline is app-owned.*
4. **Line + area + time bucketing.** Done: monthly revenue renders from a `timeBucket` spec.
5. **AI layer.** Streamed strict tool use, Zod + semantic validation, one repair retry,
   cancellation/staleness. Done: BYOK entry, real question → chart, and the
   3-questions-in-4-seconds test renders exactly one chart.
6. **Analysis cards, revisions, refine-vs-new, manual controls, undo.** Done: "change this
   to a line chart" mutates revision 2 of the same card.
7. **Demo mode + fixtures + full error taxonomy + degenerate-result states.** Done: a
   visitor with no key completes the 90-second flow; every error state reachable from a
   dev panel.
8. **Scatter + canvas above 5k points + quadtree hit-testing.** Done: 100k-point scatter
   pans and hovers smoothly.
9. **A11y pass, `/bench`, Playwright suite, README + ADRs + recording, deploy.** Done:
   live URL, real numbers, the §24 questions answered in writing.

## 17. Datasets

- `sales.csv` (~5k) — date/region/category/rep/units/revenue. The hero demo.
- `flights.csv` (~150k, shipped gzipped and fetched) — the performance dataset.
- `messy.csv` (~2k) — deliberately dirty: mixed date formats, thousands separators,
  blanks, BOM, CRLF, a 90%-numeric column with junk, duplicate headers. Nobody ships
  this one; engineers will notice it.

Upload: warn at 20MB, hard cap 50MB, row cap 500k with an explicit truncation banner —
never a hang. Malformed rows never fail the file: "Parsed 4,981 of 5,000 · 19 skipped"
with the first 10 expandable.

## 18. Failure taxonomy (★ = must be demoable)

| Failure | UX |
|---|---|
| Invalid key (401) | ★ Inline in key dialog: "key rejected" — never blame the network |
| Rate limit (429) | Card-level retry with backoff countdown; question stays editable |
| Overloaded (529) / network | Retry; prior analyses remain usable |
| User cancel | ★ Immediate; card returns to input; stream fully torn down |
| Raced/stale response | ★ Older response discarded via gen guard (demo by double-submit) |
| Malformed JSON / Zod fail | ★ One auto-repair retry, then a recoverable card error |
| Unknown column | ★ Message names the column and lists valid ones |
| Unsupported question | ★ `unsupported` card + nearest-supported chips |
| Empty result | ★ Empty state showing applied filters + "remove filter", not a blank SVG |
| Cardinality blowup | ★ Guard before render: 50k distinct categories → refuse, offer top-N |
| Worker crash | Per-analysis error, worker respawned, app never white-screens |
| Huge/odd file | Cap + truncation banner; non-CSV rejected at picker |

Also defined: the degenerate-result visual set — 0 rows / 1 row / 800 groups / all-null.

## 19. Final cut list

Column resizing · table filter builder · TanStack Query · LangChain/LangGraph ·
multi-provider abstraction · chart export/PNG · dataset persistence/IndexedDB ·
SharedArrayBuffer/COOP-COEP (documented as considered-and-rejected) · worker pool ·
Comlink · `d3-axis`/`d3-selection` · arrow-key traversal for line/area/scatter ·
multi-browser Playwright · LLM-written insight prose · any settings page · full chat history sent to the model.

## 20. Additions to the brief (now in scope)

Demo mode + fixtures · `clarification`/`unsupported` variants · `timeBucket`, filters,
sort, limit, one derived ratio · user-editable column types · a "what the model sees"
JSON inspector · per-request token/cost readout · cardinality and renderability guards
between spec and chart · the degenerate-result visual set · the full API error taxonomy ·
key verification on entry via a `max_tokens: 1` Haiku call · the `/bench` route ·
hash-encoded shareable analysis state · `messy.csv` · a 150k-row gzipped sample ·
the ADR log · the explicit "not a chatbot" non-goal.

## 21. What the panel collectively missed

1. **Schema inference is the demo-killer, not a component.** It is where a live demo
   breaks in front of a hiring manager and deserves the rigor the perf story gets:
   explicit rules, a confidence notion, sampled inference (first N + random N, **never**
   first 100), and the visible override.
2. **Nobody costed the prompt.** What's in the system prompt, how many sample values per
   column go to the model (and are they PII?), tokens per Question, `max_tokens`. A BYOK app
   that silently burns the user's key is a product bug — and the prompt is the artifact
   that determines whether the intent-translation thesis actually works at all.
3. **Refresh semantics undefined.** In-memory-only key means refresh loses it; the brief
   never says what happens to the dataset. With hash-encoded spec state: sample datasets
   re-fetch and the analysis restores; uploaded files cannot, and the app must say so
   rather than silently emptying.

## RESOLVED — author decisions (details in the Addendum below)

1. **Visual design direction** → Linear. See A2.
2. **Model choice** → both, user-switchable: `claude-sonnet-5` (Smart) and
   `claude-haiku-4-5` (Fast). See A3.
3. **Sample dataset domain** → football, public-domain international match results. See A4.

No open items remain. The plan is complete.

---

# Addendum — author decisions (2026-08-22, second round)

## A1. Demo/BYOK toggle (replaces the one-way demo-mode entry)

A persistent segmented control in the header: **`Demo` | `Your API key`** (modes: `demo` | `byok`). Switchable at any
time in either direction, not a one-way door at first load.

- Defaults to `Demo` on first visit.
- Switching to `Your API key` opens the key dialog. Key is verified immediately with a
  `max_tokens: 1` Haiku call before the mode flips, so a bad key never becomes a
  mid-analysis failure.
- Switching back to `Demo` **keeps the key in memory** for the rest of the session, so a
  visitor can toggle freely without re-pasting.
- The dataset, analysis cards and revision history survive the switch untouched — mode
  affects only which `Translator` implementation is injected. This falls out of the seam
  design for free.
- In `Demo`, suggested-question chips are live and free-text is disabled with an inline
  hint naming the 12 available questions. In `Your API key`, free-text is enabled and a
  per-request token/cost readout appears.
- Mode is reflected in the URL hash so a shared link can pin demo mode.

## A2. Visual direction — Linear

**Linear is the reference.** Chosen over Notion because Notion is a document tool and is
deliberately low-density, which creates a per-screen judgement call ("how much Notion applies
here?") every time it meets a 100k-row data grid. Linear is already a dense,
information-heavy tool, so the reference matches the artifact and there is nothing to adapt.

Secondary reasons: the target audience (senior frontend engineers) already reads Linear as a
craft benchmark; Linear's dark-first-with-real-light-mode forces named design tokens, which
is the same discipline the a11y contrast and reduced-motion requirements demand; and Linear's
keyboard-first culture makes the keyboard work already in scope (Cmd+Z undo, roving tabindex
on bars, focus management) read as intentional design rather than an a11y checkbox.

What to take: tight vertical rhythm and compact type scale; hairline borders over shadows;
crisp 6–8px radii; fast, short, restrained motion (~120–180ms, no bounce); high-contrast
text on a low-contrast ground; dense tables with ~28–32px rows; keyboard affordances shown
inline; icon-light, label-first controls.

**What NOT to take: the purple.** Pick a distinct accent. Linear-derived portfolios are
common enough that copying the accent turns "good taste" into "traced". Structure, density
and motion restraint are the borrowable parts; the hue is not.

Chart palette still obeys the rules already set — 3:1 non-text contrast, category never
encoded by colour alone — tuned to sit inside the chosen accent's range in both themes.

### Consequent changes to earlier decisions

- **Dark mode moves from CUT to IN SCOPE.** It is core to the reference, not a bonus. This
  removes "dark mode unless design tokens make it free" from the §19 cut list. Both themes
  are defined as tokens from milestone 1; a theme added late means touching every screen.
- Table rows tighten to ~28–32px with a compact type scale (was "~32px" under Notion).
- The accent colour is an explicit decision, not a framework default.

Runner-up, recorded for the ADR: Stripe's dashboard — arguably the best-executed analytics
interface on the web and the closest match to this exact layout problem (tables, filters and
charts co-resident), rejected because its look depends on subtle shadow and colour work that
degrades to "generic corporate dashboard" when slightly off, whereas Linear's is reachable
with spacing, borders and one accent.

## A3. Model switcher — Sonnet 5 vs Haiku 4.5, user-selectable

A model picker in the composer, ChatGPT/Claude-style. Two options only:

| Label | Model ID | Input $/1M | Output $/1M |
|---|---|---|---|
| Smart | `claude-sonnet-5` | $3.00 (intro $2.00 through 2026-08-31) | $15.00 (intro $10.00) |
| Fast | `claude-haiku-4-5` | $1.00 | $5.00 |

Verified: **both support structured outputs / strict tool use**, so the validation
architecture is identical across models. Selection is persisted per session and recorded on
each analysis revision, so a card shows which model produced it.

**Implementation note that must not be missed —** the two models do not take the same
request parameters:

- `claude-sonnet-5`: `thinking: {type: "adaptive"}`, supports `output_config.effort`, and
  **rejects** `temperature`/`top_p`/`top_k` and `budget_tokens` with a 400.
- `claude-haiku-4-5`: pre-4.6 generation — `effort` **errors**, thinking uses
  `{type: "enabled", budget_tokens: N}`, sampling params are allowed.

So the client needs a small per-model request normalizer. This is a real, defensible piece
of engineering and belongs in an ADR — not a hidden `if`.

The README comparison stays in scope: same 20 questions through both models, reporting
spec-correctness rate, latency and cost, rendered as a chart in the app's own chart layer.

## A4. Datasets — football, real and public domain

Domain: football. Source: [martj42/international_results](https://github.com/martj42/international_results),
**CC0-1.0** (public domain, no attribution obligation).

| File | Rows | Role |
|---|---|---|
| `matches.csv` | 49,459 | Hero demo. Ships as-is. `date`, `home_team`, `away_team`, `home_score`, `away_score`, `tournament`, `city`, `country`, `neutral` |
| `team_matches.csv` | 98,918 | Performance dataset. Derived: one row per team per match, with `team`, `opponent`, `is_home`, `goals_for`, `goals_against`, `goal_diff`, `result` (W/D/L), plus the match columns |
| `messy.csv` | ~2,000 | Deliberately dirty slice of real rows: mixed date formats, `1,234` attendance, blank cells, BOM, CRLF, a 90%-numeric column with junk, duplicate headers |

`team_matches.csv` is built by a **committed, re-runnable transformation script**, not
hand-assembled — the row count is real, the derivation is auditable, and it doubles as
evidence for the perf numbers. Both large files ship gzipped and are fetched.

If the perf story later wants 250k+ rows, pull public-domain domestic-league match data
(footballcsv / openfootball) rather than synthesising rows. **Never fabricate data to
support a performance claim.**

Why this dataset is a good fit beyond the licence: 152 years of dates makes time bucketing
(day/week/month/quarter/year) genuinely meaningful; `tournament`, `country`, `team` are real
categoricals with sane cardinality; scores are clean integers. Natural demo questions —
"goals per match by decade", "matches by tournament", "average goals scored by Brazil over
time", "top 10 countries by matches hosted".

Supersedes the `sales.csv` / `flights.csv` plan in §17.

---

# Addendum 2 — design tokens and the real data profile (2026-08-22)

## A5. Accent colour and chart palette — decided and validated

**UI accent: `#5E6AD2` — Linear's exact brand accent** (their "lavender-blue", used on the
brand mark, focus rings and primary CTA). Confirmed against Linear's own brand material, not
approximated. Author decision: sharing Linear's accent exactly is acceptable.

Full accent token set, with Linear's own hover and focus variants:

| Token | Light | Dark | Contrast |
|---|---|---|---|
| `--accent` (fill, focus ring, active) | `#5E6AD2` | `#5E6AD2` | white text 4.70:1 ✓ AA · vs `#08090a` 4.24:1 ✓ |
| `--accent-hover` | `#4F5BD5` | `#828FFF` | white text 5.54:1 ✓ / vs dark surface 6.95:1 ✓ |
| `--accent-focus-tint` | `#5E69D1` | `#5E69D1` | 4.36:1 vs light · 4.19:1 vs dark ✓ |

Note the hover token **must** split by mode: Linear's `#828FFF` is a *dark-mode* hover — on a
light surface it only reaches 2.87:1 with white text and fails AA. Light mode hovers darker
(`#4F5BD5`), dark mode hovers lighter (`#828FFF`).

**Surfaces: `#ffffff` (light) and `#08090a` (dark)** — Linear's *app* surfaces. Deliberately
NOT Linear's published brand greys (Mercury White `#F4F5F8`, Nordic Gray `#222326`): those are
wordmark colours ("preferred for monochrome wordmark usage" per Linear's own brand page), and
measured against them the palette gets worse — on `#F4F5F8` a **fourth** slot drops below 3:1
(orange 2.94, yellow 1.99), widening the relief obligation for no benefit. `#222326` does hold
all six at ≥3:1, but thins the accent to 3.34:1 versus 4.24:1 on `#08090a`. Pure white and
near-black are both closer to the real product and measurably better.

**Why this accent works with the data palette:** the data slots occupy blue, orange, aqua,
yellow, magenta and green (below). Indigo-violet is the only hue family *not* doing data duty,
so the accent can never be mistaken for a series. Caveat: indigo sits next to series-1 blue and
the two are close in luminance (ratio 1.06). Mitigation is positional — accent colour appears
only on chrome (buttons, focus rings, active nav), never inside a plot area. Same trade Linear
itself makes.

**Categorical data palette — 6 slots, fixed order, never cycled:**

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | orange | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |
| 6 | green | `#008300` | `#008300` |

Validated with the dataviz validator against **our actual surfaces**, both modes:

- Light on `#ffffff`: lightness band PASS, chroma floor PASS, CVD separation PASS (worst
  adjacent ΔE 9.1), normal-vision floor PASS (worst 19.6), **contrast WARN** — aqua (2.82),
  yellow (2.17) and magenta (2.69) fall below 3:1 on white.
- Dark on `#08090a`: all five checks PASS, including contrast ≥3:1 for all six.

**The light-mode contrast WARN is not dismissable — it obligates relief.** Both required
reliefs are already in the plan, so they are now hard requirements rather than nice-to-haves:
direct labels on marks, and the "View as table" toggle. If either gets cut, the palette is
non-compliant.

**Reserved, never used as a data series:** indigo-violet (UI accent), and red
`#e34948`/`#e66767` plus the status palette (good `#0ca30c`, warning `#fab219`, serious
`#ec835a`, critical `#d03b3b`) for the error/state taxonomy in §18. A status colour never
carries meaning alone — always icon + label.

**Series cap (new requirement):** at most **6 series**, then fold to "Other". For all-pairs
forms (scatter) the cap is **3 series** — past three, yellow and orange appear together and
fail the all-pairs floors. This is not optional; see A6 for why it will fire immediately.

Sequential (magnitude/heat): single blue hue ramp, `#cde2fb` → `#0d366b`. Diverging: blue ↔
red with a gray midpoint (`#f0efec` light / `#383835` dark). Never a rainbow.

## A6. The real data — profiled, not assumed

Downloaded and profiled `results.csv` (49,520 rows) and `goalscorers.csv` (47,914 rows).
Raw files committed under `data/raw/` with `SOURCE.md`. **Six findings change the plan.**

### Two assumptions were wrong (in our favour)

1. **Dates are perfectly clean.** 100% ISO `yyyy-mm-dd`, all 49,520 rows, 1872-11-30 →
   2026-07-19. No mixed formats across 155 years. My concern about ambiguous `03/04/2024`
   does not apply to this dataset — it stays a `messy.csv` test case only.
2. **Scores are perfectly clean integers.** `home_score` 0–31, `away_score` 0–21, zero
   blanks, zero ragged rows, zero duplicate rows in `results.csv`.

### Four findings that add real work

3. **BOOLEAN IS A MISSING COLUMN TYPE.** `neutral` is `TRUE`/`FALSE`; `goalscorers` adds
   `own_goal` and `penalty`. The brief's schema has only `date | categorical | number`. A
   boolean typed as categorical makes "% of matches on neutral ground" awkward and "average
   of neutral" nonsense. **Add `boolean` as a first-class inferred type**, with `count` and a
   `rate`/percentage-true aggregation legal on it, and `sum`/`avg` rejected by the semantic
   validator. This is a real gap in the original brief.

4. **The mixed-type column exists for real, and it is the classic inference trap.**
   `goalscorers.minute` is a valid integer for 47,660 of 47,914 values — the remaining 254
   are the literal string `"NA"`. Naive inference sees a non-numeric value and types the
   column **categorical**, at which point "average goal minute" becomes impossible and the AI
   looks broken with no recovery.

   **Concrete inference rule, derived from real data rather than invented:** a column that is
   ≥95% parseable as a number, where every remaining value is in a recognised null-token set
   (`NA`, `N/A`, `-`, `--`, `null`, `NULL`, `n/a`, `""`), is typed **number with nulls** — not
   categorical. Null tokens become `NaN` and are excluded from aggregations, with the excluded
   count surfaced in the chart caption. Every branch of this rule is a unit test.

5. **The cardinality guard fires on day one — it is not theoretical.** `city` has **2,092
   distinct values**, `tournament` 202, `country` 269, `scorer` 15,350. "Matches by city" is a
   completely natural first question and would render 2,092 bars. **Default: top 15 by metric
   + "Other"**, with the caption naming what was folded ("showing top 15 of 2,092 cities").
   Combined with the 6-series cap in A5, this is now a specified behaviour rather than a
   guard-rail afterthought.

6. **Quoted commas and non-ASCII are both present in real rows.** 13 `tournament` values and
   64 `city` values contain commas, so the file genuinely exercises quoted-field parsing. 14
   team names are non-ASCII (`Curaçao`, `Réunion`, `Ryūkyū`, `Székely Land`, `Găgăuzia`) along
   with 11,639 `scorer` values. No ASCII assumptions anywhere; the dictionary encoder must be
   UTF-8 safe; and string sorting needs `localeCompare` — which is precisely the expensive
   sort the worker exists for, now with a real justification instead of a hypothetical one.
   `goalscorers.csv` also carries **79 exact duplicate rows** — real dirt, free of charge.

### Dictionary encoding — validated by the actual numbers

The A4/§5 rule was "dictionary-encode string columns under 50% cardinality." Measured:

| Column | Distinct | Rows | Ratio | Encodes? |
|---|---|---|---|---|
| `home_team` | 328 | 49,520 | 0.7% | yes |
| `tournament` | 202 | 49,520 | 0.4% | yes |
| `country` | 269 | 49,520 | 0.5% | yes |
| `city` | 2,092 | 49,520 | 4.2% | yes |
| `scorer` | 15,350 | 47,914 | 32.0% | yes |

Every string column in the real dataset dictionary-encodes, `scorer` least comfortably. So
the columnar design is justified by measurement, not assumption — and the ratio table goes in
the perf ADR.

### Final dataset roster (supersedes A4's row estimates)

| File | Rows | Role |
|---|---|---|
| `matches.csv` | **49,520** | Hero demo. `results.csv` shipped as-is. |
| `team_matches.csv` | **99,040** | Perf dataset. One row per team per match, built by a committed script. |
| `goals.csv` | **47,914** | Player-level. Carries the `"NA"` mixed-type column and the 79 duplicates — the inference showcase. |
| `messy.csv` | ~2,000 | Hand-dirtied slice: mixed date formats, `1,234` thousands separators, BOM, CRLF, duplicate headers. |

**Say 99,040, never "100k+".** It is just under the brief's target and rounding up is exactly
the kind of soft claim the perf story cannot afford. If a larger stress file is wanted later,
pull public-domain domestic-league data — never synthesise rows.

Bonus: the data includes the 2026 World Cup (423 rows in 2026), so the demo reads as current
rather than a museum piece.

---

# Addendum 3 — build protocol (2026-08-22)

## A7. One spec, one run, handoffs when context fills

**Author's flow, fixed:** a single spec covering the whole feature, executed in one `/implement`
run rather than split into tickets. When context is over-consumed the session is cut with
`/handoff` and a fresh agent resumes. TDD applies inside the run.

`/handoff` deliberately writes a *thin* document — it refuses to duplicate anything already
captured in specs, ADRs, or commits, and it saves outside the repo. It therefore cannot carry
project state. Two consequences, both requirements:

1. **The spec carries a progress ledger.** A checkable task list the implementing agent ticks off
   and commits as it goes. A fresh agent must be able to answer "where are we?" from the spec +
   `git log` + a passing test suite alone, with no access to the originating conversation.
2. **Commit per completed chunk, not per milestone.** `/implement` commits to the current branch;
   frequent commits are what make an unplanned handoff cheap. A handoff landing mid-chunk should
   leave at most one incomplete unit of work.

Durable artifacts, in precedence order: `DECISIONS.md` (architecture) → `docs/adr/*` (individual
decisions, and the guard against a future agent "fixing" a deliberate choice) → `CONTEXT.md`
(vocabulary) → the spec (what to build + progress) → commits. Handoff documents are transient and
authoritative for nothing.

## A8. Test seams — exactly two

Recorded as ADR-0011. Restated here because `/implement` requires pre-agreed seams and will not
write tests at an unconfirmed one.

| Seam | What it is | Where it runs | Covers |
|---|---|---|---|
| **`DataEngine`** | Pure module: parse, infer types, build RowIndex, aggregate | Node, fast | Type inference incl. the `NA` rule and boolean detection; aggregation with nulls; time bucketing; top-N folding; sort/filter |
| **`Workspace`** | The facade the UI calls: `loadDataset`, `ask`, `selectCard` | jsdom, scripted fake generator | Structural + semantic validation, the single repair retry, cancellation, staleness, card revisions |

Not seams, but required checks: one worker-transport integration test in `vitest --browser`
(correlation ids, cancel mid-job, out-of-order replies — Node has no real `Worker`), and two
Playwright flows (ask → chart; cancel mid-stream → resubmit succeeds).

Charts are tested through their **accessible data table**, never through SVG path geometry —
geometry assertions are implementation-coupled and break on refactors while the chart still works.
The accessibility feature is the chart test harness.

Expected values in engine tests must come from an independent source — a hand-worked example or a
naive reference implementation — never recomputed the way the code computes them.

## A9. Deliberate complexity — the simplification guard

The Ponytail plugin (code-minimisation, `full` mode) is installed and will run during
implementation. It is welcome: finding *accidental* complexity is genuinely useful here.

But its ladder starts at "does this need to exist?", and it **prevents** more than it deletes — a
choice it talks the agent out of leaves no diff to review and no record that an alternative existed.
So the answer is documentation, not machinery. **This paragraph goes verbatim into the spec:**

> The following are deliberate, spec-mandated choices, not oversights, and must not be simplified
> away: the hand-rolled worker RPC (not Comlink), d3 submodules with hand-rendered axes (not a
> charting library), the worker-resident ColumnStore (not array-of-objects), and the absence of
> TanStack Query. Each exists to make a specific engineering competency visible. See ADR-0013 and
> the individual ADRs for the reasoning. Accidental complexity elsewhere remains fair game.

Then run `/ponytail-audit` after implementation as a separate critique pass. The distinction —
complexity chosen versus complexity removed — is itself worth writing up.

---

# Addendum 4 — domain model (2026-08-22)

`CONTEXT.md` is now the project's vocabulary and is authoritative over the wording used anywhere
else, including this document. 37 terms. A terminology audit of this file found three genuine
collisions worth naming here, because each was a latent source of confusion rather than mere
inconsistency:

- **`turns[]` and `turn.gen` were the same word for opposite lifetimes** — a persisted list of
  results versus ephemeral in-flight state. Now **Analysis** (persisted, holds Revisions) and
  **Request** (one in-flight submission). "Turn" is banned outright: it imports the chat framing
  ADR-0001 exists to reject. "Card" survives only as a component name.
- **"store" meant two unrelated things** — the worker's row storage and the UI state container. Now
  **ColumnStore** and `useWorkspaceStore`; bare "store" is banned.
- **`window` was a triple collision** — the row-range request, SQL window functions (explicitly out
  of scope), and the browser global. Now **RowSlice**.

Also: `SpecResponse` was actively wrong (two of its three variants contain no spec) → **ModelReply**.
`SpecGenerator` → **Translator**. The `Visualization.series` field held a *column name*, not a
series → **`seriesBy`**, parallel to `groupBy`.

## A10. Four modeling decisions the design had not made

**1. `clarification` and `unsupported` replies are transient notices, never Analyses.** They have no
spec and no result, so modelling them as zero-Revision Analyses would force every consumer — the
revision stepper, undo, hash state, the accessible table — to special-case an Analysis with nothing
in it. Three unanswerable questions in a row must not leave three permanent dead ends in the rail;
the rail lists things you can return to, and a refusal is not one. The PM panel's "all three are
card variants" was a remark about card-shaped chrome, not a claim about state.

*Subtlety worth keeping:* the notice must **not** live inside the Request object. If it did, a
staleness-guard early-return would blank the user's explanation mid-read. It lives in a single
`pendingNotice` slot, cleared on next submit or explicit dismiss. Clarification options and
unsupported suggestions are chips that start a *new* Request — so a refusal is a fork in the flow,
not a node in the history.

**2. `intent` is dispatch metadata and is discarded, not persisted on the Revision.** It is fully
derivable — Revision index 0 came from `new`, any later index from `refine`. Worse, a persisted copy
can disagree with reality, because the dispatcher overrides the model: `refine` with no Analysis
selected must become `new`. The model *proposes*; the dispatcher *decides*. Recording the model's
claim alongside the dispatcher's action creates a field that later gets read as authoritative and
isn't.

**3. The `requestId` counter is app-global, and switching Analyses cancels nothing.** There is one
composer, so submits are global; per-Analysis counters would permit two concurrent in-flight
Requests, reintroducing exactly the interleaving ADR-0006 eliminates. Browsing while a slow Request
completes is normal, and discarding work the user asked for to service a navigation is hostile.

*Consequence, and the real bug this prevents:* a Revision can land on an Analysis the user is not
looking at. So the staleness guard must capture **both** `requestId` and `targetAnalysisId` at
dispatch and write to the captured target — never to "the active Analysis" read at resolve time.
Reading active-at-resolve is the defect this decision exists to rule out. The rail needs a quiet
"updated" marker on that row, or the result is silently invisible. `Workspace` seam test: submit
against A, switch to B, assert the Revision lands on A, B is untouched, A shows the marker.

**4. ChartSummary is one computation with two formatters, not one string used twice.** The facts are
identical; the framing must differ. A sighted reader under a visible bar chart does not need "Bar
chart, 6 categories" — that restates what they can see. A screen-reader user needs exactly that
orientation. Byte-identical text forces one audience to read text written for the other; two
independent computations drift until caption and label disagree.

So `DataEngine` returns a structured summary — metric, aggregation, dimension, groupCount,
foldedCount, extreme, nullExcludedCount — and the chart layer owns both formatters. The cardinality
fold and null-exclusion counts ("showing top 15 of 2,092 cities") belong in the structured value, so
both formatters are testable at the `DataEngine` seam with no DOM, which keeps them clear of the
SVG-geometry trap ADR-0011 rules out.
