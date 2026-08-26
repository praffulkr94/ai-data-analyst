# The canvas is a junk drawer — findings, and the structure that replaces it

Status: agreed in discussion, 2026-08-26. Becomes ADR-0026 once the open questions below are
settled. Nothing in this document has been implemented.

## The root cause

Two things are true, and together they produced the current home page.

**The plan never specified a home screen.** `DECISIONS.md` §16 lists nine milestones, each
phrased as *"Done: <proof>"*. There is no section — in 851 lines of DECISIONS, 200 of CONTEXT,
or 25 ADRs — that says what the first screen contains. §A2's Linear reference (line 507) covers
type, density and colour, and was never applied to information architecture.

**There was nowhere else to put anything.** `main.tsx:21` is a single
`if (location.hash === '#bench')`, read once at module load, before React exists. There is no
router, no route table, no notion of a current screen. And the hash is already occupied:
`session.ts:30` writes a base64url blob of the whole session into it continuously via
`replaceState` (ADR-0022), so `#bench` is only reachable from a clean URL and no second route
can be added without changing the format.

So each milestone's proof was built as a visible panel in the one place that existed, and none
was ever taken down. The canvas is nine milestones of accumulated evidence, stacked. `App.tsx:65`
renders six sections into one scrolling column with no hierarchy between them.

## Findings

### F1 — The hand-typed spec textarea is scaffolding that outlived its milestone

`DevPanel.tsx:43`, JSON at `:19`, hardcoded `<details open>` at `:135`.

Planned: `DECISIONS.md:361`, milestone 3 — *"a hand-typed spec in a dev panel renders a correct
bar chart. This milestone proves the pipeline is app-owned."*

At M3 there was no AI (M5), no analysis cards (M6), no demo mode (M7). The textarea was the only
way to make a chart exist. It was scaffolding to build the chart layer against, and the plan
never said it survives to M9.

Its argument — *the spec is an object the app owns, not model output rendered blind* — is
**already delivered as a product feature**. `DECISIONS.md:275`, §11: the chart-type toggle and
aggregation dropdown make natural language *"one of two editors over the same app-owned spec"*.
Flipping bar→line on the card is the same proof, shaped like a product.

Also: the box is frozen at "Matches by city" and has no connection to the session. It does not
show the spec for the question you asked. That feature does not exist anywhere in the app (F9).

**Verdict: delete.**

### F2 — The three preset buttons reach real states by the wrong route

`DevPanel.tsx:297` — Empty result, Too many marks, 98,899-point scatter.

The states are planned and correct. `DECISIONS.md:405` specifies the empty result as
*"★ Empty state showing applied filters + 'remove filter', not a blank SVG"* — an inline state
on the card. It says nothing about a button.

Root cause: demo mode answers only a fixed recorded repertoire (`CONTEXT.md:181`), so states
needing a specific question became unreachable without a key. Instead of adding those questions
to the repertoire, I added buttons that fake the trigger. That made the demo shallower *and* put
debug furniture in the canvas.

**Verdict: delete the buttons. Add the questions to the demo repertoire so the states arise
inline.** The states themselves stay.

### F3 — The twelve failure buttons are the test suite, shipped as UI

`DevPanel.tsx:224`. Planned: `DECISIONS.md:369`, milestone 7 — *"every error state reachable
from a dev panel"*, and §18's 12-row taxonomy table rendered as 12 buttons.

Every one is already a test, by name:

| Button | Test |
|---|---|
| Malformed reply, repaired | `workspace.test.ts:142` |
| Malformed twice | `workspace.test.ts:166` |
| Reply out of room | `workspace.test.ts:181` |
| Prose, no tool call | `workspace.test.ts:202` |
| Rate limited | `failures.test.ts:42`, `:51` |
| Overloaded | `failures.test.ts:69` |
| User cancel | `workspace.test.ts:265` |
| Raced response | `workspace.test.ts:32` |
| Clarification | `workspace.test.ts:103` |
| Unsupported | `workspace.test.ts:121` |

The strip is a second, hand-driven implementation of assertions that already run in CI. It
proves nothing not already proven, to an audience that did not ask.

