# The point budget belongs to the chart type, and travels with the request

M8 asks for a scatter of 100,000 points that pans and hovers smoothly. Until now every result was
bounded by one number: `POINT_CAP` is 1,000, the `analyze:done` message carried at most that many
rows "by construction", and anything longer came back `truncated` — which `degeneracy` turns into
the `too-many` state and refuses to draw. A 100,000-point scatter is that refusal, every time.

**The cap was the aggregate chart's cap all along.** A thousand points is the right bound for a bar
chart, a line and an area: they aggregate to categories or buckets, and a reader cannot compare
more than that. A scatter does not aggregate to a category — its x is a measure, which the semantic
validator has enforced since M5 — so its groups are *positions*, one per row when the grouping is
fine enough. One point per row is not an accident of a bad Question; it is the shape a scatter asks
for. So the cap is not a property of the protocol. It is a property of the chart type.

**Decision.** `CHART_BUDGET` in `src/engine/operation.ts` holds two numbers per chart type — points
and Series — and the Visualization's `type` travels on the `analyze` message beside `metric` and
`seriesBy`, for the same reason those two do: the executor cannot tell any of it by looking at the
Operation. Aggregate charts keep 1,000 points and 6 Series. Scatter gets 100,000 points and 3
Series.

**A scatter's dimensions are not folded.** `foldPlan` folded the first non-temporal dimension to the
top fifteen, which over the 98,899 (date, team) pairs of `team_matches.csv` collapses a
99,000-point scatter to sixteen rows. The reasoning that exempts a time axis (ADR-0019) applies
here unchanged: nothing of the grouping dimension is on an axis, so there are no categories to
fold, and the point cap is what bounds it instead. A scatter's **Series** still folds — to three,
the fold included, because past three yellow and orange appear together and fail the all-pairs
colour-vision floors (ADR-0012). That budget lives with the fold in the executor rather than in the
marks, so the caption names a fold the marks actually performed (ADR-0018).

**Considered options.** A second worker message carrying raw rows through to the main thread was
rejected: it is a whole second execution path, it puts rows on the main thread that ADR-0003 exists
to keep off it, and it is not needed — the grammar already produces 98,899 points from
`groupBy: ["date","team"]`, one per row, with `x` and `y` as aggregations over that pair.
Restating the ledger item at 1,000 points and saying so in the README was rejected because nothing
in the design actually requires it: the number was an aggregate chart's readability limit doing
duty as a transport limit. Raising `POINT_CAP` for every chart type was rejected because a bar
chart with 100,000 bands is exactly what the renderability guard exists to refuse.

**Consequences.**

- `analyze:done` for a scatter carries ~99,000 result rows rather than ~1,000, which is a
  structured clone of a few megabytes and a few hundred milliseconds, once per Analysis. Marked in
  the code with a `ponytail:` note: a columnar `AnalysisResult` over typed arrays is the upgrade
  path if that ever measures, and it touches every reader of `result.rows`.
- `MARK_CAP.scatter` was 5,000 and was doing two jobs. The refusal cap is now the chart type's
  point budget; 5,000 is `CANVAS_ABOVE`, the width at which SVG circles give way to one canvas and
  a quadtree, and nothing else.
- `ResultTable` caps the rows it renders and says so in its caption. It is the chart's accessible
  representation and it stays that — same element, same `aria-describedby`, same test harness — but
  98,899 `<tr>` is 400,000 DOM nodes, which is not an accessibility win for anybody.
- `chartLabel` counts a scatter's groups as "points" rather than "categories", because that is
  what they are.
