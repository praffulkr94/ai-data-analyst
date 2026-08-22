# No LangChain, LangGraph, or agent framework

The workflow is a single model call returning a structured specification, validated, then executed.
There is no orchestration problem to solve. The repair path is one bounded retry — a loop with
`maxAttempts = 2`, not a graph.

**Consequences:** the threshold for revisiting this is conditional multi-step repair (plan → select
tool → execute → validate → branch to repair or continue). Until that exists, a framework would add
abstraction without solving a requirement.
