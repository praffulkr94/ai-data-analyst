/** The two models, their prices, and the per-model request normalizer.

    The normalizer is here rather than as a hidden `if` inside the client because the two models
    genuinely do not take the same request, and the difference is a real decision rather than an
    accident (DECISIONS §A3, ADR-0020). Sonnet 5 rejects `temperature` and `budget_tokens` with a
    400 and supports `output_config.effort`; Haiku 4.5 is the pre-4.6 generation, where `effort`
    errors and thinking is configured with `budget_tokens`. */
import type Anthropic from '@anthropic-ai/sdk';

/** What the picker offers. The label is what a visitor chooses between; the id is what the API
    is told. A Revision records the choice, so a card can say which model produced it. */
export type ModelChoice = 'smart' | 'fast';

export type ModelInfo = {
  id: string;
  label: string;
  note: string;
  /** Dollars per million tokens. */
  input: number;
  output: number;
  /** Introductory input/output prices, and the last day they apply. */
  intro?: { input: number; output: number; until: string };
};

export const MODELS: Record<ModelChoice, ModelInfo> = {
  smart: {
    id: 'claude-sonnet-5',
    label: 'Smart',
    note: 'Sonnet 5 — adaptive thinking at low effort.',
    input: 3,
    output: 15,
    intro: { input: 2, output: 10, until: '2026-08-31' },
  },
  fast: {
    id: 'claude-haiku-4-5',
    label: 'Fast',
    note: 'Haiku 4.5 — no thinking, roughly a third of the cost.',
    input: 1,
    output: 5,
  },
};

export const MODEL_CHOICES = Object.keys(MODELS) as ModelChoice[];

/** A cached input token bills at a tenth of an uncached one, and writing to the cache costs a
    quarter more than not caching. Those two multipliers are what make the readout's separate
    cache figure worth showing rather than folding into the input count. */
const CACHE_READ = 0.1;
const CACHE_WRITE = 1.25;

export type TokenCounts = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

/** Dollars for one Request. `on` decides whether introductory pricing still applies, so the
    readout does not quietly keep quoting a price that expired. */
export function costOf(choice: ModelChoice, tokens: TokenCounts, on = new Date()): number {
  const model = MODELS[choice];
  const intro = model.intro && on.toISOString().slice(0, 10) <= model.intro.until;
  const input = intro ? model.intro!.input : model.input;
  const output = intro ? model.intro!.output : model.output;
  return (
    (tokens.inputTokens * input +
      tokens.cacheReadTokens * input * CACHE_READ +
      tokens.cacheWriteTokens * input * CACHE_WRITE +
      tokens.outputTokens * output) /
    1_000_000
  );
}

/** The prices, as the tooltip states them — including the introductory pair while it still
    applies. Here rather than in the composer because `costOf` already owns the rule for when
    intro pricing expires, and a second copy of that date comparison in the interface is a drift
    bug that shows up as a quoted price nobody is charged. */
export function priceNote(choice: ModelChoice, on = new Date()): string {
  const model = MODELS[choice];
  const intro = model.intro && on.toISOString().slice(0, 10) <= model.intro.until;
  const { input, output } = intro ? model.intro! : model;
  return intro
    ? `$${input} / $${output} per M tokens — introductory, through ${model.intro!.until}`
    : `$${input} / $${output} per M tokens`;
}

/** Translating a Question into a narrow grammar does not benefit from deep reasoning, so Smart
    thinks adaptively at low effort — which bounds the output cost and keeps the narration short.
    Disabling thinking outright was considered and rejected: disabled thinking is where the
    leaked-tag and tool-call-in-visible-text failure modes live.

    Fast omits `thinking` entirely rather than setting a `budget_tokens`. A budget is the only way
    to enable thinking on that generation, and this task does not want any. */
export function normalize(
  choice: ModelChoice,
  body: Omit<Anthropic.MessageCreateParamsStreaming, 'model' | 'stream'>,
): Anthropic.MessageCreateParamsStreaming {
  const base = { ...body, model: MODELS[choice].id, stream: true as const };
  if (choice === 'fast') return base;
  return { ...base, thinking: { type: 'adaptive' }, output_config: { effort: 'low' } };
}
