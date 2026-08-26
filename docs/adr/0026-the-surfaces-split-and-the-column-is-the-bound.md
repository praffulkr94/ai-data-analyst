# The surfaces split, and the bounded column is what makes it a tool

Nine milestones, each phrased in `DECISIONS.md` §16 as *"Done: &lt;proof&gt;"*, and no section
anywhere saying what the first screen contains. Each milestone's proof was therefore built as a
visible panel in the one place that existed, and none was ever taken down. By M9 `App.tsx`
rendered six sections into one scrolling column with no hierarchy between them, roughly 60% of it
scaffolding: a JSON textarea from M3, three preset buttons, twelve buttons that duplicate
`failures.test.ts` by name, and an unplanned performance readout.

There was also nowhere else to put anything. `main.tsx` was a single
`if (location.hash === '#bench')` read once at module load, and the hash was already occupied —
`session.ts` writes a base64url blob of the session into it continuously (ADR-0022), so `#bench`
was reachable only from a clean URL and no second route could be added at all.

`docs/ux-restructure.md` is the audit; this records the three decisions it produced.

## 1. The hash carries a route and a payload, and they are different things

`#/<route>?s=<payload>`. The route is an address; the payload is state. A hash with no leading
`/` is a link written before this change and still decodes — its whole body is the payload and
the route is home.

Navigation between routes is `pushState`, so Back leaves a route the way it arrived. The payload
stays on `replaceState`, precisely because it is *not* navigation: a Revision is undone with
Cmd+Z, and hijacking the Back button for it was rejected in ADR-0022 and stays rejected.

`main.tsx` now constructs the worker, the loader, the cache and the Workspace at module scope,
above a `<Root/>` that holds the route. Everything the route could throw away is built once, so
leaving for `#/bench` and coming back does not re-parse the Dataset.

## 2. Non-analysis material gets its own route, and the rest is deleted

Two surfaces, and there is no third:

- `#/` — the analysis. A notice, the Request in flight, the analysis card, the composer.
- `#/data` — the rows, with each column's type set in its own header.

Everything else went. **"Move it to `#/dev`" was rejected**: relocating the junk drawer is not
emptying it. The rules that decide what survives are the audit's:

1. A state appears in the product only if a person can arrive at it by doing something. A 529
   from Anthropic is not something a person does; it is handled, and `failures.test.ts` is where
   that is proven.
2. Evidence for a reviewer is not a product surface. It goes in tests, `#/bench`, the README, or
   an ADR.
3. Milestone scaffolding is removed when the milestone's real surface arrives.

Three states were reachable *only* through the preset buttons — an empty result, the cardinality
guard, and the 98,899-point scatter. Deleting the buttons without replacing them would have made
the keyless demo narrower, so the three are now ordinary Questions in the demo repertoire whose
*execution* is degenerate. They landed before the buttons came down.

Schema editing follows the same rule. It is not a settings screen and not a header-chip popover:
it lives on `#/data`, next to the rows that let you see the problem, and `SchemaPanel` dissolved
into it. A new load-time inference **gate** — `LoadState`'s `inferring` — puts the uncertain
columns in front of a person once, because inference is where a live demo breaks. A retype does
not re-open it and neither does a shared link, whose visitor came for a chart.

## 3. The bounded column is what separates this from a chat shell

A composer docked to the bottom is the shape the brief warns about, and the shell keeps it
anyway. What makes it read as a tool rather than a chat window is a single constraint: the
composer is `position: sticky; bottom: 0; margin-top: auto` **inside a 1040px content column**,
not across the viewport, and it is a fixed height.

That bound is load-bearing rather than taste, so two things follow from it. The column width
stays. And the readout that used to expand in place inside the composer — a `<details>` token
table and a JSON request inspector that together inflated the bar to 45vh — is now one 11px line.

The fourth failure the brief named, horizontal scroll, has one cause and one fix. A flex or grid
track's automatic minimum is its content, so any wide `white-space: nowrap` descendant drags the
whole shell past the viewport. The content pane is `flex: 1; min-width: 0`, and wide content
scrolls inside its own box. Measured at 1280, 1024, 900 and 760: the shell's scroll width equals
its client width at every one.

## What this costs

The interface no longer demonstrates itself. A reviewer who wants to see a rate-limit countdown,
a malformed reply repaired, or a raced Request cannot click a button for it; they read
`tests/workspace/failures.test.ts`, which is where those were always actually proven. That is the
trade the first rule names, taken deliberately.

The hand-typed spec is gone with the textarea, and its argument — that the specification is an
object the application owns rather than model output rendered blind — is carried by the card's
own controls, which write the same Revision. What the model wrote is now readable as a compact
aligned DSL (`spec/format.ts`) rather than as JSON, under *"view the query the model wrote"*, and
it is read-only: a specification is edited through the controls, never as text.
