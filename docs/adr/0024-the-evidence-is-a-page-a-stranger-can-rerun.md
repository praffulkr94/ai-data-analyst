# The evidence is a page a stranger can re-run

> **Amended by ADR-0026 (M10).** The route is `#/bench`; the bare `#bench` of this ADR still
> resolves to it. And the dev panel this ADR names as the source of an INP figure is gone — the
> observers are unchanged and `scripts/e2e-run.mjs` reads them directly off the page, because
> evidence for a reviewer is not a product surface., and it reports the worker losing

M9 had to turn the performance story into numbers. DECISIONS §7 fixes the framing —
*aggregation is the cheapest step and is not the justification for the worker* — and §13 asks
for a `/bench` route over three paths, N≥7, medians with min/max, raw JSON committed, machine
and Chrome named, never a single run. What §13 does not settle is where the instrumentation
lives, who can run it, and what happens when the numbers disagree with the document that asked
for them. All three were decided in this milestone and none is cheap to reverse.

**Decision. The evidence is a route in the shipped bundle, not a test and not a table.**
`#bench` is lazily imported by `main.tsx` and nothing else, so it is a chunk no visitor
downloads — but it is **not** gated to dev builds. A number a stranger cannot reproduce is a
number in a README, and a stranger has the deployed URL, not this repository. `stats.ts` is its
own module with its own tests because every published figure passes through that median.
`scripts/bench-run.mjs` drives the page and writes `docs/bench/`, so the JSON in the repository
is the JSON the page produced, not a transcription.

**The instrumentation is product code on the standard performance timeline.** `src/perf.ts`
holds `timed`, `mark`, a `since` that refuses to measure against a mark that is not there, and
the two observers; it has no DOM, so `worker/kernel.ts` imports it too. A worker has its own
performance timeline, so the phases inside a round trip are measured *there* and posted back as
`Timings` on `parse:done` and `analyze:done` — the main thread can only time the round trip, and
the round trip does not say which of parse, inference, encoding and index building cost what.
Marks and measures rather than two `now()` readings and a `console.log`, so a DevTools trace of
an ordinary session is legible with no bench page in it at all.

**And the numbers were published as they came out.** Two of them contradict the brief:

- On the 98,899-point question the **worker path is 23 ms slower end to end** — 360 ms against
  337 ms — because it pays a structured clone of a result the size of the Dataset. The README
  leads with the column it wins: 0 ms of main-thread blocking against 2,627 ms over nine runs.
- **Columnar aggregation is not a tighter loop.** §7's third headline claimed 3–6× memory
  reduction *plus* a measurably tighter aggregate. The memory claim is unmeasured here (see
  below); the loop claim is measured and false — 122 ms against the object path's 34 ms over
  98,899 groups, and 9.7 against 8.3 on the ordinary question. Dictionary decode and typed-array
  indexing buy memory and ownership, not speed. The README says so in those words.

Publishing a number that undercuts the architecture is the whole point of measuring. A benchmark
that only ever agrees with the design it was written for is a decoration.

**Considered options.** Gating `#bench` to `import.meta.env.DEV` was rejected on the
reproducibility argument above. Hand-copying a summary table into the README and not committing
the raw output was rejected for the same reason — §13 asks for the JSON. Reporting means was
rejected: one GC pause moves a mean by tens of milliseconds and leaves the median where it was,
and the test for that is in `tests/engine/bench.test.ts`. `performance.memory` was tried and
dropped: it is quantized and reported the same 45.2 MB for all three paths, which is not a
measurement of anything. Asserting the naive path's aggregate against the engine's was rejected
as well — the naive path is naive on purpose, and these numbers are about cost, not correctness.

**Consequences.**

- `storeBytes` counts the ColumnStore instead: exactly for the typed arrays, and at V8's worst
  case for the strings a dictionary holds. It is an upper bound, the README says so, and the
  row-objects side of §13's memory comparison stays a DevTools heap snapshot that nobody has
  taken. Unticked rather than estimated.
- Both observers are installed in `main.tsx` before anything else runs, so their readings cover
  a whole session. **INP can only come from a real interaction**, which is why the figure comes
  out of the scripted Playwright flow and the dev panel rather than out of `#bench`: Event Timing
  will not time something this code fakes.
- A `PerformanceObserver` disconnected before its last entry has been delivered hands that entry
  to the next observer, so `#bench` checks every entry against the moment its own path started —
  without that, the worker path was credited with a 98 ms block belonging to the path before it.
- Instrumentation in a render path needs a ceiling. `canvas:draw` is one mark and one measure per
  animation frame, nothing evicts user timing, and a continuous drag is sixty a second; the
  timeline keeps the last 240 frames. The measurement that discovered the 4.4 ms pan frame is the
  measurement that had to be bounded.
- One anomaly is recorded rather than smoothed: a canvas frame that returns the pan to exactly
  the origin costs about five times one that moves further out — 21 ms against 4.4 ms at 98,899
  points, reproducibly, cause not established. It is in `docs/bench/canvas-pan.json` under
  `anomaly`, and the published median is the continuous pan, which never touches it.
- The end-to-end flows are a plain `.mjs` with `assert` (`scripts/e2e-run.mjs`), not
  `@playwright/test`, and they build their SSE frames from `src/ai/fixtures.ts` — the same
  recordings Demo mode replays, which is the dual use ADR-0002 chose fixtures for. `route.fulfill`
  cannot dribble a body out frame by frame, so the cancel lands mid-request rather than between
  two deltas; the abort path is identical either way, and it is the only part of the flow the stub
  cannot make faithful.
