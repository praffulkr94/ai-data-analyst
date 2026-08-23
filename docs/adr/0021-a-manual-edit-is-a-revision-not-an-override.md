# A manual edit is a Revision, not an override

The chart-type toggle and the aggregation dropdown build a new AnalysisSpec from the one on
screen and run it through the same path a spoken edit takes: the same semantic validation, the
same worker execution, the same target captured at dispatch, and a Revision holding the same
three fields. The two editors produce objects that are indistinguishable once landed, in one
history, and undo does not care which one wrote the Revision it steps back from.

This retires the `chartOverrides` slice named in `DECISIONS.md` §12. It was a fifth slice holding
what the visitor had changed by hand on top of the Analysis's spec, and it means two sources of
truth for what is drawn. Everything downstream then needs both: the Revision stepper would step
the spec while the override stayed put, undo would have to unify two stacks in one keystroke, the
accessible table would describe one of them, and the shareable hash would carry a spec that does
not describe the picture the link was copied from. The point of the manual controls is that
natural language is *one of two editors over the same application-owned spec* — an override layer
is a second spec, which is the opposite claim.

**Considered options:** an override slice, rejected above. A `'manual'` provenance value on
`Revision.model` was rejected because it forks the shape the ledger requires to be identical, and
every reader — the card's model tag, the hash, the model comparison in M9 — would need the branch.
A manual Revision records the model that produced the spec it descends from: the edit changes the
spec, not the lineage, and a Revision index already says whether a model was asked.

Which options each control may offer is asked of `validateSpec` rather than restated: an edit is
applied speculatively and offered only if the validator accepts the result. A line chart over a
categorical x-axis and `avg` over a boolean therefore cannot be offered, without the rule existing
in two places to disagree about.

**Consequences:** a chart-type toggle re-executes an Operation that has not changed, which is tens
of milliseconds of worker time to recompute an identical result. That is the price of one path
with no special case, and `revise` carries a `ponytail:` note naming the cheaper version — reuse
the previous Revision's result when the Operation is unchanged — for whoever measures it and finds
it matters. Undo is a Revision step and not a log of every action, which is why it is Cmd+Z and
why the hash is written with `replaceState`: Back belongs to the browser.
