# The primitives assessment — what was hand-rolled, and what it cost

**First draft, 2026-08-26.** §1–4 are an assessment; §5 carries the decisions taken on it. This
exists because a UI-library choice was discussed early, never recorded, and then made ten times
over by accumulation — every component evaluated on its own, each one individually too small to
justify a dependency.

That is the bias this document is written to correct. Evaluating a platform one component at a
time is structurally biased against ever adopting one, and the M10 review made exactly that
error: it counted the 26 lines of overlay behaviour that survived and did not count the design
that was shaped around what `<details>` and `<dialog>` can do.

## 0 · The evidence that it was never a decision

```
Radix in DECISIONS.md     : 0
Radix in any ADR          : 0
Radix in any commit < M10 : 0
```

Every mention in the repository today was written during M10. DECISIONS §12 sets the convention
for this exact situation — *"the reasoned rejection is worth more than the dependency — write the
ADR"* — and TanStack Query got that treatment. The UI primitives never did.

## 1 · What the design draws, and what was built

The design canvas (`docs/design/analyst-shell.dc.html`) draws a component vocabulary: menus,
toggles and switches, tabs, a select. Each was implemented separately against a native element.

| # | Surface | Drawn as | Built as | Gap |
|---|---|---|---|---|
| 1 | `AnalysisCard` — chart type | segmented toggle | `role="group"` + `aria-pressed` buttons | no roving focus |
| 2 | `Header` — Demo/BYOK mode | segmented toggle | same | no roving focus; mutually exclusive, so `radiogroup` is the truer role |
| 3 | `Composer` — model | segmented toggle | same | same |
| 4 | `InferenceGate` — type per column | segmented toggle | same | same, multiplied by the column count |
| 5 | `AnalysisCard` — revision stepper | prev/next pair | `role="group"` | none — not a library widget |
| 6 | `DataTable` — column type | **dropdown** | `<details name>` disclosure | no arrow keys, no typeahead, no `role="menu"`, no `aria-haspopup` |
| 7 | `KeyDialog` | modal | native `<dialog>` | **none** |
| 8 | 3× disclosures | disclosure | native `<details>` | **none** |
| 9 | `Controls` — aggregation | select | native `<select>` | **none** |

Rows 1–4 are the same widget built four times. Row 6 is drawn as one thing and built as another.
Rows 7–9 are cases where the platform is genuinely equal or better.

## 2 · What it costs, measured

Tab stops, Chrome, the loud inference gate on `messy` (10 columns, 2 uncertain):

```
inference gate : 18 tab stops · 3 segmented groups holding 10 of them
with roving focus: 11          (the 10 collapse to 3)
#/data         : 80 tab stops
```

A keyboard user tabs through every option of every segmented control rather than arrowing within
it. That is the concrete cost of row 1–4, and it scales with the column count.

Row 6's cost was partly paid in M10: light-dismiss (Escape, click-away) is now 17 lines in
`Grid`. What is still missing is arrow-key navigation, typeahead, and menu semantics.

## 3 · What the retrofit would cost

Marginal bundle over an app that already ships React, esbuild-minified and gzipped:

```
@radix-ui/react-toggle-group    8.2 kB   ← rows 1–4
@radix-ui/react-dropdown-menu  30.7 kB   ← row 6
both together                  31.6 kB   (shared internals; the second is nearly free)
@radix-ui/react-dialog         13.3 kB   ← not recommended, see below
```

Against a current bundle of 186 kB gzip.

The `.segmented` CSS is already shared, so rows 1–4 are a markup swap per site rather than a
restyle — with one exception worth knowing before starting: `app.css:427` selects on
`button[aria-pressed='true']`, and Radix `ToggleGroup` marks the active item with
`data-state="on"`. One selector, changed once, covers all four sites.

**`<dialog>` and `<details>` should stay.** The platform caught up after Radix was designed:
`<dialog>` gives focus trap, Escape, backdrop, background inertness and top-layer placement for
six lines, and `<details>` disclosures need no JS at all. Radix equivalents would be a
regression — more bytes for less. This is the part of the original instinct that was right, and
it is worth keeping even if everything else moves.

Native `<select>` (row 9) likewise: Radix Select loses the platform picker on mobile.

## 4 · How the framing changes

Judged per component, 31.6 kB never justifies itself — 8.2 kB is not worth it for one toggle
group, and 30.7 kB is not worth it for one menu.

Judged as a component layer, 31.6 kB buys consistent focus management and keyboard semantics
across five surfaces, and replaces five independent judgement calls about how much accessibility
each control deserves with one. That is a different question with a different answer, and it is
the question that should have been asked at M2.

## 5 · Decisions

### 5.1 · New work reaches for Radix first — **decided**

Radix is the default for any *new* overlay, menu, or toggle surface from here. Existing code is
not retrofitted: the M10 patches deliberately kept the blast radius small, and a working control
is not a reason to open a file.

**Radix is installed.** `@radix-ui/react-dropdown-menu`, added by the dataset switcher
(ADR-0027 §1), which was the first new menu surface after this decision. Before that the decision
was *adopt on first use* and the package was deliberately absent; that is now spent.

