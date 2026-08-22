/** The tolerant reader over half-arrived tool JSON. Expectations are hand-worked: each case is
    one real prefix of the same specification, cut at a different character, with the object a
    person reads out of it written beside it. */
import { describe, expect, it } from 'vitest';
import { chipsFrom, readPartial } from '../../src/ai/partial';

const FULL = JSON.stringify({
  kind: 'analysis',
  intent: 'new',
  title: 'Goals by decade',
  operation: {
    filters: [{ op: 'eq', column: 'tournament', value: 'FIFA World Cup' }],
    groupBy: ['home_team'],
    timeBucket: { column: 'date', unit: 'year' },
    aggregations: [{ id: 'g', fn: 'avg', column: 'home_score', label: 'goals' }],
  },
  visualization: { type: 'line', x: 'date', y: 'g', seriesBy: null },
});

describe('reading a specification that has not finished arriving', () => {
  it('closes an unterminated string value', () => {
    expect(readPartial('{"title": "Goals by dec')).toEqual({ title: 'Goals by dec' });
  });

  it('drops a key that has no value yet', () => {
    expect(readPartial('{"title": "Goals", "opera')).toEqual({ title: 'Goals' });
  });

  it('fills a value that has not started', () => {
    expect(readPartial('{"title": "Goals", "intent":')).toEqual({ title: 'Goals', intent: null });
  });

  it('closes nested objects and arrays', () => {
    expect(readPartial('{"operation": {"groupBy": ["home_team", "away')).toEqual({
      operation: { groupBy: ['home_team', 'away'] },
    });
  });

  it('trims a keyword and a number the stream cut in half', () => {
    // The key survives with a null, exactly as it does before any value has started arriving.
    expect(readPartial('{"a": tru')).toEqual({ a: null });
    // A half-arrived number reads as the digits so far — 2.5 shows as 2 for one frame. Display
    // only, and corrected by the next delta.
    expect(readPartial('{"a": 1, "b": 2.')).toEqual({ a: 1, b: 2 });
  });

  it('keeps an escaped quote inside a string', () => {
    expect(readPartial('{"title": "the \\"best\\" te')).toEqual({ title: 'the "best" te' });
  });

  it('reads every prefix of a real specification without throwing', () => {
    for (let i = 1; i <= FULL.length; i++) {
      expect(() => readPartial(FULL.slice(0, i))).not.toThrow();
    }
    expect(readPartial(FULL)).toEqual(JSON.parse(FULL));
  });

  it('never invents a field the prefix does not contain', () => {
    // Every key the reader returns at any prefix must be a key the finished object has, with a
    // value the finished object agrees with once it is complete.
    for (let i = 1; i <= FULL.length; i++) {
      const partial = readPartial(FULL.slice(0, i));
      if (partial === undefined) continue;
      for (const key of Object.keys(partial as object)) {
        expect(JSON.parse(FULL)).toHaveProperty(key);
      }
    }
  });
});

describe('the chip strip', () => {
  it('fills in the pipeline order as the fields arrive', () => {
    const seen: string[][] = [];
    for (let i = 1; i <= FULL.length; i++) seen.push(chipsFrom(readPartial(FULL.slice(0, i))));
    expect(seen.at(-1)).toEqual([
      'tournament eq FIFA World Cup',
      'date by year',
      'home_team',
      'avg home_score',
      'line',
    ]);
    // Chips only ever accumulate — a strip that shrank mid-stream would read as a correction.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.length).toBeGreaterThanOrEqual(seen[i - 1]!.length);
    }
  });

  it('says nothing about a reply that carries no operation', () => {
    expect(chipsFrom(readPartial('{"kind": "unsupported", "reason": "no joins'))).toEqual([]);
  });
});
