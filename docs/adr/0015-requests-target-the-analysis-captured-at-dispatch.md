# A Request writes to the Analysis captured at dispatch, not the active one

The `requestId` counter is app-global and only a new submission increments it; selecting a different
Analysis is a pure view change and cancels nothing. A Request therefore completes against the
Analysis it was started for, even if the user has since navigated elsewhere — so the staleness guard
captures both `requestId` and `targetAnalysisId` at dispatch and writes to the captured target.

**Considered options:** per-Analysis counters were rejected because they permit two concurrent
in-flight Requests, reintroducing the interleaving ADR-0006 eliminates. Cancel-on-switch was rejected
as hostile — it discards work the user explicitly asked for in order to service a navigation.

**Consequences:** reading "the active Analysis" at resolve time is the specific defect this rules
out. Because a result can land out of view, the Analysis list needs a quiet "updated" marker.
