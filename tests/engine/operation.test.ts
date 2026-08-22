import { describe, expect, it } from 'vitest';
import { buildColumnStore } from '../../src/engine/columnStore';
import { inferSchema } from '../../src/engine/infer';
import { executeOperation, FOLD_LABEL, FOLD_TOP_N } from '../../src/engine/operation';
import type { ColumnType } from '../../src/engine/types';
import type { Operation } from '../../src/spec/grammar';
import { referenceAggregate, type Obj } from './reference';

const agg = (id: string, fn: Operation['aggregations'][number]['fn'], column: string | null) => ({
  id,
  fn,
  column,
  label: `${fn} of ${column ?? 'rows'}`,
});

const op = (over: Partial<Operation> = {}): Operation => ({
  filters: [],
  groupBy: [],
  timeBucket: null,
  aggregations: [agg('m', 'count', null)],
  derived: [],
  sort: null,
  limit: null,
  ...over,
});

/** Builds a store with the ColumnTypes stated, because these tests are about the Operation and
    not about inference: a five-row fixture falls under the 95% numeric threshold, so `goals`
    would infer categorical and every numeric assertion below would be testing the wrong thing.
    Inference has its own tests. */
const store = (
  header: string[],
  rows: string[][],
  types: Partial<Record<string, ColumnType>> = {},
) =>
  buildColumnStore(header, rows, {
    columns: inferSchema(header, rows).columns.map((c) =>
      types[c.name] ? { ...c, type: types[c.name]! } : c,
    ),
  });

/** The hero Dataset's shape, small enough to work out by hand. */
const HEADER = ['date', 'team', 'goals', 'neutral'];
const ROWS: string[][] = [
  ['2020-01-01', 'Brazil', '3', 'FALSE'],
  ['2020-02-01', 'Brazil', '1', 'TRUE'],
  ['2020-03-01', 'Peru', '0', 'FALSE'],
  ['2021-01-01', 'Peru', '4', 'TRUE'],
  ['2021-02-01', 'Chile', 'NA', 'FALSE'],
];
const hero = () => store(HEADER, ROWS, { goals: 'number' });

describe('aggregating without a group', () => {
  it('counts every row that survived the filters', () => {
    const r = executeOperation(hero(), op());
    expect(r.rows).toEqual([{ m: 5 }]);
  });

  it('sums a numeric column and leaves the nulls out', () => {
    // Hand-worked: 3 + 1 + 0 + 4 = 8. The fifth row's goals is the literal NA.
    const r = executeOperation(hero(), op({ aggregations: [agg('m', 'sum', 'goals')] }));
    expect(r.rows[0]!.m).toBe(8);
    expect(r.summary.nullExcluded).toBe(1);
  });

  it('averages over the rows that had a value, not over every row', () => {
    // 8 over 4 values is 2. Over all five rows it would be 1.6, which is the bug.
    const r = executeOperation(hero(), op({ aggregations: [agg('m', 'avg', 'goals')] }));
    expect(r.rows[0]!.m).toBe(2);
  });

  it('takes the median of an even count as the mean of the middle two', () => {
    // Sorted: 0, 1, 3, 4 — the median is 2.
    const r = executeOperation(hero(), op({ aggregations: [agg('m', 'median', 'goals')] }));
    expect(r.rows[0]!.m).toBe(2);
  });

  it('counts distinct values', () => {
    const r = executeOperation(hero(), op({ aggregations: [agg('m', 'countDistinct', 'team')] }));
    expect(r.rows[0]!.m).toBe(3);
  });

  it('takes the min and max of a column', () => {
    const r = executeOperation(
      hero(),
      op({ aggregations: [agg('lo', 'min', 'goals'), agg('hi', 'max', 'goals')] }),
    );
    expect(r.rows[0]).toMatchObject({ lo: 0, hi: 4 });
  });

  it('reports a rate as the share of true values in a boolean column', () => {
    // Two of five rows are TRUE, so the rate is 0.4.
    const r = executeOperation(hero(), op({ aggregations: [agg('m', 'rate', 'neutral')] }));
    expect(r.rows[0]!.m).toBe(0.4);
  });

  it('reports null rather than zero when a group has no values to aggregate', () => {
    const empty = store(['n'], [['NA'], ['NA']], { n: 'number' });
    const r = executeOperation(empty, op({ aggregations: [agg('m', 'sum', 'n')] }));
    expect(r.rows[0]!.m).toBeNull();
  });
});

