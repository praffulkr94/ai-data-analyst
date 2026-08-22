# The cardinality fold is in the result, the table and the caption — not in the marks

`DataEngine` folds past the top 15 into an "Other" row, exactly as specified. The chart draws the
fifteen and not the sixteenth. "Other" stays in the `AnalysisResult`, in the accessible data
table, and in the visible caption, which states how many groups were folded and what they hold —
"Top 15 of 2,092 cities; the other 2,077 hold 43,259."

Measured on the hero Dataset's most natural first Question, "matches by city": the top city has 745
matches and the folded remainder has 43,259. Drawn on one linear scale the fifteen bars the
Question was about are two pixels tall. The information the fold exists to preserve — that the top
fifteen are a small slice of the whole — is preserved better by a sentence than by a bar that
destroys the comparison the reader came for.

The pooled row is still computed the same way, over the folded groups' rows rather than by summing
their values, so an average over "Other" is the mean of those rows and not the mean of their group
means. That is one rule with no exceptions, and it is what makes the caption's number honest for
every aggregation rather than only the additive ones.

The `extreme` in the ChartSummary excludes the fold for the same reason. "Highest: Other, 43,259"
points the reader at a bucket rather than at an answer.

**Considered options:** drawing "Other" on the shared scale was the specified default and is what
the first implementation did; it was rejected on the numbers above. A broken axis with a clipped
"Other" bar keeps both, and was rejected as a fair amount of geometry to communicate what one
clause already says. Dropping the folded groups entirely was rejected outright — silently analysing
a fraction of the data is the failure this whole project is a reaction to.

**Consequence:** the marks receive a filtered row list, so a mark component must never assume its
rows are the result's rows. `ChartSummary.foldedValue` is the only place the remainder's magnitude
appears on screen, so it is load-bearing rather than decorative.
