/** The three sample Questions: what is sent, and what is read back.

    The claim worth a test is the cheap one — that this call shares the cached prefix with a real
    Question rather than adding a second one. The prefix is hashed over `tools` and `system`, so
    those two have to be identical between the two requests, and a well-meant edit to either
    builder is exactly how that would silently stop being true. */
import { describe, expect, it } from 'vitest';
import { buildRequest, buildSuggestRequest, parseQuestions } from '../../src/ai/anthropic';
import type { DatasetSchema } from '../../src/engine/types';

const schema: DatasetSchema = {
  columns: [
    { name: 'date', type: 'date', confidence: 1, nullCount: 0, stats: null },
    { name: 'home_team', type: 'categorical', confidence: 1, nullCount: 0, stats: null },
    { name: 'home_score', type: 'number', confidence: 1, nullCount: 0, stats: null },
  ],
};

describe('the request', () => {
  it('sends the same tools and system blocks a Question does, so the cached prefix is shared', () => {
    const ask = buildRequest({ question: 'Which teams host most?', schema, model: 'smart' });
    const suggest = buildSuggestRequest(schema, 'smart');
    expect(suggest.system).toEqual(ask.system);
    expect(suggest.tools).toEqual(ask.tools);
    // Same model, too: a prompt cache is per-model, so proposing on the cheaper one would warm
    // nothing for the Question that follows.
    expect(suggest.model).toBe(ask.model);
  });

  it('forbids the tool call it is deliberately still carrying the tools for', () => {
    expect(buildSuggestRequest(schema, 'fast').tool_choice).toEqual({ type: 'none' });
  });
});

describe('the reply', () => {
  it('keeps the questions and drops everything around them', () => {
    expect(
      parseQuestions(
        [
          'Here are three questions:',
          '1. Which tournament has the most matches?',
          '- How many matches were played each year?',
          '  "What is the average home score by country?"  ',
          'Let me know if you want more.',
        ].join('\n'),
      ),
    ).toEqual([
      'Which tournament has the most matches?',
      'How many matches were played each year?',
      'What is the average home score by country?',
    ]);
  });

  it('takes three at most, and nothing when the reply is prose', () => {
    const four = Array.from({ length: 4 }, (_, i) => `Question ${i}?`).join('\n');
    expect(parseQuestions(four)).toHaveLength(3);
    expect(parseQuestions('I cannot propose questions for this dataset.')).toEqual([]);
  });
});