describe('grouping', () => {
  it('produces one row per distinct value of the grouping column', () => {
    const r = executeOperation(hero(), op({ groupBy: ['team'] }));
    expect(r.rows).toHaveLength(3);
    expect(r.rows.find((x) => x.team === 'Brazil')!.m).toBe(2);
  });

  it('groups by two columns as a pair', () => {
    const r = executeOperation(hero(), op({ groupBy: ['team', 'neutral'] }));
    expect(r.rows).toHaveLength(5);
    expect(r.fields.filter((f) => f.role === 'dimension').map((f) => f.name)).toEqual([
      'team',
      'neutral',
    ]);
  });

  it('reports a boolean group as TRUE and FALSE rather than 1 and 0', () => {
    const r = executeOperation(hero(), op({ groupBy: ['neutral'] }));
    expect(r.rows.map((x) => x.neutral).sort()).toEqual(['FALSE', 'TRUE']);
  });

  it('keeps a null group rather than dropping the rows', () => {
    const s = store(['k', 'n'], [['a', '1'], ['', '2'], ['a', '3']], { n: 'number' });
    const r = executeOperation(s, op({ groupBy: ['k'] }));
    expect(r.rows).toHaveLength(2);
    expect(r.rows.some((x) => x.k === null)).toBe(true);
  });
});

describe('filters', () => {
  const filtered = (filters: Operation['filters']) =>
    executeOperation(hero(), op({ filters })).rows[0]!.m;

  it('keeps only equal values', () => {
    expect(filtered([{ op: 'eq', column: 'team', value: 'Brazil' }])).toBe(2);
  });

  it('excludes equal values on neq', () => {
    expect(filtered([{ op: 'neq', column: 'team', value: 'Brazil' }])).toBe(3);
  });

  it('compares numbers on the ordering operators', () => {
    expect(filtered([{ op: 'gt', column: 'goals', value: 1 }])).toBe(2);
    expect(filtered([{ op: 'gte', column: 'goals', value: 1 }])).toBe(3);
    expect(filtered([{ op: 'lt', column: 'goals', value: 1 }])).toBe(1);
    expect(filtered([{ op: 'lte', column: 'goals', value: 3 }])).toBe(3);
  });

  it('keeps any of a set on in', () => {
    expect(filtered([{ op: 'in', column: 'team', values: ['Peru', 'Chile'] }])).toBe(3);
  });

  it('keeps an inclusive numeric range on between', () => {
    expect(filtered([{ op: 'between', column: 'goals', from: 1, to: 3 }])).toBe(2);
  });

  it('keeps an inclusive date range on dateRange', () => {
    expect(
      filtered([{ op: 'dateRange', column: 'date', from: '2020-02-01', to: '2021-01-01' }]),
    ).toBe(3);
  });

  it('selects the nulls, and their complement', () => {
    expect(filtered([{ op: 'isNull', column: 'goals' }])).toBe(1);
    expect(filtered([{ op: 'isNotNull', column: 'goals' }])).toBe(4);
  });

  it('compares a boolean filter against TRUE and FALSE', () => {
    expect(filtered([{ op: 'eq', column: 'neutral', value: true }])).toBe(2);
    expect(filtered([{ op: 'eq', column: 'neutral', value: 'FALSE' }])).toBe(3);
  });

  it('combines filters with AND, which is the only combinator the grammar has', () => {
    expect(
      filtered([
        { op: 'eq', column: 'team', value: 'Peru' },
        { op: 'gt', column: 'goals', value: 1 },
      ]),
    ).toBe(1);
  });

  it('excludes a null from every comparison, so a null is never greater or less than anything', () => {
    const r = executeOperation(hero(), op({ filters: [{ op: 'gt', column: 'goals', value: -1 }] }));
    expect(r.rows[0]!.m).toBe(4);
  });
});

describe('the derived ratio', () => {
  it('divides one aggregation by another', () => {
    // Hand-worked: sum of goals is 8, count is 5, so goals per match is 1.6.
    const r = executeOperation(
      hero(),
      op({
        aggregations: [agg('g', 'sum', 'goals'), agg('n', 'count', null)],
        derived: [{ id: 'per', label: 'goals per match', numerator: 'g', denominator: 'n' }],
      }),
    );
    expect(r.rows[0]!.per).toBe(1.6);
    expect(r.fields.map((f) => f.name)).toContain('per');
  });

  it('reports null rather than infinity when the denominator is zero', () => {
    const s = store(['n'], [['0'], ['0']], { n: 'number' });
    const r = executeOperation(
      s,
      op({
        aggregations: [agg('a', 'sum', 'n'), agg('b', 'sum', 'n')],
        derived: [{ id: 'per', label: 'ratio', numerator: 'a', denominator: 'b' }],
      }),
    );
    expect(r.rows[0]!.per).toBeNull();
  });
});