Three of the twelve are macros for actions the UI already exposes in one click (Invalid key → the
header's key dialog; User cancel → Stop; Raced response → press Enter twice). Two are not
failures at all — Clarification and Unsupported call `workspace.ask()` with an ordinary recorded
question and inject no fault.

I mirrored the *document* structure instead of the user's world: §18 is a table of twelve rows
because that is how an exhaustive taxonomy is written, not a claim that twelve things belong in
one row of buttons.

**Verdict: delete all twelve.** Clarification and Unsupported become suggested questions in the
composer's empty state (F7). The rest are covered by tests.

### F4 — The Instrumentation readout was never planned

`DevPanel.tsx:200`, added in M9 (`618340e`).

`DECISIONS.md:305` planned exactly one thing: *"a dev-only, code-split `/bench` route"*. That
exists, works, and commits raw JSON to `docs/bench/`. This panel is not that.

The one real gap it addressed: `PerformanceObserver('event')` will not time synthetic clicks, so
`#bench` structurally cannot produce an INP figure (`ADR-0024:58`). That justifies reading the
number from a real session. It does not justify a permanent readout in the product — the two
observers are installed in `main.tsx:32` and collect regardless; the panel only *displays*. The
Playwright suite already captures interaction numbers via CDP.

**Verdict: delete the panel, keep the observers.** `perfReadings()` in the DevTools console when
a reading is needed.

### F5 — The schema panel is a real feature shown at constant volume

`SchemaPanel.tsx:12`. Planned, and for a good reason — `DECISIONS.md` §21.1: *"Schema inference
is the demo-killer, not a component… visible and correctable rather than hidden."*

The type override is genuinely load-bearing, in BYOK mode as much as demo:

1. `prompt.ts:88` sends one line per column into the system prompt. That is the model's entire
   knowledge of the data — it never sees a row. A wrong type means the model plans against a
   wrong picture.
2. `validate.ts` enforces it: `sum` on a categorical is refused (`:153`), `timeBucket` on a
   non-date is refused (`:108`), a line chart on a categorical x is refused (`:284`).
3. `kernel.ts:222` re-encodes the column and rebuilds the sort index.

What is wrong is not the feature. It is that it renders identically whether or not there is
anything to act on. On the hero dataset it is nine rows of `100%` confidence and `0` nulls —
nothing to decide. It earns its space on `messy.csv` and on uploads, where confidence drops.
Shown loud always, it trains the visitor to ignore it, which defeats its purpose.

**Verdict: not a permanent panel on home.** Quiet at load when inference is confident; loud when
it is not. Editable afterwards from the data surface.

### F6 — The data grid is a real feature doing two jobs, one of which does not belong on home

`DataTable.tsx:19`. Planned: `DECISIONS.md` §6 / milestone 2 — *"riskiest part of the project and
therefore the best interview story"*, and headline number 2 (`:192`): unvirtualised 150k rows
hangs the tab 20s+ vs ~30 rendered rows, first paint under 100ms.

It has one genuine product job, `DECISIONS.md:275` §11: the active analysis filters the grid,
shown as a removable chip; table sort/filter never drives the chart. That is drill-down — *show
me the rows behind this number* — and it is the product, not a demo.

The second job is being a CSV viewer: 49,520 unfiltered rows, permanently, before any question
has been asked. Nobody came here to read a CSV.

**Verdict: split by job.** The filtered drill-down stays on home, collapsed. The unfiltered grid
moves to the data surface.

### F7 — There is no empty state

Before a question is asked, `Notice` and `AnalysisCard` do not mount. The first screen is schema
table → JSON textarea → 12 buttons → perf readout → CSV grid. The one thing a visitor needs —
*ask a question, here are some that work* — appears nowhere. The demo repertoire is a fixed,
known set (`CONTEXT.md:181`) and is never surfaced.

### F8 — Home can show three different tables with no distinction between them

The schema table (`SchemaPanel.tsx`), the raw grid (`DataTable.tsx`), and the chart's aggregated
result behind "View as table" (`AnalysisChart.tsx:296`). Three meanings, one visual treatment.

### F9 — The spec for the current analysis is never shown

**This is the replacement for F1's textarea, not an addition to it** — the collapsed developer
view agreed in discussion: show the query the model wrote *for the question that was asked*.

The textarea shows a frozen unrelated example. The composer's inspector
(`UsageReadout.tsx`) shows the *request* sent to the model, not the *spec* it returned. So the
one piece of genuine transparency — *here is what the model made of your sentence* — is missing,
while a debugger that shows an unrelated sample occupies the canvas.

## The proposed structure

### Two surfaces, split by what they are about

| Surface | About | Route |
|---|---|---|
| **Home** | The analysis: the question, the chart, the rows behind it | `#/` |
| **Data** | The dataset: its columns, their types, its raw rows | `#/data` |
| **Bench** | The performance evidence, reproducible by a stranger | `#/bench` |

The test for which surface something belongs to: **is it a place you go, or a thing you do to
what is on screen?** Bench and Data are places. Correcting a column type mid-analysis is a thing
you do — which is why the *detected* case is fixed in place (below) even though the surface is
a route.

### Home

- Rail — analyses (unchanged in substance)
- Empty state — ask a question, with the demo repertoire's questions offered (F7). Includes the
  questions that produce clarification, unsupported and empty-result states, so those arise
  naturally (F2, F3)
- The active analysis — title, revision stepper, narration, chart, the two manual controls
- Notices — clarification / unsupported / failure, inline, with the fix attached where the app
  knows it (below)
- Drill-down — the rows behind the current chart, filtered, collapsed until asked for (F6)
- The spec for this analysis — collapsed, on the card (F9). Replaces F1's textarea. The only
  item in this document that is written rather than deleted or moved, so it sequences after the
  deletions
- A load-time inference step — quiet when confident, loud when not (F5)

Nothing else. No schema table, no textarea, no failure strip, no perf readout, no unfiltered CSV.

### `#/data`

The dataset as one surface: the raw grid, and the column metadata and type control together —
they are the same object viewed two ways (F5, F6, F8). This is the "settings for the data"
surface. Reached deliberately; nothing needed mid-analysis lives here.

### Changing a column type — three moments, one of them on home

| When | Where |
|---|---|
| At load | The inference step. Silent when every column is confident |
| The app detects it | The validator's own message carries the fix. `validate.ts:112` already produces *"Column `month` is categorical, so it cannot be bucketed by time. Date columns: `date`"* — dead text today. It gains a button: **treat `month` as a date and retry** |
| You notice it yourself | `#/data` |

The second is the highest-value and cheapest: the case where a wrong type *matters* is largely
the case where the validator refuses the question, so the app detects it before the visitor does.

### Routing

Three routes, no dependency — react-router for three static routes would be F1 again.

```
#/                 home
#/data             the dataset
#/bench            the evidence
#/?s=<base64url>   session rides as a query inside the hash
```

`main.tsx` switches on the route and listens to `hashchange` instead of reading once at boot,
which also makes `#bench` reachable from inside the app. Session encoding moves from *the hash*
to *the `s` param of the hash* — a contained edit to `session.ts`.

### What dies

`DevPanel.tsx` entirely — textarea, presets, 12 failure buttons, instrumentation readout. The
observers in `main.tsx` stay. `#bench`, `scripts/bench-run.mjs` and `docs/bench/` stay untouched:
the evidence stays reproducible by a stranger, which is what ADR-0024 required.

## Rules that fall out of this

1. **A state appears in the product only if a person can arrive at it by doing something.** Ask
   an ambiguous question → clarification. Hit Stop → cancel. A 529 from Anthropic is not
   something a person does; it is handled, and `failures.test.ts` is where that is proven.
2. **Evidence for a reviewer is not a product surface.** It goes in tests, `#/bench`, the README,
   or an ADR.
3. **A panel that renders identically whether or not it has anything to say has nothing to say.**
4. **Milestone scaffolding is removed when the milestone's real surface arrives**, not left
   standing with a justification written for it.
5. **Mirror the user's world, not the document's structure.** A 12-row table in DECISIONS is not
   a 12-button strip in the UI.

## Open questions, and what shipped

All four are answered by M10. Kept as questions with their answers rather than deleted, because
the answer is only legible next to the thing that was open.

- **Does the drill-down grid on home reuse `DataTable` or need a distinct, smaller component?**
  Neither — one shared `Grid`, two exported wrappers. `DataSurface` is the `#/data` route and
  `DrillDown` is the collapsed grid inside the analysis card; the virtualisation, the slice cache
  and the type menu are written once. A distinct component would have been a second place for the
  windowing arithmetic to be wrong.

- **Where does the load-time inference step live — inside the picker flow, or as a first-run state
  on home?** A first-run state on home: `InferenceGate`, gated on `load.status === 'inferring'`,
  which the store opens only for a Dataset that was not already loaded. Not the picker, because
  the same gate has to stand in front of a dropped file, and not a modal, because the visitor is
  reading a table of columns and needs the width. ADR-0026, `gate.test.ts`.

  M10 shipped it with two volumes — loud when some column was in doubt, quiet when none was — and
  the quiet one was wrong. A one-line census and a Continue button on an empty stage is a screen
  asking permission to do what has just been asked for. It does not open at all now: the census
  is news, and news goes to the workspace as `LoadNews`. ADR-0027.

- **Does `#/data` need the full schema statistics (confidence, nulls, distributions), or only the
  type control plus the grid?** The type control plus the grid, plus the parse report. Confidence
  is spent at the gate — it decides which columns are put in front of the visitor and is shown
  there — and is not carried forward onto a surface where nobody would act on it. Distributions
  went to the model in the prompt, not to the screen. What survives on `#/data` is what a visitor
  can *change*: the type chip in every header, and the malformed rows they might want to go and
  fix in the file.

- **Blocking F2/F3's deletion.** Done, and in the required order. The three degenerate fixtures
  landed first — *"How many matches has Atlantis hosted?"* (empty result), *"How many matches were
  played each day?"* (the cardinality guard), and *"How do goals scored compare with goals
  conceded?"* against `team_matches` (98,899 points) — and the empty state now surfaces the
  clarification and unsupported questions that already existed. Only then did the preset strip go.
  `fixtures.test.ts` validates every fixture against the schema its `dataset` names, so the
  degenerate three cannot rot into specs the Dataset no longer answers.
