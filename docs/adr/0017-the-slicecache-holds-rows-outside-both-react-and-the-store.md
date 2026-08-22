# The SliceCache holds rows outside both React and the Zustand store

RowSlices, and the knowledge of which ones have arrived, live in a plain module the table reads
synchronously. React sees it through one `useSyncExternalStore` over a revision counter. They do
not go into the Zustand store, and they are not component state.

The store is the wrong home because a RowSlice landing during a fling would notify every selector
subscribed to it, and per-scroll-position row data changes several times a second: the schema panel
and eventually the chart would re-render on scroll. Component state is the wrong home because the
transport resolves outside the React tree, and because the cache has to answer `row(i)`
*synchronously during render* — the table renders against whatever has arrived and draws a skeleton
for the rest, which a state update scheduled for the next commit cannot do.

The staleness rule follows from the same place. A RowSlice is dropped **on arrival**, by comparing
its `viewVersion` and its offset against what the viewport currently wants — not by cancelling the
request. Cancelling would be an optimisation of the wrong thing: during a fling the correct output
*is* a skeleton, so there is nothing worth racing to stop, and a cancel that lost the race would
still need the arrival check to be correct.

**Considered options:** putting rows in the store was the smaller diff and is what the first sketch
did; it was rejected on the re-render cost above. Cancelling stale requests instead of dropping
their answers was rejected because correctness would then depend on a race — the same reasoning
ADR-0006 applies to Requests, one layer down.

**Consequence:** any React memo over cache reads must include the revision in its dependencies. The
`row` reader is a stable function over mutating state, so a memo keyed only on the row range will
render the first paint and never update — this cost one debugging pass to find and is the trap the
design carries.
