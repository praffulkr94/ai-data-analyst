# Gaps

Things the built interface gets wrong or does not have, recorded as they are found and *not*
fixed on sight. The list accumulates until there is enough of it to decide on as a set — some
entries are code-only, some need the design canvas (`analyst-shell.dc.html`) redrawn first, and
that split is only visible once several are written down.

Each entry says what is wrong, where the evidence is, and whether the canvas has to change. It
carries no fix — a fix decided in this file is a decision made without the rest of the list.

Status: `open` (recorded, undecided) · `decided` (approach agreed, in the notes) · `done` (built,
entry kept for the trail).

---

## GAP-1 · There is no way back to the dataset picker · `done`

Once a Dataset is loaded the picker is unreachable, so a second Dataset cannot be analysed
without reloading the tab. The picker is the app's root screen and behaves as a one-shot
first-run screen instead.

- `src/App.tsx:63` — the picker renders only on `!hasDataset`, and no action anywhere clears
  `datasetHandle`.
- `src/workspace/workspace.ts:334` — `loadDataset()`, the correct switch path (aborts the
  in-flight Request, clears exchanges, drops the Analyses), has **no callers**. The affordance
  was built and never given a surface.
- `src/data/loader.ts` — a worker crash calls `failLoad("… Re-select the Dataset to carry on.")`,
  but that message renders only inside `DatasetPicker` (`src/ui/DatasetPicker.tsx:92`). With a
  Dataset loaded the instruction is on a screen the visitor cannot reach.

Design impact: **yes** — the canvas has no "change dataset" affordance and no drawn state for the
picker reached with a Dataset already loaded (the samples list would need to say which one is
current). Where the entry point lives — header chip, `#/data` header, or the rail's `+` — is a
canvas decision, not a code one.

**Shipped** as option A of `analyst-gap-directions`: the chip opens a Radix Dropdown Menu
(`src/ui/DatasetMenu.tsx`), every route in goes through `workspace.loadDataset`, and the Data
button is now the only way to `#/data`. ADR-0027 §1.

Verified as *not* a gap while looking: uploading your own CSV is fully built (drop anywhere on
the panel or `Pick a file…`, worker parse, progress, cancel, non-CSV rejected), and the footer's
numbers are all real and read from the constants — 50 MB hard refusal (`loader.ts:67`), 20 MB
warning (`loader.ts:90`), 500,000-row cap (`engine/csv.ts:16`), malformed rows skipped not fatal.

---

## GAP-2 · The inference gate blocks a whole screen to say nothing · `done`

With every column typed confidently the gate is a full-surface interstitial carrying one line of
census text and a single `Continue` — no decision to make, no way back, nothing else on screen.
It reads as a dialog that asks permission to do what was just asked for.

- `src/ui/InferenceGate.tsx:29-44` — the `uncertain.length === 0` branch. One `notice-good` strip
  on an otherwise empty stage.
- `src/App.tsx:65` — `status === 'inferring'` wins over the route, so the gate *is* the surface,
  not an overlay on it.
- `src/store.ts:350` — the gate opens for any Dataset not already loaded, including a sample
  picked from a list of four whose columns the picker just described.

The recorded intent (`docs/ux-restructure.md`, "Open questions") is right and holds for the other
branch: *quiet when every column typed confidently, loud only when some did not*. The gap is that
"quiet" was built as the same blocking surface at lower volume. The loud branch — one row per
doubtful column, a type control, the values that show why — earns the screen. The quiet branch is
a receipt.

The codebase already states the principle it breaks here, in `src/data/loader.ts:12` on the 20 MB
warning: *"an interstitial that asks permission to do what was just asked for is friction, not
care."* That is the same screen, and the same argument against it.

Two more things the branch drags in:

- No way back. The picker is unreachable from the gate for the same reason as GAP-1, and here it
  is worse: nothing has been done yet, so a wrong pick from the sample list is a tab reload.
- The header's `Data` button and the dataset chip both render during the gate and both do
  nothing — `App.tsx:65` swallows the route change. Two live-looking controls, inert.

**Shipped** as option A: the gate opens only when `handle.schema.columns.some(isUncertain)`, the
census and the parse report share one dismissible strip on the workspace (`src/ui/LoadNews.tsx`),
the Data button is not rendered while the gate is up, and the chip beside it is live because it
is now the way out. ADR-0027 §2 and §3.

Design impact: **yes** — this is a "where does this information belong" question, not a code
tweak. If the confident case has no decision in it, land on the workspace and let the census be
something the visitor can *reach* (the chip, `#/data`, a dismissible strip) rather than something
they must acknowledge. The canvas has to say which. Whatever it decides also has to hold for the
failure case the same surface would carry — a parse that skipped rows, a truncation — which today
lands as a dismissible notice on home (`App.tsx:96`), so there would then be two conventions for
one kind of news unless the canvas picks one.

---

## GAP-3 · A switch in progress shows the Dataset it is replacing · `done`

