# One generation counter spans both async boundaries

Every user submission increments a single monotonic counter. Each continuation — after the model
call resolves, after validation, and after the worker responds — returns early if its generation is
no longer current. Worker cancellation and request abortion are best-effort optimisations; the
counter is what makes correctness independent of them.

**Considered options:** independent per-boundary cancellation was rejected because it produces an
invisible bug where a newer model call is aborted but an older worker job still lands and overwrites
the chart. A request queue was rejected because it makes users watch results they no longer want.
