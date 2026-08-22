/** The AnalysisSpec grammar. Zod is the single source of truth: the model's tool `input_schema`
    is generated from these schemas at module init, so the two cannot drift.

    The grammar is deliberately narrow. It cannot express joins, window functions,
    period-over-period comparison, per-group growth ranking, cohorts, forecasting, causal "why",
    OR or nested filters, or arbitrary expressions beyond one ratio. That ceiling is a direct
    consequence of not sending rows to the model, and the README says so. */
import { z } from 'zod';

export const Filter = z.discriminatedUnion('op', [
  z.object({
    op: z.enum(['eq', 'neq']),
    column: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({ op: z.enum(['gt', 'gte', 'lt', 'lte']), column: z.string(), value: z.number() }),
  z.object({ op: z.literal('in'), column: z.string(), values: z.array(z.string()).min(1).max(50) }),
  z.object({ op: z.literal('between'), column: z.string(), from: z.number(), to: z.number() }),
  z.object({ op: z.literal('dateRange'), column: z.string(), from: z.string(), to: z.string() }),
  z.object({ op: z.enum(['isNull', 'isNotNull']), column: z.string() }),
]);

/** `rate` is the share of true values in a boolean column — the aggregation the boolean
    ColumnType exists to serve. `sum` and `avg` on a boolean are rejected by the semantic
    validator, which is where that rule belongs. */
export const AGGREGATION_FNS = [
  'sum',
  'avg',
  'count',
  'countDistinct',
  'min',
  'max',
  'median',
  'rate',
] as const;

export const Aggregation = z.object({
  id: z.string(),
  fn: z.enum(AGGREGATION_FNS),
  /** `null` if and only if `fn` is `count`. */
  column: z.string().nullable(),
  label: z.string(),
});

/** One ratio, and only one. Both sides name an Aggregation `id`. */
export const DerivedMetric = z.object({
  id: z.string(),
  label: z.string(),
  numerator: z.string(),
  denominator: z.string(),
});

export const TIME_UNITS = ['day', 'week', 'month', 'quarter', 'year'] as const;

/** Separate from `groupBy` because the x-axis needs to know it is temporal. */
export const TimeBucket = z.object({ column: z.string(), unit: z.enum(TIME_UNITS) });

export const Operation = z.object({
  /** AND only. */
  filters: z.array(Filter).max(5).default([]),
  groupBy: z.array(z.string()).max(2).default([]),
  timeBucket: TimeBucket.nullable().default(null),
  aggregations: z.array(Aggregation).min(1).max(3),
  derived: z.array(DerivedMetric).max(1).default([]),
  sort: z.object({ by: z.string(), dir: z.enum(['asc', 'desc']) }).nullable().default(null),
  limit: z.number().int().min(1).max(1000).nullable().default(null),
});

export const CHART_TYPES = ['bar', 'line', 'area', 'scatter'] as const;

export const Visualization = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['bar', 'line', 'area']),
    x: z.string(),
    y: z.string(),
    seriesBy: z.string().nullable().default(null),
  }),
  z.object({
    type: z.literal('scatter'),
    x: z.string(),
    y: z.string(),
    seriesBy: z.string().nullable().default(null),
  }),
]);

/** Exactly one of three kinds. Two of them contain no spec, which is why this is never called
    "the spec" — see CONTEXT.md on ModelReply. */
export const ModelReply = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('analysis'),
    /** Dispatch metadata only. Consumed and discarded, never persisted (ADR-0014). */
    intent: z.enum(['new', 'refine']),
    title: z.string().max(60),
    narration: z.string().max(160),
    operation: Operation,
    visualization: Visualization,
  }),
  z.object({
    kind: z.literal('clarification'),
    question: z.string(),
    options: z.array(z.string()).min(2).max(4),
  }),
  z.object({
    kind: z.literal('unsupported'),
    reason: z.string(),
    suggestions: z.array(z.string()).min(1).max(3),
  }),
]);

export type Filter = z.infer<typeof Filter>;
export type Aggregation = z.infer<typeof Aggregation>;
export type AggregationFn = (typeof AGGREGATION_FNS)[number];
export type DerivedMetric = z.infer<typeof DerivedMetric>;
export type TimeBucket = z.infer<typeof TimeBucket>;
export type TimeUnit = (typeof TIME_UNITS)[number];
export type Operation = z.infer<typeof Operation>;
export type Visualization = z.infer<typeof Visualization>;
export type ChartType = (typeof CHART_TYPES)[number];
export type ModelReply = z.infer<typeof ModelReply>;

/** What an Analysis executes: one validated description of one analysis. `intent` is not part
    of it — a Revision's index says what the intent claimed, and a stored copy could disagree. */
export type AnalysisSpec = {
  title: string;
  narration: string;
  operation: Operation;
  visualization: Visualization;
};

export const specFromReply = (reply: Extract<ModelReply, { kind: 'analysis' }>): AnalysisSpec => ({
  title: reply.title,
  narration: reply.narration,
  operation: reply.operation,
  visualization: reply.visualization,
});
