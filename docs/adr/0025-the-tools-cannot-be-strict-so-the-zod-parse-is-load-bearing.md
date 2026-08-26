# The tools cannot be strict, so the Zod parse is load-bearing

DECISIONS "Verified facts" says to use `client.messages.stream()` plus a `strict: true` tool, and
§1 leans on that: because the API enforces the schema server-side, the interesting validation is
the semantic layer, not the structural one. The first real request with a visitor's own key said
otherwise, with a 400:

> The compiled grammar is too large, which would cause performance issues. Simplify your tool
> schemas or reduce the number of strict tools.

**Decision. `strict` comes off all three tools. The schema still ships, as a hint.**

A strict tool is not a validation flag — it makes the API compile a constrained-decoding grammar
from `input_schema` and hold the sampler inside it. The size of that grammar is not the size of
the JSON Schema, which is 3.3 KB here: an object's properties may arrive in any order, so an
n-property object multiplies the grammar by the orderings of n, and nesting multiplies those
factors together. A six-field ModelReply holding a seven-field Operation holding a six-variant
Filter union is millions of states before the aggregations, the derived ratio and the two
Visualization variants are counted.

Requiring every property (Zod calls six of the Operation's optional, because they have defaults)
was tried first, on the theory that an optional key forces the grammar to accept every subset as
well as every ordering. It is a real effect and it does shrink the grammar — 5,040 orderings
where there were 13,699 subsets-in-orderings — but the same order of magnitude, and the request
still 400s. That change was reverted rather than kept as a half-measure: it made the model spell
out `"filters": []` for a field Zod fills in, and bought nothing.

Nothing else fits either. There is no threshold in the documentation to aim at, the API is the
only way to test a candidate, and every schema shape that would plausibly compile means removing
filter operations or flattening the Operation — gutting the grammar to satisfy the encoding of
the grammar.

**Consequences.**

- `ModelReply.safeParse` at `message_stop` is now the only thing checking structure. It was
  written as the backstop and is unchanged; what changed is that the `invalid` failure kind is
  now reachable from a well-behaved model, not only from a malformed reply. It already routes to
  the single Repair, which is why this is a one-line change and not a milestone.
- §1's ranking survives: the semantic layer is still the one worth writing about, because it is
  still the only layer that knows which columns the visitor loaded. It is simply no longer sitting
  behind a server-side guarantee.
- `toStrictSchema` keeps its name and its work. `oneOf` → `anyOf`, closed objects, and the
  dropped keywords all still produce a schema the API accepts, and the limits it strips
  (`max`, `min`, `maxLength`) are stated in the system prompt's rules where the model reads them.
- The generated-from-Zod property is untouched, so the drift argument that ADR-0001 rests on is
  unaffected.

**Considered and rejected.** Keeping `strict` on `ask_clarification` and `report_unsupported`,
whose schemas are 233 bytes and compile fine: two of three tools strict is an asymmetry to
explain forever, on the two reply kinds where a malformed reply costs least. Switching to
`output_config.format` structured outputs: the same grammar, compiled the same way, plus the loss
of one tool per kind. Splitting `submit_analysis` into several smaller strict tools: the grammar
is a product across nesting, and the nesting is the Operation.
