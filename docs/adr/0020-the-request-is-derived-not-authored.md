# The request to the model is derived, never authored by hand

Three things go over the wire on every Question: the tool schemas, the system prompt, and the
per-model parameters. None of them is a hand-written literal, and each is derived from something
that already exists for another reason. That is one decision applied three times, and it is what
keeps the model's view of the application from drifting away from the application.

**The tool `input_schema` is generated from the Zod grammar at module init.** Zod is the single
source of truth for the AnalysisSpec, so a JSON Schema maintained beside it is a drift bug waiting
for the first grammar change: add a `fn` to the aggregation enum and the model keeps being told the
old list, silently, until someone notices the model never uses the new one. Generation makes that
impossible. It costs a rewriting pass, because the strict-tool-use subset is narrower than what Zod
emits — `oneOf` becomes `anyOf`, every object gains `additionalProperties: false`, and the
constraints the subset rejects are dropped. Those constraints are not lost: `maxLength`, `maxItems`
and the numeric bounds are all still enforced by Zod at `message_stop`, and the handful the model
actually needs to know — three aggregations, five filters, two `groupBy` columns — are stated in
the rules, where a sentence reads better than a schema annotation.

**One tool per ModelReply kind, not one tool over the union.** `input_schema` has to be an object
schema and a discriminated union is an `anyOf` at the top level, so a single tool would need a
wrapper property and an unwrapping step on the way back. Three tools need neither: each tool's
schema *is* one member of the union, `kind` literal included, so whatever the model sends goes to
`ModelReply.safeParse` exactly as it arrived. It also reads better to the model — `submit_analysis`,
`ask_clarification` and `report_unsupported` are a choice between three jobs rather than a choice
between three shapes of one argument.

**The two models do not take the same request, and the difference is a named piece rather than a
hidden `if`.** Sonnet 5 takes `thinking: {type: "adaptive"}`, supports `output_config.effort`, and
returns a 400 for `temperature`, `top_p`, `top_k` and `budget_tokens`. Haiku 4.5 is the pre-4.6
generation, where `effort` errors and thinking is configured with `budget_tokens` or not at all.
A normalizer taking a model choice and a body is the whole of it, and it is worth being a file
because the alternative — two branches buried in the client — is where the next model's
incompatibility gets bolted on without anyone deciding anything.

Smart runs adaptive thinking at `effort: "low"`. Translating a Question into a narrow grammar does
not benefit from deep reasoning, and low effort bounds the output cost and keeps the narration
short. **Disabling thinking outright was considered and rejected:** disabled thinking is where the
leaked-tag and tool-call-in-visible-text failure modes live, and a tool call written into visible
text is a turn that succeeds, never runs, and raises nothing. Fast omits `thinking` entirely rather
than setting a budget, because a budget is the only way to turn thinking *on* there and this task
does not want it. Both models support strict tool use, so the validation architecture is identical
across them and the README's comparison is genuinely like-for-like.

**Considered options:** hand-writing the tool schemas was rejected on drift, which is the failure
this whole layer exists to prevent — an application that validates the model's output against a
grammar the model was never shown is worse than one with no grammar. Deriving the schema at build
time rather than module init was rejected as a build step bought nothing: the cost is microseconds
and it happens once. A provider abstraction over the two models was rejected outright; the
difference between them is six lines, and an interface with one implementation is the thing
ADR-0009 already refused at a larger scale.

**Consequences:** the strict subset is a moving target — a keyword the API adds support for will
keep being dropped until the generator's allowlist learns about it, and a keyword it stops
accepting will 400 until the same list does. Both are one line, and the generator's tests assert
the subset rather than a copy of the schema, so they say which. The system prompt is likewise
derived, from the DatasetSchema the worker inferred, and the cache breakpoint sits on it: the
cached prefix is tools + system, all three of them generated, and a test asserts that prefix is
byte-identical across two different Questions and across a Repair. That is the property caching
depends on, and it is the one a hand-edited prompt or a re-ordered tool list would quietly break.