Between picking a new Dataset and its rows landing, the workspace keeps rendering the old one —
its analyses, its repertoire, its row count — with nothing saying a load is running.

- `src/App.tsx:63` — with a Dataset already loaded, `status === 'loading'` matches no branch, so
  the surface for the *previous* Dataset stays on screen.
- `src/ui/DatasetPicker.tsx:28` — the progress card that exists for exactly this (label, row
  count as it parses, a Cancel button, the pacing bar) renders only inside the picker, which is
  only reachable when there is no Dataset. Built, and unreachable from the switch that needs it.

Not visible on a local dev server: a 99,040-row sample switches inside one animation frame. The
interval it leaves open is a large upload or a slow network, where the visitor clicks a name in
the menu and watches the previous Dataset sit there.

**Shipped**: `src/ui/LoadStage.tsx` — the progress card moved out of the picker, and `App`
renders it before every other branch, so a load in progress replaces the surface rather than
sitting behind it. Two things came out with it:

- **The route.** A switch from `#/data` stayed on `#/data`, so the arrival landed on a table
  instead of on home, where the gate and the strip live. `workspace.loadDataset` navigates home
  now — one seam, every caller.
- **A refused file.** `failLoad` set `status: 'failed'` whatever the state, which with a Dataset
  already open rendered nowhere and disabled the composer over a file that never got in. It now
  leaves what was loaded exactly as it was and puts the message on the strip; only a worker
  crash, which takes the ColumnStore with it, is fatal. `Cancel` had the same shape — nothing put
  the status back, so the interface sat on a load that had stopped.

ADR-0027 §4.

---

## GAP-4 · A manual edit acknowledges itself before the chart it changes · `open`

Both manual editors — the aggregation dropdown and the Revision stepper — change their own
control immediately and leave the chart on the previous answer for a few hundred milliseconds,
with nothing on screen saying so. On the 99,040-row scatter the counter reads `2/2` while the
plot is still the first Revision's.

Measured in the **production build** (`npm run build && npm run preview`), one aggregation
change, four functions, medians consistent across runs:

| | |
|---|---|
| the control updates | ~3ms |
| React commits the new chart (caption, axes) | ~277ms |
| `canvas:draw` runs, the points appear | ~305ms |
| longest frame gap (the visible hitch) | 38–49ms |

The work itself is not the problem and there is nothing to optimise. The aggregation already
runs in the worker; `points()` over 98,899 rows is 15ms, the quadtree 20ms, the canvas draw 10ms,
the scales 8ms. What is left is React's render and commit plus the browser's layout and paint,
which are main-thread by nature.

Two findings that a fix has to start from:

- **The points land one paint after everything else.** `<PointsCanvas>` draws inside a
  `useEffect`, and React runs passive effects *after* the browser has painted the commit. So the
  order is always: commit (new caption, new axes) → paint → `canvas:draw` → paint (points). There
  is always at least one painted frame carrying the new axes and the old points. Any progress
  indicator keyed on "the async work finished" therefore ends one paint early, by construction —
  `src/chart/marks.tsx:491`.
- **Almost all of the felt slowness is `vite dev`, not the app.** The same stepper click is
  ~2,100ms in one blocked task on the dev server and ~40ms in the production build. StrictMode
  double-invokes every memo (visible as paired `probe:points`, `probe:quadtree` measures, and six
  `probe:scales` per step) and React's DEV build emits a `performance.measure` per component.
  Anyone diagnosing this must measure a built bundle; a dev-server profile is off by ~50×.

Two attempts that do **not** work, so the next pass does not repeat them:

- A spinner set in the same commit as the store update never reaches the screen. React flushes
  passive effects inside the same task, so the flag is set and cleared without an intervening
  paint. Measured: one 1,115ms task containing both mutations.
- `startTransition` cannot defer a Revision step. The Revision lives in a `useSyncExternalStore`
  store and React is required to apply those synchronously. `useDeferredValue` *does* work — it
  defers a plain value rather than the subscription — but it splits the card's data source in
  two (chart from the deferred Analysis, counter from the live one), which is a standing
  invariant to buy a fix for a problem the production build does not have.

A prototype of the whole thing — deferred Analysis, one spinner in the control bar spanning both
halves of the wait, cleared a frame after the points paint — measured correct
(`spinner ON 2.7ms → chart swaps 286.8ms → points appear 315.5ms → spinner OFF 331.7ms`) and was
**reverted deliberately**: at 300ms with a 40ms hitch it is not yet worth the invariant. It
becomes worth it at the 500,000-row cap, or on a slower machine, and that is the trigger to
revisit.

Design impact: **yes** — where a per-card busy state lives is a canvas question. The card has a
control bar, a title row with the stepper, and no drawn state for "this card is recomputing".
`InFlight` is the Request card and is the wrong size for a 300ms manual edit.

---

## GAP-5 · A mode switch leaves a thread that half of it cannot answer · `done`

