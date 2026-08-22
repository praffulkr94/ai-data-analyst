# The fold picks its dimension: never the time axis, and a Series to six

Until M4 every result had one dimension, so "the fold" needed no subject: the top fifteen groups
survived and the rest became "Other". A line chart breaks that. `timeBucket` and `groupBy` produce
two dimensions, one of them is the x-axis and one of them is the Series, and folding the wrong one
answers a question nobody asked.

**A temporal dimension is never folded.** Matches per year since 1872 is 155 buckets. Folded to
fifteen it becomes "the fifteen years with the most matches, plus a bucket holding the other 140" —
which is not a time series, and joined into a line it is a shape with no meaning. What bounds a
time axis instead is the point cap: a thousand points by construction, and past that the result is
marked truncated and refused rather than drawn short. The same reasoning makes a temporal result
lay itself out ascending when the spec names no sort, because the executor's default of
metric-descending draws a line through its points in size order.

**A Series folds to six, the fold included.** The palette has six slots, assigned in fixed order
and never cycled (ADR-0012), so a seventh Series would have to reuse a colour that already means
something else. Five Series are kept and the rest pool into "Other" — which is drawn, unlike a
folded x-axis category: one more line on a shared scale costs the reader nothing, where an "Other"
bar holding 87% of the Dataset flattens the fifteen bars the Question was about (ADR-0018).

**Series are ranked by their whole run, not by their best cell.** The first implementation ranked
the (year, team) cells and kept the top five, which keeps a team that spiked once in 1994 and folds
a team that was second every year for thirty years. "Top teams over time" means the second one.
Ranking a dimension's values means scoring each over all of its rows pooled, and the pooling is
from rows rather than from group totals — so an average over "Other" is the mean of those rows and
not the mean of their means. That is the one rule ADR-0018 already fixed, now applied to a
dimension that is not the first one.

**Considered options:** folding whichever dimension came first was the existing behaviour and the
smallest diff; it folds the time axis, which is the one thing that must not fold. Refusing a
two-dimension result outright and making the model ask for one line at a time was rejected — "goals
per year by tournament" is the second Question anyone asks of this Dataset. Drawing all 202
tournaments and letting the reader squint was rejected on the palette: past six lines the colours
stop being distinguishable, and past three under colour-vision deficiency.

**Consequence:** the executor now needs the Visualization's `seriesBy` as well as its `y`, so both
travel on the `analyze` message; without it the executor cannot tell a Series from an x-axis and
falls back to folding the first non-temporal dimension. `ChartSummary` carries the fold as one
object naming the dimension that folded and how many values it kept, because the caption cannot
hardcode a number that is fifteen categories in one chart and five Series in the next — the old
formatters printed "Top 15" whatever had actually happened.

The renderability guard is the other half of the same idea. A result that validated and executed
can still be undrawable: 800 bands are under a pixel each at any width a browser has, and a
truncated result is a fraction of an answer presented as the whole one. Both are refused before
render with the count and the nearest Question that would work — 60 bands for a bar, the point cap
for a line, and 5,000 for the scatter that arrives in M8. What is counted is positions on the
x-axis and not rows, because Series share a position: six Series over sixty categories is 360 rows
and draws perfectly well.
