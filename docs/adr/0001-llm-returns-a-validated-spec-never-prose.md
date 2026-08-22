# The model returns a validated specification, never prose or data

The model's only job is translating a natural-language question into a structured analysis
specification, which the application validates and then executes itself. It never returns a
number, a finding, or a claim about the data, and ChartSummary text is computed deterministically
from the aggregation result. This keeps the dataset out of the request, makes every calculation
deterministic and testable, and lets invalid model output be rejected rather than rendered.

**Consequences:** the specification's grammar is a hard ceiling on what can be asked. Questions
outside it (period-over-period, per-group growth ranking, causal "why") return a structured
`unsupported` response with suggestions, never an error and never a guess.