Switching Demo ↔ BYOK changed the Translator and nothing else, which DECISIONS §A1 recorded as a
feature. It is not one. A Demo session that inherits a BYOK Analysis can neither explain it — no
card says which mode produced it — nor refine it, because Demo answers only Questions it has a
Fixture for and a refining Question against an arbitrary Analysis is not one of them.

- `src/store.ts` — `setMode: (mode) => set({ mode })`, the whole of it.
- `src/ui/KeyDialog.tsx` — the second caller, so any reset added to one path missed the other.
- `tests/workspace/mode.test.ts` — asserted the survival as a property to protect.

Design impact: **no** — the switch has a drawn control already; what it lands on is the picker,
which is also drawn.

**Shipped.** `workspace.setMode` is the one path, and all it does beyond flipping the flag is
call `workspace.reset` — the same full reset the brand performs (GAP-6). The first attempt kept
the Dataset and navigated to a picker route, which produced the half-state GAP-6 records; a mode
switch and a "start again" are the same gesture and now run the same code. The raw store setter
is unchanged and is what a restored link uses, which is the distinction `App.applyKey` draws.
DECISIONS §A1 amended rather than quietly broken.

---

## GAP-6 · There was no way to start again · `done`

GAP-1 gave the picker a way in — the header chip's menu — and stopped there. A menu is a state,
not a place, and there is no affordance anywhere that reads as *go back to the start*. Clicking
the application's own name did nothing.

- `src/App.tsx` — the picker rendered on `!hasDataset` and on no other condition, and nothing
  anywhere set `datasetHandle` back to `null`.
- `src/ui/Header.tsx` — `<span className="brand">Analyst</span>`, inert.

Design impact: **no** — the picker is drawn, and this is that screen unchanged.

**Shipped**, and the first attempt at it is the interesting part. It was built as a fourth route,
`#/datasets`, rendering the picker *over* a Dataset that stayed loaded — so the screen carried a
*Back to \<label\>* link and marked the current sample `· loaded`. That is a panel you dismiss,
not a home screen, and the address said `#/datasets?s=<the old session>` while claiming to be the
start.

The route is gone. `#/` with nothing loaded **is** the first screen — that is the whole of the
picker's condition — so getting there means dropping the Dataset, not navigating. `workspace.reset`
is the one thing that does it: abandon the in-flight Request, clear the exchanges and the proposed
Questions, `store.reset()`, `navigate('home')`. The brand calls it and so does a mode switch
(GAP-5). Nothing is kept that belongs to the work; the mode, theme, model and session totals are
the visitor's and stay.

One bug fell out of it that was never about the picker: `trackSession` returned early when there
was nothing to carry, so the payload of the Dataset just discarded stayed in the URL. It now
clears it — and still leaves a first-run address bar alone, which is what the early return was
there for.

---

## GAP-7 · The theme toggle read as a flash · `done`

Two independent causes, one symptom.

- No `color-scheme` anywhere in the stylesheet, so the UA kept painting light scrollbars, light
  form controls and a light canvas behind a dark page. That strip down the side of the window is
  the part that actually flashed.
- Every colour in the interface is a token, and the token swap is instantaneous, so the whole
  page inverted inside one frame with nothing carrying the eye across.

Design impact: **no**.

**Shipped.** `color-scheme: light | dark` on the two `:root` blocks in `tokens.css`. And a
transition that exists only during the swap: `App` sets `data-theme-switching` on the root when
the theme actually changes and removes it 200ms later, and one rule in `app.css` hangs a 160ms
`background-color`/`border-color`/`color`/`fill`/`stroke` transition off that attribute. The cost
is paid once per toggle rather than sitting on every element for the life of the page, and under
`prefers-reduced-motion` `--motion` is already 0ms so it is a no-op. The canvas-drawn scatter
cannot join in — it repaints in its own effect — which is the accepted edge of doing this in CSS.

---

## GAP-8 · The icons were typography · `done`

Chevrons read small and sat off-centre because they were not icons: `&rsaquo;`, `&lsaquo;`, `▾`,
`&times;` and `✓` are glyphs, sized and optically centred by Inter rather than by anything in this
design. Three hand-drawn `<svg>`s sat beside them on a fourth and fifth grid.

- `src/ui/DatasetPicker.tsx`, `src/ui/EmptyState.tsx`, `src/ui/AnalysisCard.tsx` — `&rsaquo;`
  and `&lsaquo;` as chevrons.
- `src/ui/Header.tsx`, `src/ui/DataTable.tsx` — `▾` as a menu caret, at `font-size: 9px`.
- Six `&times;` dismiss buttons; two `✓` ticks at two different widths.
- `src/ui/Header.tsx`, `src/ui/Rail.tsx` — three hand-rolled `<svg>` icons.

Design impact: **no** — the canvas draws icons at these positions already.

**Shipped.** `lucide-react`, sized by one CSS rule. `docs/ui-primitives.md` §5.4 records why, and
why the library's own context provider was declined. The status notices gained a severity mark
beside the heading at the same time — a third signal next to the words and the stripe, never
instead of either.

