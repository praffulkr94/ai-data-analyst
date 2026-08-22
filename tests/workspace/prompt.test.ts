/** What is sent to the model, and how the two models differ.

    The load-bearing assertion here is the negative one: a value that sits below the eight most
    frequent must not appear anywhere in the request. That is the property the "what the model
    sees" inspector exists to let a visitor check, and it is worth a test rather than a promise. */
import { describe, expect, it } from 'vitest';
import { buildRequest } from '../../src/ai/anthropic';
import { costOf, MODELS, normalize } from '../../src/ai/models';
import { MAX_TOKENS, describeSchema, systemBlocks, userMessages } from '../../src/ai/prompt';
import { inferSchema } from '../../src/engine/infer';
import type { DatasetSchema } from '../../src/engine/types';
import type { AnalysisSpec } from '../../src/spec/grammar';
import type { TranslateRequest } from '../../src/ai/translator';
import type { SpecViolation } from '../../src/spec/validate';

/** Ten teams, of which nine are frequent and `Vanuatu` appears once — so it ranks tenth and is
    outside the eight the DatasetSchema carries. `attendance` is chosen so that no individual
    value coincides with the min, the max or the mean. */
const TEAMS = ['Brazil', 'Italy', 'Spain', 'France', 'Japan', 'Ghana', 'Wales', 'Chile', 'Peru'];
const HEADER = ['date', 'home_team', 'attendance', 'neutral'];
const ROWS = [
  ...TEAMS.flatMap((team, i) =>
    [0, 1].map((n) => [`19${70 + i}-0${n + 1}-15`, team, String(4000 + i * 100 + n * 7), 'TRUE']),
  ),
  ['2001-06-01', 'Vanuatu', '9137', 'FALSE'],
];

const schema: DatasetSchema = inferSchema(HEADER, ROWS);
const text = (s: DatasetSchema) => systemBlocks(s).map((b) => b.text).join('\n');

describe('the DatasetSchema the model is given', () => {
  it('carries a type, a confidence, a null count and statistics for every column', () => {
    const described = describeSchema(schema);
    expect(described).toContain('`home_team` — categorical');
    expect(described).toContain('10 distinct, most frequent:');
    expect(described).toMatch(/`attendance` — number.*min 4000, max 9137/);
    expect(described).toContain('0 nulls');
  });

  it('renders a date column as dates rather than epoch milliseconds', () => {
    expect(describeSchema(schema)).toMatch(/`date` — date.*min 1970-01-15, max 2001-06-01/);
  });

  it('carries no value ranked below the eight most frequent', () => {
    // Vanuatu is the eleventh row's team and appears once. It is a real cell of the Dataset and
    // the prompt must not contain it.
    expect(ROWS.some((r) => r[1] === 'Vanuatu')).toBe(true);
    expect(text(schema)).not.toContain('Vanuatu');
  });

  it('carries no raw row at all — only statistics', () => {
    const prompt = text(schema);
    for (const value of ['9137', '4107']) {
      // 9137 is the attendance of the Vanuatu row and is also the maximum, so it is allowed
      // exactly once, as the maximum. 4107 is an ordinary cell and must be absent.
      const occurrences = prompt.split(value).length - 1;
      expect(occurrences).toBe(value === '9137' ? 1 : 0);
    }
  });
});

