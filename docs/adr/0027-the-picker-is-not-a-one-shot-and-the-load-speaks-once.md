# The picker is not a one-shot screen, and the load's news has one convention

Two gaps found by walking the built interface rather than by reading it, recorded in
`docs/design/gaps.md` and decided together because they change the same region of the shell.

## 1. The Dataset chip is the control that switches the Dataset

`App.tsx` rendered the picker on `!hasDataset`, and nothing anywhere cleared `datasetHandle`.
The app's root screen was therefore reachable exactly once per tab: a second Dataset meant a
reload, and the worker-crash message that says *"re-select the Dataset to carry on"* pointed at
a screen no visitor could get to. `workspace.loadDataset` — the switch path that abandons the
in-flight Request and clears the exchanges — had been written for this and had no callers.

The entry point is the chip that names the Dataset. Three candidates were drawn
(`docs/design/gaps/`):

- **The chip is a switcher.** Chosen. The thing that names the Dataset is the thing that changes
  it; one click, no screen change, the current Dataset ticked. Its cost is real and paid: the
  chip used to navigate to `#/data`, and that job now belongs to the Data button alone.
- **The picker as a route you return to.** Rejected: a whole screen for what is usually one
  click, and it keeps the descriptions of four samples that a returning visitor has already read.
- **The rail owns the Dataset.** Rejected: the rail is for Analyses (ADR-0014) and starts shut,
  so the way out of a wrong Dataset would sit behind a toggle. Widening what the rail means was
  the actual proposal, and it was not worth it for this.

**Radix's Dropdown Menu, and this is where Radix enters the codebase.** `docs/ui-primitives.md`
§5.1 makes it the default for any new menu surface, to be installed on first use; this is that
use, and `@radix-ui/react-dropdown-menu` is now a dependency.

The first draft was not. It was a `<details name>` disclosure copying the column type chips, on a
misreading of §5.1's standing exception — which names `<dialog>`, `<details>` and `<select>` as
cases where the platform is equal or better. Those are rows 7–9 of that document's table, all
recorded with *gap: none*: a modal, three plain disclosures, a select. A `<details>` doing the
work of a dropdown is row **6**, recorded with a gap — "no arrow keys, no typeahead, no
`role="menu"`, no `aria-haspopup`". The exception is a list of surfaces, not a list of elements,
and a new dropdown is the case the decision was written for. §5.1 has been reworded so the next
reader cannot make the same mistake.

What the swap actually buys, verified in the browser: `aria-haspopup="menu"` and a real
`role="menu"` where a `<summary>` announced a disclosure; arrow keys and typeahead over the items
(`d` jumps to *Deliberately messy export*); focus returned to the trigger on every close path;
and a portal, which deletes the `:has()` rule the first draft needed to escape the card the
inference gate draws.

The column type chips are **not** retrofitted — existing code stays, per the same decision — so
`useLightDismiss` remains for them. It is mounted once in `App` and now covers only that one
surface.

## 2. The inference gate opens only when it has a question

The gate opened for every Dataset. With every column typed confidently it was a one-line census
and a Continue button on an otherwise empty stage — a screen asking permission to do what had
just been asked for, which is the argument `loader.ts` already makes against interstitials for
the 20 MB warning. It also rendered two live-looking controls that did nothing: the Data button,
which had nowhere to go, and the chip, which did not work yet.

`store.setDataset` now opens the gate only when `handle.schema.columns.some(isUncertain)`. The
loud branch is untouched: it has a decision in it, so it earns the screen. The Data button is not
rendered while the gate is up — the gate *is* the data surface at that moment — and the chip is
live, because the cheapest moment to leave a Dataset picked by mistake is before anything has
been asked of it. A second way out sits in the gate's own footer for anyone reading the card
rather than the header.

`CONFIDENT` and `isUncertain` moved to `engine/types.ts`: which columns are in doubt is now a
property of the schema that the store reads, not a threshold private to one component.

## 3. The load says everything it has to say in one strip

Three pieces of news arrive at the same moment — the types were all confident, some rows were
malformed, the file hit the row cap — and they had two conventions between them: a full screen
for the first, a dismissible notice for the other two. `LoadNews` is one strip at the top of the
workspace carrying all three, and the only thing that varies is the left stripe and the words.

The cap outranks the skipped rows, which outrank the census: a capped file is the one piece of
news here that changes what an answer *means*, because an average over the first 500,000 rows is
not an average over the file. The strip says nothing about types when the gate has just been
through them — the gate is the loud telling of that same news, and telling it twice is noise.

Its dismissal belongs to the Dataset it is about, which is why `App` keys it on the Dataset's
label: a switch brings back a strip the last one's × had closed.

## 4. A load in progress owns the surface

Found by walking the switch rather than by reading it. Between picking a new Dataset and its rows
landing, the workspace kept rendering the outgoing one — its analyses, its chart, its row count —
and then blanked them when the new Dataset landed. The progress card that answers this had been
drawn for first run and lived inside `DatasetPicker`, reachable only when there was no Dataset.

`LoadStage` holds it now, and `App` renders it before every other branch: while `load.status` is
`loading` there is no surface behind it to be wrong. Three things fell out of making that true.

- **A switch is not a view change.** It left the route on `#/data`, so the arrival landed on a
  table of the new Dataset's columns rather than on home, where the gate stands and the strip
  speaks. `workspace.loadDataset` navigates home — the one seam every switch goes through.
- **A refused file is not a failed state.** `failLoad` set `status: 'failed'` unconditionally,
  which was harmless when the only way to fail was on first run. Reached through the switcher it
  meant a file the loader rejected at the door — not a CSV, over the cap — rendered nowhere and
  disabled the composer, over a file that never touched anything. It now leaves the Dataset
  exactly as it was and rides `LoadNews` as the strip's most serious flavour. Only a worker
  crash is `fatal`, because that one really does take the rows with it.
- **Cancel had no way back.** `loader.cancel` stopped the job and nothing put the status back —
  `run` returns early on a job it no longer owns — so the interface stayed on a load that had
  stopped. That was invisible while the progress card lived on a screen you could only reach with
  no Dataset loaded; on a full surface it is a dead end.

The strip's dismissal is of a *message* rather than of the strip, for the same reason: a file
refused after the census had been dismissed is different news, and swallowing it because the
strip was closed once is how an error goes unread.

## What was left alone

`DatasetPicker` still calls the loader directly rather than the Workspace. It runs only when
there is no Dataset, so there is nothing to abandon or clear, and it passes a note the Workspace
seam does not carry — that the file just picked is not the one a shared link named.
