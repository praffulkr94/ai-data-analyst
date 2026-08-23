/** What the model is sent: the Operation grammar, the rules, and the DatasetSchema, in that
    order, and then the Question.

    **Raw rows never appear here.** Per column the DatasetSchema carries a name, a ColumnType, a
    confidence, a null count, and either the eight most frequent values or a min/max/mean.
    `DatasetHandle.sampleRows` exists for the table preview and is not part of this file's input
    — which is the property the "what the model sees" inspector exists to let a visitor check
    rather than take on trust. */
import type Anthropic from '@anthropic-ai/sdk';
import { isCategoryStats, isNumberStats, type ColumnMeta, type DatasetSchema } from '../engine/types';
import type { AnalysisSpec } from '../spec/grammar';
import type { SpecViolation } from '../spec/validate';

/** The ceiling on one reply. A spec is a few hundred tokens; 2,048 leaves room for a narration
    and adaptive thinking without leaving room for a runaway. A `max_tokens` stop is treated as a
    structural failure and consumes the single Repair. */
export const MAX_TOKENS = 2048;

/** The pipeline the fields describe. None of this is expressible in a JSON Schema — the schema
    says a `sort` has a `by` and a `dir`, not that it runs after aggregation and therefore names
    an aggregation id. */
const GRAMMAR = `# The Operation grammar

An Operation runs as a fixed pipeline, in this order:

1. \`filters\` — AND only, applied to the Dataset's rows.
2. \`timeBucket\` — floors a date column to a day, week, month, quarter or year. It is separate
   from \`groupBy\` because the x-axis needs to know a dimension is temporal.
3. \`groupBy\` — up to two columns.
4. \`aggregations\` — one to three. Each has an \`id\`, a function, a \`column\` and a \`label\`.
5. \`derived\` — at most one ratio, whose \`numerator\` and \`denominator\` name aggregation ids.
6. \`sort\` and \`limit\` — over the aggregated rows.

The result is a table whose fields are the bucketed and grouped columns (dimensions) and the
aggregation and derived ids (measures). **The Visualization's \`x\`, \`y\` and \`seriesBy\` name
fields of that result, never columns of the Dataset.** A column that was not grouped by,
bucketed or aggregated is not a field of the result.`;

const RULES = `# Rules

You translate a question into one analysis specification. You never compute anything, you never
report a finding, and you are never shown the rows — the application executes the specification
itself and computes every number the visitor sees.

Call exactly one tool. Before the tool call, write a single sentence, under 160 characters,
restating the analysis you understood; no other prose, no lists, no markdown. Repeat that same
sentence as the \`narration\` field so it survives with the specification.

Choosing the tool:

- \`submit_analysis\` whenever the question can be expressed in the grammar, even approximately.
- \`ask_clarification\` when the question could reasonably mean two or more different analyses.
- \`report_unsupported\` when it is outside the grammar. The grammar cannot express joins, window
  functions, period-over-period comparison, per-group growth ranking, cohorts, forecasting,
  causal "why", OR or nested filters, or any expression beyond one ratio. Name the boundary
  plainly and suggest one to three nearby questions that are inside it.

Field limits, all of which the application enforces: at most 5 filters, at most 2 \`groupBy\`
columns, 1 to 3 aggregations, at most 1 derived ratio, at most 50 values in an \`in\` filter, a
\`limit\` between 1 and 1000, a \`title\` of at most 60 characters and a \`narration\` of at
most 160.

Aggregations:

- \`count\` counts rows and takes \`"column": null\`. Every other function needs a column.
- \`sum\`, \`avg\`, \`median\` are legal only on a number column.
- \`min\` and \`max\` are legal on a number or a date column.
- \`rate\` is the share of true values and is legal only on a boolean column. \`avg\` and \`sum\`
  on a boolean are refused.
- A categorical column admits only \`count\` and \`countDistinct\`.

Visualizations:

- \`bar\` for a categorical dimension on the x-axis.
- \`line\` and \`area\` join their points, so their x must be ordered — a \`timeBucket\` column
  or a numeric one, never a bare category.
- \`scatter\` plots one measure against another, so both \`x\` and \`y\` are measures.
- \`seriesBy\` names a dimension other than the x-axis, or is null.

\`intent\` is \`"refine"\` when the question modifies the analysis shown below, and \`"new"\`
otherwise. A question that changes only the chart type or an aggregation is a refinement.

Prefer a \`limit\` with a \`sort\` when a question asks for a "top" anything. Where a question
names a category value, use the value exactly as it is spelled in the DatasetSchema below.`;