`@radix-ui/react-tooltip` followed, on the same rule: the model picker had to explain the model it
picks and why it is inert in Demo mode, which is a new overlay surface and so brings its own
package. `src/ui/Tip.tsx` is the wrapper; the provider is in `App`. What it buys over the `title`
attribute the picker used before: the interface's own styling, opening on keyboard focus,
`aria-describedby`, and a portal out of the composer's stacking context. Note the constraint it
imposes — a natively `disabled` trigger receives no pointer events, so a control whose tooltip
explains its unavailability must use `aria-disabled` and refuse the click itself.

**The exception is a list of surfaces, not a list of elements.** Rows 7–9 stay native: a modal is
`<dialog>`, a plain disclosure is `<details>`, a select is `<select>`. Those three are recorded
above with *gap: none*, and that is the whole basis for the exception — the platform is equal or
better **at those jobs**.

It does not extend to the element wherever else it turns up. A `<details>` doing the work of a
dropdown is row **6**, and row 6 is recorded as a gap, not as an exception: no arrow keys, no
typeahead, no `role="menu"`, no `aria-haspopup`. Reading the exception as "`<details>` is always
fine" is how the dataset switcher was first built as a disclosure and then rebuilt; if you are
reaching for a `<details>` because a *menu* needs to open, you are in row 6 and the answer is
Radix.

So: "Radix first" means *first considered*, and the only surfaces where considering it and
declining is right are the three jobs named above. Everything else new is Radix. Existing code is
not retrofitted, which is why the column type chips are still row 6 and still a disclosure.

The other case where hand-rolling is genuinely hard is a filter combobox — roving focus,
typeahead, and an active-descendant relationship between an input and a listbox.

### 5.2 · The `aria-pressed` toggles stay as they are, for now — **decided**

Rows 1–4 are mutually exclusive selections rendered as `aria-pressed` toggle buttons inside a
labelled `role="group"`. A `radiogroup` with `aria-checked` is the more expressive of the two
patterns: it conveys *one of N* and its position, where the current markup conveys only each
button and whether it is pressed.

Both are valid ARIA, and the present one is not broken — a screen reader announces the group
label, each option, and which is pressed, so the selection is discoverable. It is the less
expressive of two correct options, not a defect.

Leaving it. Fixing the roles by hand now is work the `ToggleGroup type="single"` swap would throw
away, and that swap fixes the roving focus at the same time — the two are the same job. Doing it
by hand first means doing it twice. If the swap never happens, revisit this on its own merits.

### 5.3 · The retrofit, costed in scope — **decided**

Not costed in hours; that is not mine to estimate. In scope:

```
rows 1–4   4 call sites, 4 lines of JSX each, + 1 CSS selector (app.css:427)
row 6      TypeMenu           54 lines  → Radix DropdownMenu
           Grid light-dismiss 33 lines  → deleted
           typeMenu.test.tsx 100 lines  → 3 of 5 cases become Radix's problem;
                                          the pick-still-fires case is worth keeping
```

Rows 1–4 are small and mechanical enough that they are not really a project — four sites and a
selector. Row 6 is the one with a real shape to it, because it is a rewrite rather than a swap
and it deletes tests that currently pass.

That asymmetry is the useful finding: the four toggles could be swapped in an afternoon by
whoever installs Radix first, and the menu is the piece that deserves its own change and its own
review.

### 5.4 · Icons come from lucide-react — **decided**

Every icon in the interface was either a typographic glyph (`&rsaquo;`, `▾`, `&times;`, `✓`,
`&lsaquo;`) or a hand-drawn `<svg>` (the rail toggle, the chart mark, the theme disc). The glyphs
are the problem: they are *text*, so their size, weight, optical centre and vertical alignment are
whatever Inter decided for that codepoint, and none of them agree with each other. That is why the
chevrons read small and sat off-centre — they were never drawn on the same grid as anything
around them.

`lucide-react`, on the same rule as Radix in §5.1: a component vocabulary is a platform decision,
and evaluating an icon set one arrow at a time is how you end up with five arrows that do not
match. It is the React ecosystem's default (the maintained fork of Feather), ISC-licensed, one
tree-shaken ES module per icon, `currentColor` throughout, and drawn on one 24-unit grid — which
is the whole point.

Two consequences worth recording:

- **Size lives in CSS, not at the call site and not in a provider.** One rule, `svg.lucide
  { width: 14px; height: 14px; flex: none }`. lucide ships a `LucideProvider`, and it was
  declined: a menu rendered through a Radix portal and a component rendered in a test both sit
  outside whatever provider `App` mounts, and an icon set whose size depends on where it is
  mounted is the problem this replaced. No wrapper module either — there is nothing to wrap.
- **The status notices gained a mark.** `Notice` and `LoadNews` now carry an icon beside the
  heading, coloured to match the left stripe. It is a *third* redundant signal next to the words
  and the stripe, never a replacement for either: DECISIONS §A5 forbids colour carrying meaning
  alone, and an icon carrying it alone is the same defect.

Not retrofitted anywhere it was not already a glyph: `ChartFrame`'s plot SVG is a drawing, not an
icon, and the composer's blinking `.caret` is a text cursor.