describe('sort and limit', () => {
  it('sorts by a measure descending', () => {
    const r = executeOperation(
      hero(),
      op({ groupBy: ['team'], sort: { by: 'm', dir: 'desc' } }),
    );
    expect(r.rows.map((x) => x.m)).toEqual([2, 2, 1]);
  });

  it('sorts by a dimension with locale-correct ordering', () => {
    const s = store(
      ['t'],
      [['Cyprus'], ['Curaçao'], ['Zambia']].flatMap((r) => [r, r]),
    );
    const r = executeOperation(s, op({ groupBy: ['t'], sort: { by: 't', dir: 'asc' } }));
    expect(r.rows.map((x) => x.t)).toEqual(['Curaçao', 'Cyprus', 'Zambia']);
  });

  it('keeps only the first rows once limited', () => {
    const r = executeOperation(
      hero(),
      op({ groupBy: ['team'], sort: { by: 'm', dir: 'desc' }, limit: 1 }),
    );
    expect(r.rows).toHaveLength(1);
  });

  it('sorts nulls last whichever direction is asked for', () => {
    const s = store(
      ['k', 'n'],
      [
        ['a', '5'],
        ['b', 'NA'],
        ['c', '1'],
        ...Array.from({ length: 17 }, () => ['d', '3'] as string[]),
      ],
      { n: 'number' },
    );
    const asc = executeOperation(
      s,
      op({ groupBy: ['k'], aggregations: [agg('m', 'sum', 'n')], sort: { by: 'm', dir: 'asc' } }),
    );
    expect(asc.rows.at(-1)!.k).toBe('b');
  });
});

describe('the cardinality fold', () => {
  /** `city` has 2,092 distinct values and "matches by city" is a natural first Question. This
      fires on day one; it is not theoretical. */
  const many = store(
    ['city'],
    Array.from({ length: 300 }, (_, i) => [`city-${i % 40}`]),
  );

  it('keeps the top fifteen by metric and folds the rest into one row', () => {
    const r = executeOperation(many, op({ groupBy: ['city'], sort: { by: 'm', dir: 'desc' } }));
    expect(FOLD_TOP_N).toBe(15);
    expect(r.rows).toHaveLength(16);
    expect(r.rows.at(-1)!.city).toBe(FOLD_LABEL);
  });

  it('puts the folded groups total into the folded row rather than discarding it', () => {
    // 300 rows over 40 cities: 20 cities appear 8 times and 20 appear 7. Sorted descending, the
    // top 15 are eights, so 120 rows are shown and 180 fold.
    const r = executeOperation(many, op({ groupBy: ['city'], sort: { by: 'm', dir: 'desc' } }));
    const shown = r.rows.slice(0, 15).reduce((a, x) => a + (x.m as number), 0);
    expect(shown).toBe(120);
    expect(r.rows.at(-1)!.m).toBe(180);
  });

  it('names what it folded in the summary', () => {
    const r = executeOperation(many, op({ groupBy: ['city'], sort: { by: 'm', dir: 'desc' } }));
    expect(r.summary).toMatchObject({ totalGroups: 40, foldedCount: 25, groupCount: 16 });
  });

  it('folds nothing when the groups fit', () => {
    const r = executeOperation(hero(), op({ groupBy: ['team'] }));
    expect(r.rows.some((x) => x.team === FOLD_LABEL)).toBe(false);
    expect(r.summary.foldedCount).toBe(0);
  });

  it('honours an explicit limit instead of folding, because the model asked for a top-N', () => {
    const r = executeOperation(
      many,
      op({ groupBy: ['city'], sort: { by: 'm', dir: 'desc' }, limit: 5 }),
    );
    expect(r.rows).toHaveLength(5);
    expect(r.rows.some((x) => x.city === FOLD_LABEL)).toBe(false);
  });

  it('folds an average over the pooled rows, not by averaging the group averages', () => {
    const s = store(
      ['k', 'n'],
      [
        ...Array.from({ length: FOLD_TOP_N }, (_, i) => [`k${i}`, '10']),
        // Two folded groups, one row of 0 and three rows of 4: pooled mean 3, not 2.
        ['z1', '0'],
        ['z2', '4'],
        ['z2', '4'],
        ['z2', '4'],
      ],
    );
    const r = executeOperation(
      s,
      op({ groupBy: ['k'], aggregations: [agg('m', 'avg', 'n')], sort: { by: 'm', dir: 'desc' } }),
    );
    expect(r.rows).toHaveLength(FOLD_TOP_N + 1);
    expect(r.rows.at(-1)).toEqual({ k: FOLD_LABEL, m: 3 });
  });
});