/** One line per column. `date` statistics are epoch milliseconds in the ColumnStore, so they are
    rendered back as ISO dates here — a min of 1298764800000 tells the model nothing. */
function describeColumn(col: ColumnMeta): string {
  const head = `- \`${col.name}\` — ${col.type}, confidence ${col.confidence.toFixed(2)}, ${
    col.nullCount
  } nulls`;
  if (isNumberStats(col.stats)) {
    const n = col.type === 'date' ? isoDate : round;
    return `${head}; min ${n(col.stats.min)}, max ${n(col.stats.max)}, mean ${n(col.stats.mean)}`;
  }
  if (isCategoryStats(col.stats)) {
    const values = col.stats.top.map((t) => `"${t.value}"`).join(', ');
    return `${head}; ${col.stats.distinct} distinct, most frequent: ${values}`;
  }
  return head;
}

export const describeSchema = (schema: DatasetSchema): string =>
  `# The DatasetSchema\n\nThese are the columns of the loaded Dataset. Only these exist.\n\n${schema.columns
    .map(describeColumn)
    .join('\n')}`;

/** The system prompt, as two blocks with the cache breakpoint on the second.

    The cached prefix is tools + system, which is everything up to and including the
    DatasetSchema; the Question that changes every time sits after it, in `messages`. The minimum
    cacheable prefix is roughly 1,024 tokens and a shorter one silently fails to cache, which is
    why `usage.cache_read_input_tokens` is shown in the readout rather than the caching being
    claimed. */
export function systemBlocks(schema: DatasetSchema): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: `${GRAMMAR}\n\n${RULES}` },
    {
      type: 'text',
      text: describeSchema(schema),
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/** One earlier Question and the spec it produced. A refine carries the previous spec and the last
    two exchanges — never the full history, which grows without bound and buys nothing. */
export type Exchange = { question: string; spec: AnalysisSpec };

const HISTORY_KEPT = 2;

export type PromptRequest = {
  question: string;
  schema: DatasetSchema;
  /** Present when a Question is refining an Analysis already on screen. */
  refine?: { spec: AnalysisSpec; history: Exchange[] };
};

export function userMessages(req: PromptRequest): Anthropic.MessageParam[] {
  const parts: string[] = [];
  if (req.refine) {
    for (const past of req.refine.history.slice(-HISTORY_KEPT)) {
      parts.push(`Earlier question: ${past.question}`);
    }
    parts.push(
      'The analysis currently shown, which this question may be refining:\n' +
        '```json\n' +
        JSON.stringify(req.refine.spec, null, 2) +
        '\n```',
    );
  }
  parts.push(`Question: ${req.question}`);
  return [{ role: 'user', content: parts.join('\n\n') }];
}

/** The Repair's turn: the tool call the model made, then its result marked as an error carrying
    the violations. Structured, not prose — "column `revenu` does not exist; available numeric
    columns: home_score, away_score" is a correctable instruction; "invalid spec" is not. */
export type ToolCall = { id: string; name: string; input: unknown };

export function repairTurns(
  call: ToolCall | null,
  problem: { violations: SpecViolation[] } | { message: string },
): Anthropic.MessageParam[] {
  const text =
    'violations' in problem
      ? `That specification cannot be executed against this Dataset:\n\n${problem.violations
          .map((v) => `- ${v.path}: ${v.message}`)
          .join('\n')}\n\nCall the tool again with those corrected.`
      : `${problem.message}\n\nCall the tool again.`;
  // A reply cut off by `max_tokens`, or one that called no tool at all, leaves nothing to echo
  // back as an assistant turn — the correction goes as plain text instead.
  if (!call) return [{ role: 'user', content: text }];
  return [
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input as object }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: text }],
    },
  ];
}

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
