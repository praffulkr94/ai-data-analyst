# Inference decides types from a sample; the ColumnStore computes statistics exactly

Type inference reads the first 500 rows plus 500 drawn at random, because deciding *which* of four
ColumnTypes a column holds does not need every row and reading every row twice would double the
parse. But every number a column's `stats` reports — a date's range, a numeric mean, a categorical
column's distinct count and its eight most frequent values — is recomputed from the encoded Column
over all rows, along with the true `nullCount`.

The split matters because those two things are consumed differently. The ColumnType is a decision
the visitor can see and override. The statistics are *facts*: they go into the system prompt, which
is how the model learns what the Dataset contains, and onto the schema panel, which is how the
visitor decides whether to trust an answer. Sampled, `city` reads 352 distinct instead of 2,092 and
the hero Dataset's date range stops in June rather than July — quietly wrong in both places, and
wrong in the direction that makes the cardinality guard look unnecessary.

**Considered options:** sampling the statistics too was the cheaper option and is what the
inference sample already had in hand; it was rejected on the numbers above. Inferring types over
every row was rejected as the expensive half of a trade with no payoff — a column's type is decided
by the same rules whichever rows you read, and the sampled reader already catches the case that
motivates sampling at all, a column that turns dirty late in the file.

**Consequence:** `buildColumnStore` returns a corrected `DatasetSchema` rather than echoing the one
it was given, and callers must read the schema off the store rather than off the inference result.
Statistics cost one pass per column at encode time, which is the same pass the encoder makes anyway.
