/** The statistics every published number passes through, and the byte count beside them.

    Neither is the DataEngine, but both are pure and both are read in Node, and a wrong median
    would corrupt every figure in the README silently rather than loudly. */
import { describe, expect, it } from 'vitest';
import { buildColumnStore, storeBytes } from '../../src/engine/columnStore';
import { inferSchema } from '../../src/engine/infer';
import { stat, summarise } from '../../src/bench/stats';

describe('the median of a set of runs', () => {
  it('takes the middle value of an odd number of runs', () => {
    // Deliberately unsorted: the runs arrive in the order they ran.
    expect(stat([9, 1, 5])).toEqual({ n: 3, median: 5, min: 1, max: 9 });
  });

  it('averages the two middle values of an even number of runs', () => {
    expect(stat([1, 2, 3, 10])).toEqual({ n: 4, median: 2.5, min: 1, max: 10 });
  });

  /** The reason the median is the figure at all: one GC pause in nine runs moves a mean by tens
      of milliseconds and leaves the median where it was. */
  it('is not moved by a single outlying run, where a mean would be', () => {
    const clean = [10, 10, 10, 10, 11];
    const stalled = [10, 10, 10, 10, 400];
    expect(stat(stalled).median).toBe(stat(clean).median);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(stalled) - mean(clean)).toBeGreaterThan(70);
  });

  it('keeps the phases in the order they ran, one stat each', () => {
    const runs = [
      { phases: [['parse', 10] as [string, number], ['aggregate', 2] as [string, number]], rows: 1, groups: 1, bytes: null },
      { phases: [['parse', 20] as [string, number], ['aggregate', 4] as [string, number]], rows: 1, groups: 1, bytes: null },
    ];
    expect(summarise(runs).map((p) => [p.phase, p.stat.median])).toEqual([
      ['parse', 15],
      ['aggregate', 3],
    ]);
  });
});

describe('the bytes a ColumnStore occupies', () => {
  const HEADER = ['n', 'team'];
  const rows = Array.from({ length: 100 }, (_, i) => [String(i), i % 2 ? 'Brazil' : 'Peru']);

  it('counts the typed arrays and the dictionary, and nothing it cannot see', () => {
    const schema = inferSchema(HEADER, rows);
    const store = buildColumnStore(HEADER, rows, {
      columns: schema.columns.map((c) => (c.name === 'n' ? { ...c, type: 'number' as const } : c)),
    });
    // 100 float64s, 100 int32 codes, and two dictionary strings of 16 + 2·len each.
    const strings = 16 + 'Brazil'.length * 2 + (16 + 'Peru'.length * 2);
    expect(storeBytes(store)).toBe(100 * 8 + 100 * 4 + strings);
  });

  /** The whole reason the encoding exists: the same column of repeated values costs a code per
      row and one copy of each distinct string, so widening the Dataset does not widen the text. */
  it('charges a dictionary column one copy of each distinct value, however many rows repeat it', () => {
    const many = Array.from({ length: 1_000 }, (_, i) => [String(i), i % 2 ? 'Brazil' : 'Peru']);
    const build = (r: string[][]) => {
      const schema = inferSchema(HEADER, r);
      return buildColumnStore(HEADER, r, {
        columns: schema.columns.map((c) => (c.name === 'n' ? { ...c, type: 'number' as const } : c)),
      });
    };
    const small = storeBytes(build(rows));
    const large = storeBytes(build(many));
    // Ten times the rows, and the growth is codes and numbers only: 900 × (8 + 4).
    expect(large - small).toBe(900 * 12);
  });
});
