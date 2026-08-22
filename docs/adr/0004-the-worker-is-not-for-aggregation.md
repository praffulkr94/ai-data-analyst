# The worker exists for parsing, inference and sorting — not aggregation

Grouping and aggregating 100,000 already-parsed rows takes roughly 15–30ms, so moving that off
the main thread is not the justification for the worker and must not be presented as one. The
worker exists to own the dataset and to keep CSV parsing, type inference and coercion, index-vector
construction and locale-aware string sorting off the main thread. Aggregation runs there because
that is where the data lives.

**Consequences:** the performance evidence targets long-task elimination during load and sort, not
an aggregation before/after. Anyone tempted to headline "worker aggregation is faster" should read
this first — that claim does not survive scrutiny.
