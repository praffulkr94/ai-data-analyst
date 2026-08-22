# AI Data Analyst

A browser workspace for exploring a tabular dataset by asking questions in natural language. The
model translates a question into a validated analysis specification; the application executes it and
renders the result. The model never performs the analysis and never reports findings.

This file is the project's vocabulary. It contains no implementation detail — for architecture see
`DECISIONS.md`, and for individual decisions see `docs/adr/`.

## Language

### The data

**Dataset**:
The tabular data the user has loaded, either a built-in sample or an uploaded CSV.
_Avoid_: table, file, data source

**DatasetSchema**:
The list of columns in a Dataset with their inferred types, confidence and summary statistics.
_Avoid_: schema panel, inferred schema, columns, column metadata

**ColumnType**:
What kind of values a column holds: number, date, categorical, or boolean.
_Avoid_: data type, field type

**Null token**:
A string that means "no value" rather than a value — `NA`, `N/A`, `-`, `null`, or blank. Their
presence must not make a numeric column categorical.
_Avoid_: missing marker, placeholder, sentinel

**ColumnStore**:
The worker's private storage of a Dataset's values, held one column at a time. The only copy of the
rows in the application.
_Avoid_: columnar store, the store, worker store, row store, data engine

**DatasetHandle**:
The main thread's description of a Dataset — its size, its DatasetSchema, and a small sample. Carries
no rows.
_Avoid_: dataset reference, dataset info

### Asking and answering

**Question**:
What the user types or picks from a chip. Natural language, not a query.
_Avoid_: prompt, query, message

**Translator**:
The boundary that turns a Question plus a DatasetSchema into a ModelReply. Has two
implementations — one calling the Anthropic API, one replaying Fixtures.
_Avoid_: SpecGenerator, the LLM, LLM client, AI service

**ModelReply**:
What the Translator returns. Exactly one of three kinds: an AnalysisSpec, a Clarification, or an
Unsupported notice.
_Avoid_: SpecResponse, response, the spec (two of the three kinds contain no spec)

**AnalysisSpec**:
A validated description of one analysis: its title, its narration, the Operation to perform, and the
Visualization to draw. The unit of work the application executes. Referred to as "the spec".
_Avoid_: chart spec, analysis plan, the response

**Operation**:
The data transformation an AnalysisSpec asks for — filters, grouping, time bucketing, aggregations,
sort, limit.
_Avoid_: query, transform, the spec

**Visualization**:
The chart configuration an AnalysisSpec asks for — its type and which fields map to which channels.
_Avoid_: viz, chart config, chart spec

**Narration**:
The single sentence the model streams restating the intent it understood, before any data moves.
Model-written, and the only model-written text the interface shows.
_Avoid_: preamble, explanation, commentary, summary

**Clarification**:
A ModelReply saying the Question was ambiguous, offering options to choose between.
_Avoid_: follow-up question, disambiguation

**Unsupported**:
A ModelReply saying the Question is outside what the Operation grammar can express, offering nearby
Questions that are.
_Avoid_: error, failure, rejection, refusal

**SpecViolation**:
A reason an AnalysisSpec cannot be executed against the loaded Dataset — a column that does not
exist, an aggregation illegal for a column's type, a chart type incompatible with the result.
_Avoid_: validation error, spec error

### Results and history

**Analysis**:
A titled question-and-answer unit in the workspace, holding a history of Revisions. What the user
sees listed and returns to.
_Avoid_: turn, card, analysis card, conversation, thread

**Revision**:
One immutable version of an Analysis — the AnalysisSpec, the AnalysisResult, and which model
produced it. Refining an Analysis appends a Revision; undo steps back one.
_Avoid_: version, iteration, edit

**AnalysisResult**:
The computed outcome of one Revision: the aggregated data and the chart drawn from it.
_Avoid_: output, chart data, the result set

**ChartSummary**:
The deterministic one-line description of an AnalysisResult, computed by the application from the
data. Never written by the model.
_Avoid_: caption, label, insight, description

**Degenerate result**:
An AnalysisResult that is technically valid but awkward to draw — no rows, a single row, all-null
values, or more groups than can be shown.
_Avoid_: edge case, empty state

**Cardinality fold**:
Collapsing everything past the most significant groups into a single "Other", so a chart of 2,000
cities stays readable.
_Avoid_: truncation, top-N, limiting

### Requesting

**Request**:
One in-flight submission lifecycle, from the user pressing send to a result landing or being
discarded. Distinct from the Analysis it will eventually contribute to.
_Avoid_: turn, call, transaction

**Staleness guard**:
The check at every step of a Request that abandons it if a newer Request has since started.
_Avoid_: gen guard, race check

**Latest-wins**:
The policy that only the newest Request may produce a visible result; earlier ones are abandoned
rather than queued.
_Avoid_: debounce, last-write-wins

**Repair**:
The single retry made when an AnalysisSpec has SpecViolations, sending them back so the model can
correct itself.
_Avoid_: retry loop, self-healing, fallback

### Reading the table

**ViewState**:
How the user has arranged the table — sort, filters, column visibility. Inspection only; it never
changes an Analysis.
_Avoid_: table state, grid config

**RowIndex**:
The ordered set of rows that a ViewState selects from a Dataset.
_Avoid_: index vector, sorted index, row order

**RowSlice**:
A contiguous run of rows fetched for display because they are near the viewport.
_Avoid_: window, page, chunk, batch

### Modes and colour

**Demo mode**:
Operating without an API key, answering only the demo repertoire from recorded Fixtures. The default
for a first-time visitor.
_Avoid_: canned mode, offline mode, sandbox, Live (there is no "Live" mode — its opposite is named
below)

**BYOK mode**:
Operating with the visitor's own Anthropic API key, so any Question can be asked. Labelled "Your API
key".
_Avoid_: live mode, real mode, production mode

**Fixture**:
A recorded model response for one of the demo repertoire's Questions, replayed through the real
validation and execution path.
_Avoid_: mock, stub, canned response, snapshot

**Demo repertoire**:
The fixed set of Questions that Demo mode can answer.
_Avoid_: sample questions, presets

**Series**:
One set of marks in a chart sharing an identity — a line, or one colour of bar.
_Avoid_: line, group, category

**SeriesSlot**:
A position in the categorical palette. Assigned in fixed order and never cycled.
_Avoid_: colour index, palette entry

**Series budget**:
The maximum number of Series a chart may draw before folding the rest into "Other". Lower for
scatter than for bar and line.
_Avoid_: series limit, max series

**Category**:
One distinct value along a categorical axis.
_Avoid_: group, bucket, label
