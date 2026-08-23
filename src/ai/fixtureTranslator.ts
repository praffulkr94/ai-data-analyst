/** The Fixture Translator: the same seam, with the transport replaced by a recording.

    Everything downstream of this file is the live path — the reply goes through `readMessage`,
    the same Zod grammar, the same semantic validator, the same worker and the same renderer. A
    Fixture is replayed as a stream rather than returned whole so the narration and the chip strip
    behave as they do with a key: the interface has no way to tell which Translator it has.

    A Question outside the repertoire is refused here rather than answered with the nearest match.
    Demo mode disables free text precisely so that this stays a guard rather than a UX. */
import type Anthropic from '@anthropic-ai/sdk';
import { readMessage } from './anthropic';
import { takeFault, type Fault } from './faults';
import { repertoireFor, type Fixture } from './fixtures';
import { chipsFrom, readPartial } from './partial';
import {
  Retryable,
  sleep,
  type Attempt,
  type TranslateRequest,
  type Translator,
} from './translator';

/** Chunk sizes and gaps taken from what a real stream looks like: a first token a little under
    half a second in, then text a few characters at a time and tool JSON a little faster. */
const FIRST_TOKEN_MS = 420;
const TEXT_GAP_MS = 26;
const PRE_TOOL_MS = 140;
const TOOL_GAP_MS = 18;
const TEXT_CHUNK = [3, 5, 8, 4, 6, 2, 7];
const TOOL_CHUNK = [24, 31, 18, 27, 36, 22];

/** Split text the way deltas arrive: uneven, but deterministically so — a replay that differed
    run to run would make every test that watches the strip flaky. */
function chunks(text: string, sizes: number[]): string[] {
  const out: string[] = [];
  for (let i = 0, n = 0; i < text.length; n++) {
    const size = sizes[n % sizes.length]!;
    out.push(text.slice(i, i + size));
    i += size;
  }
  return out;
}

const TOOL_NAMES = {
  analysis: 'submit_analysis',
  clarification: 'ask_clarification',
  unsupported: 'report_unsupported',
} as const;

/** What the armed fault does to the reply, if anything. Each one is a shape the API really can
    return, so the application meets the same reply it would meet in the wild. */
function damage(input: Fixture['input'], fault: Fault | null): unknown {
  if (fault === 'malformed') return { kind: 'analysis', intent: 'new', title: 'Half a reply' };
  if (fault === 'unknown-column' && input.kind === 'analysis') {
    return {
      ...input,
      operation: { ...input.operation, groupBy: ['home_teem'] },
      visualization: { ...input.visualization, x: 'home_teem' },
    };
  }
  return input;
}

/** The message the recorded deltas add up to. Handed to the same `readMessage` the live stream
    uses, so a Fixture cannot take a shortcut past the structural check. */
function messageFor(fixture: Fixture, model: string, fault: Fault | null): Anthropic.Message {
  return {
    id: `msg_fixture_${fixture.dataset}`,
    type: 'message',
    role: 'assistant',
    model,
    stop_reason: fault === 'max-tokens' ? 'max_tokens' : 'tool_use',
    stop_sequence: null,
    content:
      fault === 'no-tool'
        ? [{ type: 'text', text: fixture.narration, citations: null }]
        : [
            { type: 'text', text: fixture.narration, citations: null },
            {
              type: 'tool_use',
              id: 'toolu_fixture',
              name: TOOL_NAMES[fixture.input.kind],
              input: damage(fixture.input, fault),
            },
          ],
    usage: {
      input_tokens: fixture.usage.inputTokens,
      output_tokens: fixture.usage.outputTokens,
      cache_read_input_tokens: fixture.usage.cacheReadTokens,
      cache_creation_input_tokens: fixture.usage.cacheWriteTokens,
    },
  } as Anthropic.Message;
}

/** Questions differ from their chips only by case and trailing punctuation, so match on neither. */
const key = (q: string) => q.trim().toLowerCase().replace(/[?.!\s]+$/, '');

export type FixtureOptions = {
  /** Multiplier on every recorded gap. Tests pass 0; nothing else should. */
  pace?: number;
  /** Which sample's repertoire applies, read at translate time. A Fixture names columns, so the
      Dataset loaded is what decides whether its Question can be asked at all. */
  dataset?: () => string | null;
  /** Overridden by tests. Everything else takes the shipped repertoire. */
  fixtures?: Fixture[];
};

export function createFixtureTranslator({
  pace = 1,
  dataset = () => null,
  fixtures,
}: FixtureOptions = {}): Translator {
  return {
    async translate(req: TranslateRequest, events, signal): Promise<Attempt> {
      const available = fixtures ?? repertoireFor(dataset());
      const fixture = available.find((f) => key(f.question) === key(req.question));
      if (!fixture) {
        throw new Error(
          `Demo mode replays recorded answers to a fixed set of Questions, and “${req.question}” ` +
            `is not one of them. Pick one of the chips, or switch to your own API key.`,
        );
      }

      const fault = takeFault();
      await sleep(FIRST_TOKEN_MS * pace, signal);
      if (fault === 'rate-limit') {
        throw new Retryable('The API rate-limited this request.', 5_000);
      }
      if (fault === 'overloaded') throw new Retryable('The API is overloaded — it answered 529.');

      for (const delta of chunks(fixture.narration, TEXT_CHUNK)) {
        events?.onNarration?.(delta);
        await sleep(TEXT_GAP_MS * pace, signal);
      }

      await sleep(PRE_TOOL_MS * pace, signal);
      let json = '';
      let shown = '';
      for (const delta of chunks(JSON.stringify(fixture.input), TOOL_CHUNK)) {
        json += delta;
        const chips = chipsFrom(readPartial(json));
        if (chips.join(' ') !== shown) {
          shown = chips.join(' ');
          events?.onChips?.(chips);
        }
        await sleep(TOOL_GAP_MS * pace, signal);
      }

      const attempt = readMessage(messageFor(fixture, req.model, fault), req);
      // Nothing was charged, and the readout says so rather than vanishing or implying a bill.
      return { ...attempt, usage: { ...attempt.usage, recorded: true } };
    },
  };
}
