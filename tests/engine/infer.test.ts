import { describe, expect, it } from 'vitest';
import { inferSchema, NULL_TOKENS } from '../../src/engine/infer';
import { isCategoryStats, isNumberStats } from '../../src/engine/types';

/** A deterministic rng so the sampled-inference tests are not flaky. */
const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const one = (name: string, values: string[], opts = {}) =>
  inferSchema([name], values.map((v) => [v]), { random: seeded(7), ...opts }).columns[0]!;

describe('the number-with-nulls rule', () => {
  it('types 19 integers and one NA as number, not categorical', () => {
    // 19/20 = 95%, exactly the threshold; the remainder is a recognised null token.
    const col = one('minute', [...Array.from({ length: 19 }, (_, i) => String(i + 1)), 'NA']);
    expect(col.type).toBe('number');
    expect(col.nullCount).toBe(1);
  });

  it('excludes the null tokens from the numeric stats', () => {
    // Hand-worked: 10, 30 and seventeen 20s sum to 380 over 19 values, so the mean is 20.
    // Divided by the 20 values the column actually holds it would be 19, which is the bug.
    const col = one('score', ['10', '30', ...Array.from({ length: 17 }, () => '20'), 'NA']);
    expect(isNumberStats(col.stats) && col.stats).toEqual({ min: 10, max: 30, mean: 20 });
  });

  it('falls through to categorical when a leftover value is not a null token', () => {
    const col = one('mixed', [...Array.from({ length: 19 }, (_, i) => String(i + 1)), 'unknown']);
    expect(col.type).toBe('categorical');
  });

  it('falls through to categorical below the 95% threshold even when every leftover is a null token', () => {
    // 18/20 = 90%. The rule is a threshold, and this is the branch below it.
    const col = one('sparse', [...Array.from({ length: 18 }, (_, i) => String(i + 1)), 'NA', 'NA']);
    expect(col.type).toBe('categorical');
  });

  it.each(NULL_TOKENS)('recognises %j as a null token', (token) => {
    const col = one('c', [...Array.from({ length: 19 }, (_, i) => String(i + 1)), token]);
    expect(col.type).toBe('number');
    expect(col.nullCount).toBe(1);
  });

  it('recognises null tokens irrespective of case', () => {
    const col = one('c', [...Array.from({ length: 19 }, (_, i) => String(i + 1)), 'n/A']);
    expect(col.type).toBe('number');
  });

  it('reports a confidence below 1 when nulls were present', () => {
    const clean = one('a', Array.from({ length: 20 }, (_, i) => String(i)));
    const dirty = one('b', [...Array.from({ length: 19 }, (_, i) => String(i)), 'NA']);
    expect(clean.confidence).toBe(1);
    expect(dirty.confidence).toBeCloseTo(0.95, 5);
  });
});

describe('boolean as a first-class ColumnType', () => {
  it('types TRUE/FALSE as boolean rather than two text categories', () => {
    const col = one('neutral', ['TRUE', 'FALSE', 'TRUE', 'TRUE', 'FALSE']);
    expect(col.type).toBe('boolean');
  });

  it('accepts mixed case and tolerates null tokens', () => {
    const col = one('penalty', ['true', 'False', 'TRUE', 'NA', 'false']);
    expect(col.type).toBe('boolean');
    expect(col.nullCount).toBe(1);
  });

  it('does not type 0/1 as boolean — those are numbers', () => {
    expect(one('flag', ['0', '1', '1', '0']).type).toBe('number');
  });

  it('does not type yes/no as boolean — that is two categories', () => {
    expect(one('answer', ['yes', 'no', 'yes']).type).toBe('categorical');
  });
});

describe('numeric formats', () => {
  it('reads thousands separators as numeric', () => {
    const col = one('attendance', ['1,234', '12,000', '999', '1,000,000']);
    expect(col.type).toBe('number');
    // Hand-worked: 1234 + 12000 + 999 + 1000000 = 1014233; / 4 = 253558.25
    expect(isNumberStats(col.stats) && col.stats.mean).toBeCloseTo(253558.25, 4);
  });

  it('rejects a comma in the wrong place rather than guessing', () => {
    expect(one('bad', ['1,23', '4,5', '6,7', '8,9']).type).toBe('categorical');
  });

  it('reads negatives, decimals and exponents', () => {
    const col = one('n', ['-1.5', '0.25', '2e3', '+7']);
    expect(col.type).toBe('number');
    expect(isNumberStats(col.stats) && col.stats.min).toBe(-1.5);
    expect(isNumberStats(col.stats) && col.stats.max).toBe(2000);
  });
});

