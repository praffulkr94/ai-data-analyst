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