describe('against the naive reference implementation', () => {
  /** Rows as plain objects, aggregated the obvious way. Any disagreement is a real defect in
      one of the two, and the reference is the one that is obviously right. */
  const objects: Obj[] = Array.from({ length: 400 }, (_, i) => ({
    team: `t${i % 7}`,
    region: `r${i % 3}`,
    goals: i % 11 === 0 ? null : (i % 9) - 2,
    neutral: i % 2 === 0,
  }));
  const csv = [
    ['team', 'region', 'goals', 'neutral'],
    ...objects.map((o) => [
      String(o.team),
      String(o.region),
      o.goals === null ? 'NA' : String(o.goals),
      o.neutral ? 'TRUE' : 'FALSE',
    ]),
  ];
  const s = store(csv[0]!, csv.slice(1), { goals: 'number' });

  /** An explicit limit above the group count, so the cardinality fold — which the reference
      deliberately does not implement — stays out of the comparison. It has its own tests. */
  const unfolded = (over: Partial<Operation>) => op({ limit: 1000, ...over });

  const cases: Operation[] = [
    unfolded({ groupBy: ['team'], aggregations: [agg('m', 'sum', 'goals')] }),
    unfolded({ groupBy: ['team'], aggregations: [agg('m', 'avg', 'goals')] }),
    unfolded({ groupBy: ['region'], aggregations: [agg('m', 'median', 'goals')] }),
    unfolded({
      groupBy: ['region'],
      aggregations: [agg('m', 'min', 'goals'), agg('x', 'max', 'goals')],
    }),
    unfolded({ groupBy: ['team', 'region'], aggregations: [agg('m', 'count', null)] }),
    unfolded({ groupBy: ['region'], aggregations: [agg('m', 'countDistinct', 'goals')] }),
    unfolded({
      groupBy: ['team'],
      filters: [{ op: 'gt', column: 'goals', value: 0 }],
      aggregations: [agg('m', 'sum', 'goals')],
    }),
    unfolded({
      groupBy: ['region'],
      filters: [{ op: 'in', column: 'team', values: ['t0', 't1', 't2'] }],
      aggregations: [agg('m', 'avg', 'goals')],
    }),
    unfolded({
      groupBy: ['team'],
      filters: [{ op: 'isNotNull', column: 'goals' }],
      aggregations: [agg('m', 'count', null)],
    }),
  ];

  it.each(cases.map((c, i) => [i, c] as const))('agrees on case %i', (_i, operation) => {
    const mine = executeOperation(s, operation).rows;
    const theirs = referenceAggregate(objects, operation);
    const key = (r: Record<string, unknown>) => operation.groupBy.map((g) => r[g]).join('|');
    const byKey = new Map(theirs.map((r) => [key(r), r]));
    expect(mine).toHaveLength(theirs.length);
    for (const row of mine) {
      const expected = byKey.get(key(row))!;
      expect(expected, `no reference group for ${key(row)}`).toBeDefined();
      for (const a of operation.aggregations) {
        expect(row[a.id], `${key(row)} ${a.id}`).toBe(expected[a.id]);
      }
    }
  });
});

describe('the result fields', () => {
  it('names the dimensions and the measures, and marks which is which', () => {
    const r = executeOperation(
      hero(),
      op({ groupBy: ['team'], aggregations: [agg('m', 'sum', 'goals')] }),
    );
    expect(r.fields).toEqual([
      { name: 'team', label: 'team', role: 'dimension', type: 'categorical' },
      { name: 'm', label: 'sum of goals', role: 'measure', type: 'number' },
    ]);
  });

  it('counts the rows the filters kept and the rows the Dataset holds', () => {
    const r = executeOperation(
      hero(),
      op({ filters: [{ op: 'eq', column: 'team', value: 'Brazil' }] }),
    );
    expect(r.summary).toMatchObject({ rowsMatched: 2, rowsTotal: 5 });
  });
});