describe('the request', () => {
  const req = { question: 'how many matches per team', schema, model: 'smart' as const };

  it('puts the cache breakpoint after the DatasetSchema and nowhere else', () => {
    const blocks = systemBlocks(schema);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.cache_control).toBeUndefined();
    expect(blocks[1]!.cache_control).toEqual({ type: 'ephemeral' });
    // The volatile part sits after the breakpoint, in messages, so the cached prefix is stable.
    expect(blocks[1]!.text).not.toContain('how many matches per team');
  });

  it('sends a byte-identical cached prefix for every Question in a session', () => {
    // Caching is a prefix match: one changed byte anywhere in tools + system invalidates it, and
    // the invalidators that bite are silent ones — a timestamp, a re-ordered tool list, a
    // question that leaked into the system prompt. This asserts the prefix rather than the
    // caching, because the caching itself cannot be observed without a key.
    const prefix = (question: string, repair?: TranslateRequest['repair']) => {
      const body = buildRequest({ ...req, question, repair });
      return JSON.stringify({ tools: body.tools, system: body.system });
    };
    const first = prefix('how many matches per team');
    expect(prefix('goals per year, as a line')).toBe(first);
    // A Repair adds turns to `messages`, which sit after the breakpoint. The prefix must not move.
    expect(
      prefix('how many matches per team', {
        attempt: {
          reply: null,
          failure: null,
          usage: { model: 'smart', recorded: false, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          input: {},
          echo: { id: 'toolu_1', name: 'submit_analysis', input: {} },
        },
        problem: { message: 'try again' },
      }),
    ).toBe(first);

    // The minimum cacheable prefix is roughly 1,024 tokens and a shorter one silently fails to
    // cache. At the conservative end of the usual ratio this is comfortably past it — but the
    // real check is `usage.cache_read_input_tokens > 0` against a live key, which is the reason
    // the readout shows that figure at all.
    expect(first.length / 4).toBeGreaterThan(1024);
  });

  it('caps the reply at 2,048 tokens and offers all three tools', () => {
    const body = buildRequest(req);
    expect(body.max_tokens).toBe(MAX_TOKENS);
    expect(MAX_TOKENS).toBe(2048);
    expect(body.tools?.map((t) => ('name' in t ? t.name : null))).toEqual([
      'submit_analysis',
      'ask_clarification',
      'report_unsupported',
    ]);
  });

  it('sends the previous spec and the last two exchanges on a refine, never the whole history', () => {
    const spec = (title: string): AnalysisSpec => ({
      title,
      narration: '',
      operation: {
        filters: [],
        groupBy: [],
        timeBucket: null,
        aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
        derived: [],
        sort: null,
        limit: null,
      },
      visualization: { type: 'bar', x: 'home_team', y: 'm', seriesBy: null },
    });
    const content = userMessages({
      question: 'make it a line',
      schema,
      refine: {
        spec: spec('current'),
        history: [
          { question: 'the oldest question', spec: spec('oldest') },
          { question: 'the middle question', spec: spec('middle') },
          { question: 'the newest question', spec: spec('newest') },
        ],
      },
    })[0]!.content as string;
    expect(content).not.toContain('the oldest question');
    expect(content).toContain('the middle question');
    expect(content).toContain('the newest question');
    expect(content).toContain('"title": "current"');
    expect(content.endsWith('Question: make it a line')).toBe(true);
  });

  it('appends the failed tool call and the violations as its result on a Repair', () => {
    const violations: SpecViolation[] = [
      { code: 'unknown-column', path: 'operation.groupBy[0]', message: 'Column `teem` does not exist. Available columns: home_team.' },
    ];
    const body = buildRequest({
      ...req,
      repair: {
        attempt: {
          reply: null,
          failure: null,
          usage: { model: 'smart', recorded: false, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          input: {},
          echo: { id: 'toolu_1', name: 'submit_analysis', input: { kind: 'analysis' } },
        },
        problem: { violations },
      },
    });
    const [assistant, result] = body.messages.slice(-2);
    expect(assistant!.role).toBe('assistant');
    expect((assistant!.content as { type: string; id: string }[])[0]).toMatchObject({
      type: 'tool_use',
      id: 'toolu_1',
    });
    const block = (result!.content as { tool_use_id: string; is_error: boolean; content: string }[])[0]!;
    expect(block.is_error).toBe(true);
    expect(block.tool_use_id).toBe('toolu_1');
    expect(block.content).toContain('Column `teem` does not exist');
  });

  it('carries a structural failure as plain text, because there is no tool call to echo', () => {
    const body = buildRequest({
      ...req,
      repair: {
        attempt: {
          reply: null,
          failure: { kind: 'max-tokens', message: 'ran out of room' },
          usage: { model: 'smart', recorded: false, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          input: undefined,
          echo: null,
        },
        problem: { message: 'ran out of room' },
      },
    });
    const last = body.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toContain('ran out of room');
  });
});

describe('the per-model request normalizer', () => {
  const body = { max_tokens: 100, messages: [] };

  it('gives Smart adaptive thinking at low effort and no sampling parameters', () => {
    const smart = normalize('smart', body);
    expect(smart.model).toBe('claude-sonnet-5');
    expect(smart.thinking).toEqual({ type: 'adaptive' });
    expect(smart.output_config).toEqual({ effort: 'low' });
    expect(smart).not.toHaveProperty('temperature');
    // `budget_tokens` is a 400 on this generation.
    expect(JSON.stringify(smart)).not.toContain('budget_tokens');
  });

  it('omits thinking and effort entirely on Fast, where both would error', () => {
    const fast = normalize('fast', body);
    expect(fast.model).toBe('claude-haiku-4-5');
    expect(fast).not.toHaveProperty('thinking');
    expect(fast).not.toHaveProperty('output_config');
  });
});

describe('cost', () => {
  const tokens = {
    inputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  };

  it('uses introductory pricing on Smart while it lasts, and list pricing after', () => {
    expect(costOf('smart', tokens, new Date('2026-08-31T12:00:00Z'))).toBeCloseTo(2, 6);
    expect(costOf('smart', tokens, new Date('2026-09-01T00:00:00Z'))).toBeCloseTo(3, 6);
    expect(MODELS.fast.intro).toBeUndefined();
    expect(costOf('fast', tokens, new Date('2026-09-01T00:00:00Z'))).toBeCloseTo(1, 6);
  });

  it('bills a cached input token at a tenth and a cache write at a quarter more', () => {
    const read = costOf('fast', { ...tokens, inputTokens: 0, cacheReadTokens: 1_000_000 });
    const write = costOf('fast', { ...tokens, inputTokens: 0, cacheWriteTokens: 1_000_000 });
    expect(read).toBeCloseTo(0.1, 6);
    expect(write).toBeCloseTo(1.25, 6);
  });
});
