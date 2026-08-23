/** The Translator seam: a Question plus a DatasetSchema in, a ModelReply out.

    Two implementations sit behind it — one calling the Anthropic API, one replaying Fixtures in
    Demo mode — and only the transport differs between them. Validation, execution and rendering
    are the same code either way, which is the whole argument for Fixtures over a proxy, and it is
    what lets the `Workspace` be tested without HTTP. */
import type { DatasetSchema } from '../engine/types';
import type { ModelReply } from '../spec/grammar';
import type { SpecViolation } from '../spec/validate';
import type { ModelChoice, TokenCounts } from './models';
import type { PromptRequest } from './prompt';

export type Usage = TokenCounts & {
  model: ModelChoice;
  /** True when these counts were replayed from a Fixture and nothing was charged. The readout
      says so rather than vanishing or implying a charge. */
  recorded: boolean;
};

export const NO_USAGE = (model: ModelChoice, recorded = false): Usage => ({
  model,
  recorded,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
});

export type TranslateRequest = PromptRequest & {
  schema: DatasetSchema;
  model: ModelChoice;
  /** The single Repair: the attempt that failed, and why. */
  repair?: { attempt: Attempt; problem: { violations: SpecViolation[] } | { message: string } };
};

/** What the interface reports while a reply arrives. The narration streams as text; the chips
    come from the tool JSON via the tolerant partial reader. Two sources on purpose — a partial
    specification cannot be rendered, so streaming it would buy nothing (ADR-0007). */
export type TranslateEvents = {
  onNarration?: (delta: string) => void;
  onChips?: (chips: string[]) => void;
};

/** One round-trip. A structural failure is reported rather than thrown, because it consumes the
    same single Repair a semantic failure does and the caller decides. */
export type Attempt = {
  /** Structurally valid, or `null` when Zod rejected it or the reply carried no tool call. */
  reply: ModelReply | null;
  failure: { kind: 'invalid' | 'max-tokens' | 'no-tool'; message: string } | null;
  usage: Usage;
  /** What the model actually sent, shown in the inspector. */
  input: unknown;
  /** Whatever the Translator needs to continue this exchange for a Repair. Opaque to the
      `Workspace`, which hands it straight back rather than looking inside. */
  echo: unknown;
};

export interface Translator {
  translate(
    req: TranslateRequest,
    events?: TranslateEvents,
    signal?: AbortSignal,
  ): Promise<Attempt>;
}

/** One seam, two implementations, picked per Request. Mode therefore decides only which
    Translator answers — the Dataset, the Analyses and the Revisions are not this function's
    business and it cannot touch them, which is why switching mode preserves all three for free. */
export const switching = (pick: () => Translator): Translator => ({
  translate: (req, events, signal) => pick().translate(req, events, signal),
});

/** Raised when the visitor cancelled. Not a failure of the Request — the caller drops it. */
export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}