describe('dates', () => {
  it('types ISO dates as date and carries the full observed range', () => {
    const col = one('date', ['1872-11-30', '1950-06-24', '2026-07-19']);
    expect(col.type).toBe('date');
    expect(isNumberStats(col.stats) && col.stats.min).toBe(Date.UTC(1872, 10, 30));
    expect(isNumberStats(col.stats) && col.stats.max).toBe(Date.UTC(2026, 6, 19));
  });

  it('reads a day-first slash format once the sample disambiguates it', () => {
    // 25 in the first position cannot be a month, so the whole column is day-first.
    const col = one('d', ['25/12/2024', '03/04/2024', '01/01/2020']);
    expect(col.type).toBe('date');
    expect(isNumberStats(col.stats) && col.stats.min).toBe(Date.UTC(2020, 0, 1));
    expect(isNumberStats(col.stats) && col.stats.max).toBe(Date.UTC(2024, 11, 25));
  });

  it('reads a month-first slash format once the sample disambiguates it', () => {
    const col = one('d', ['12/25/2024', '04/03/2024', '01/01/2020']);
    expect(col.type).toBe('date');
    expect(isNumberStats(col.stats) && col.stats.max).toBe(Date.UTC(2024, 11, 25));
  });

  it('does not read a bare year as a date', () => {
    expect(one('season', ['1998', '2002', '2006']).type).toBe('number');
  });
});

describe('categorical columns', () => {
  it('counts distinct values and reports the most frequent first', () => {
    const col = one('team', ['Brazil', 'Brazil', 'Peru', 'Brazil', 'Chile', 'Peru']);
    expect(col.type).toBe('categorical');
    expect(isCategoryStats(col.stats) && col.stats.distinct).toBe(3);
    expect(isCategoryStats(col.stats) && col.stats.top[0]).toEqual({ value: 'Brazil', count: 3 });
  });

  it('carries at most the eight most frequent values, which is what the prompt budget allows', () => {
    const values = Array.from({ length: 40 }, (_, i) => `v${i % 20}`);
    const col = one('c', values);
    expect(isCategoryStats(col.stats) && col.stats.top).toHaveLength(8);
  });

  it('holds non-ASCII values intact', () => {
    const col = one('team', ['Curaçao', 'Réunion', 'Ryūkyū', 'Székely Land', 'Găgăuzia']);
    expect(isCategoryStats(col.stats) && col.stats.top.map((t) => t.value)).toContain('Ryūkyū');
  });

  it('counts null tokens as nulls, not as a category', () => {
    const col = one('c', ['a', 'b', '', 'NA', 'a']);
    expect(col.nullCount).toBe(2);
    expect(isCategoryStats(col.stats) && col.stats.distinct).toBe(2);
  });
});

describe('sampled inference', () => {
  /** 5,000 rows: numeric for the first 4,900, then free text. The first-100 heuristic the
      spec forbids types this number; the specified sampler must not. */
  const lateDirty = Array.from({ length: 5000 }, (_, i) =>
    i < 4900 ? [String(i)] : [`comment ${i}`],
  );

  it('catches a column that turns dirty late in the file', () => {
    const col = inferSchema(['c'], lateDirty, { random: seeded(3) }).columns[0]!;
    expect(col.type).toBe('categorical');
  });

  it('would have been fooled by the first 100 rows alone, which is why it does not use them', () => {
    const first100 = inferSchema(['c'], lateDirty.slice(0, 100), { random: seeded(3) }).columns[0]!;
    expect(first100.type).toBe('number');
  });

  it('samples the head plus a random tail rather than the head alone', () => {
    const drawn: number[] = [];
    inferSchema(['c'], lateDirty, {
      headN: 10,
      randomN: 10,
      random: () => {
        drawn.push(1);
        return 0.99;
      },
    });
    expect(drawn.length).toBeGreaterThan(0);
  });

  it('reads every row when the file is smaller than the sample budget', () => {
    const col = inferSchema(['c'], [['1'], ['2'], ['x']], { random: seeded(1) }).columns[0]!;
    expect(col.type).toBe('categorical');
  });
});

describe('the whole schema', () => {
  it('types every column of the hero Dataset shape', () => {
    const header = ['date', 'home_team', 'home_score', 'neutral'];
    const rows = [
      ['1872-11-30', 'Scotland', '0', 'FALSE'],
      ['1873-03-08', 'England', '4', 'FALSE'],
      ['2026-07-19', 'Brazil', '2', 'TRUE'],
    ];
    expect(inferSchema(header, rows, { random: seeded(5) }).columns.map((c) => c.type)).toEqual([
      'date',
      'categorical',
      'number',
      'boolean',
    ]);
  });

  it('types an entirely empty column as categorical with every row null', () => {
    const col = one('empty', ['', '', '']);
    expect(col.type).toBe('categorical');
    expect(col.nullCount).toBe(3);
  });
});
