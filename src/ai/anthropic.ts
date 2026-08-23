/** The Anthropic Translator: streamed strict tool use, straight from the browser.

    There is no backend, so the visitor's key goes directly to the API with
    `dangerouslyAllowBrowser` and the header that acknowledges it. That is a real trade and the
    README states it: a proxy would be about forty lines and would let visitors use the AI without
    a key, and it would be the first thing added if this were a product — for rate limiting and
    prompt management, not for hiding a secret the visitor already owns.

    `messages.stream()` rather than `messages.parse()`: parse is non-streaming, and the narration
    is the whole point of streaming here. The reply is hand-validated with the same Zod grammar at
    `message_stop`. */
import Anthropic from '@anthropic-ai/sdk';
import { ModelReply } from '../spec/grammar';
import { MODELS, normalize } from './models';
import { chipsFrom, readPartial } from './partial';
import { MAX_TOKENS, repairTurns, systemBlocks, userMessages, type ToolCall } from './prompt';
import { TOOLS } from './tool';
import {
  Cancelled,
  NO_USAGE,
  Retryable,
  type Attempt,
  type TranslateRequest,
  type Translator,
  type Usage,
} from './translator';

/** The key lives here and nowhere else: not in the store, not in `localStorage`, not in the URL.
    Closing the tab is all it takes to be rid of it. It survives a switch back to Demo mode so a
    visitor can toggle without re-pasting. */
let apiKey: string | null = null;

export const setApiKey = (key: string | null): void => {
  apiKey = key;
};
export const hasApiKey = (): boolean => apiKey !== null;

function clientFor(key: string): Anthropic {
  return new Anthropic({
    apiKey: key,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
    // The SDK retries a 429 twice on its own, silently. A retry the visitor cannot see is a
    // wait they cannot understand, so the retry is ours and the countdown is on screen.
    maxRetries: 0,
  });
}

/** A rate limit, an overloaded server or a dropped connection is worth waiting out; a 400 or a
    401 is not. `retry-after` is in seconds when the server sends it. */
function asRetryable(e: unknown): Retryable | null {
  if (e instanceof Anthropic.RateLimitError) {
    const after = Number(e.headers?.get('retry-after'));
    return new Retryable(
      'The API rate-limited this request.',
      Number.isFinite(after) && after > 0 ? after * 1000 : null,
    );
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new Retryable('Could not reach the API.');
  }
  if (e instanceof Anthropic.APIError && typeof e.status === 'number' && e.status >= 500) {
    return new Retryable(`The API is overloaded — it answered ${e.status}.`);
  }
  return null;
}

/** Exactly what is sent, as a plain object. The "what the model sees" inspector renders this, so
    a visitor can check for themselves that the DatasetSchema went and the rows did not. */
export function buildRequest(req: TranslateRequest): Anthropic.MessageStreamParams {
  const messages = userMessages(req);
  if (req.repair) {
    messages.push(...repairTurns(req.repair.attempt.echo as ToolCall | null, req.repair.problem));
  }
  return normalize(req.model, {
    max_tokens: MAX_TOKENS,
    system: systemBlocks(req.schema),
    tools: TOOLS,
    messages,
  });
}

export function createAnthropicTranslator(): Translator {
  return {
    async translate(req, events, signal): Promise<Attempt> {
      if (apiKey === null) throw new Error('No API key. Switch to Demo mode or enter a key.');
      const stream = clientFor(apiKey).messages.stream(buildRequest(req), { signal });

      let json = '';
      let shown = '';
      try {
        for await (const event of stream) {
          if (event.type !== 'content_block_delta') continue;
          if (event.delta.type === 'text_delta') events?.onNarration?.(event.delta.text);
          else if (event.delta.type === 'input_json_delta') {
            json += event.delta.partial_json;
            // On field completion, not per delta: an unchanged strip is not re-published.
            const chips = chipsFrom(readPartial(json));
            if (chips.join(' ') !== shown) {
              shown = chips.join(' ');
              events?.onChips?.(chips);
            }
          }
        }
        return readMessage(await stream.finalMessage(), req);
      } catch (e) {
        if (e instanceof Anthropic.APIUserAbortError || signal?.aborted) throw new Cancelled();
        throw asRetryable(e) ?? e;
      }
    },
  };
}

export function readMessage(message: Anthropic.Message, req: TranslateRequest): Attempt {
  const usage = readUsage(message.usage, req);
  const call = message.content.find((b) => b.type === 'tool_use');

  // A reply that ran out of room is structurally incomplete, so it is a structural failure and
  // consumes the same single Repair a malformed one does.
  if (message.stop_reason === 'max_tokens') {
    return {
      reply: null,
      failure: {
        kind: 'max-tokens',
        message:
          `The reply reached the ${MAX_TOKENS}-token ceiling before it finished. ` +
          'Send a shorter title and narration.',
      },
      usage,
      input: call?.input,
      echo: null,
    };
  }

  if (!call) {
    const said = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return {
      reply: null,
      failure: {
        kind: 'no-tool',
        message: said
          ? `The reply was prose rather than a tool call: "${said.slice(0, 200)}"`
          : 'The reply called no tool.',
      },
      usage,
      input: undefined,
      echo: null,
    };
  }

  const echo: ToolCall = { id: call.id, name: call.name, input: call.input };
  const parsed = ModelReply.safeParse(call.input);
  if (!parsed.success) {
    return {
      reply: null,
      failure: {
        kind: 'invalid',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
      },
      usage,
      input: call.input,
      echo,
    };
  }
  return { reply: parsed.data, failure: null, usage, input: call.input, echo };
}

/** The counts the API reported, never an estimate and never a second `count_tokens` call — which
    would cost a round trip to report on a round trip. */
function readUsage(usage: Anthropic.Usage, req: TranslateRequest): Usage {
  return {
    ...NO_USAGE(req.model),
    inputTokens: usage.input_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
  };
}

/** Verified before the mode flips, so a bad key fails in the dialog rather than halfway through
    an analysis. One token on the cheaper model — the smallest call that proves a key works. */
export async function verifyKey(key: string): Promise<void> {
  try {
    await clientFor(key).messages.create({
      model: MODELS.fast.id,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new Error('That key was rejected by the API. Check it and try again.');
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new Error('Could not reach the API. The key was not checked.');
    }
    throw e;
  }
}
