# Stream the narration, not the specification

A partially-received specification cannot be rendered, so streaming it buys nothing. Instead the
model emits one short narration sentence restating the understood intent, which streams as text, and
the specification's field-by-field arrival drives a chip strip for display only. Partial JSON is
never fed to validation.

**Consequences:** the load-bearing engineering at this boundary is cancellation and staleness
handling, not streaming. Say so rather than overselling the stream.
