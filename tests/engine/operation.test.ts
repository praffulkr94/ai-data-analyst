import { describe, expect, it } from 'vitest';
import { buildColumnStore } from '../../src/engine/columnStore';
import { inferSchema } from '../../src/engine/infer';
import {
  CHART_BUDGET,
  executeOperation,
  FOLD_LABEL,
  FOLD_TOP_N,
  POINT_CAP,
  SCATTER_SERIES_BUDGET,
  SERIES_BUDGET,
} from '../../src/engine/operation';
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
    expect(r.summary).toMatchObject({
      totalGroups: 40,
      groupCount: 16,
      fold: { dimensionLabel: 'city', kept: 15, folded: 25 },
    });
  });

  it('folds nothing when the groups fit', () => {
    const r = executeOperation(hero(), op({ groupBy: ['team'] }));
    expect(r.rows.some((x) => x.team === FOLD_LABEL)).toBe(false);
    expect(r.summary.fold).toBeNull();
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

describe('the extreme in the summary', () => {
  it('names the largest real group, never the fold', () => {
    const s = store(
      ['k'],
      [
        // One dominant group, then twenty small ones whose pooled total beats it.
        ...Array.from({ length: 30 }, () => ['big']),
        ...Array.from({ length: 20 }, (_, i) => [`s${i}`]).flatMap((r) =>
          Array.from({ length: 5 }, () => r),
        ),
      ],
    );
    const r = executeOperation(s, op({ groupBy: ['k'], sort: { by: 'm', dir: 'desc' } }));
    // The Other row holds 30 rows, which exceeds `big`'s 30 only if it were counted — it is not.
    expect(r.rows.at(-1)!.k).toBe(FOLD_LABEL);
    expect(r.summary.extreme).toEqual({ label: 'big', value: 30 });
  });

  it('names the largest group when nothing folded', () => {
    const r = executeOperation(hero(), op({ groupBy: ['team'], sort: { by: 'm', dir: 'desc' } }));
    expect(r.summary.extreme).toEqual({ label: 'Brazil', value: 2 });
  });

  it('has no extreme to name when the result is empty', () => {
    const r = executeOperation(
      hero(),
      op({ groupBy: ['team'], filters: [{ op: 'eq', column: 'team', value: 'Nowhere' }] }),
    );
    expect(r.summary.extreme).toBeNull();
  });
});

describe('the temporal dimension is never folded', () => {
  /** 40 years, one match each. Folded to the top fifteen this would answer "which fifteen years
      had the most matches" — a question nobody asked — and a line chart of it would be a
      scribble. The point cap is what bounds a time axis. */
  const yearly = store(
    ['date'],
    Array.from({ length: 40 }, (_, i) => [`${1980 + i}-06-15`]),
  );
  const byYear = op({ timeBucket: { column: 'date', unit: 'year' } });

  it('keeps every bucket, past the fifteen an axis of categories would fold at', () => {
    const r = executeOperation(yearly, byYear);
    expect(r.rows).toHaveLength(40);
    expect(r.summary.fold).toBeNull();
    expect(r.rows.some((x) => x.date === FOLD_LABEL)).toBe(false);
  });

  it('lays a temporal result out left to right when the spec asks for no sort', () => {
    const r = executeOperation(yearly, byYear);
    const dates = r.rows.map((x) => x.date as number);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect(new Date(dates[0]!).toISOString()).toBe('1980-01-01T00:00:00.000Z');
  });

  it('still obeys a sort the spec did ask for', () => {
    const r = executeOperation(yearly, { ...byYear, sort: { by: 'date', dir: 'desc' } });
    expect(new Date(r.rows[0]!.date as number).toISOString()).toBe('2019-01-01T00:00:00.000Z');
  });

  it('folds the categorical dimension of a two-dimension result, not the temporal one', () => {
    // 20 teams over three years: past the fifteen an axis of categories folds at.
    const both = store(
      ['date', 'team'],
      Array.from({ length: 60 }, (_, i) => [`${2000 + (i % 3)}-06-15`, `t${i % 20}`]),
    );
    const r = executeOperation(
      both,
      op({ timeBucket: { column: 'date', unit: 'year' }, groupBy: ['team'] }),
    );
    expect(r.summary.fold).toMatchObject({ dimensionLabel: 'team', kept: FOLD_TOP_N, folded: 5 });
    expect(new Set(r.rows.map((x) => x.date)).size).toBe(3);
  });
});

describe('the Series budget', () => {
  /** Ten teams over three years. Six palette slots exist and are never cycled, so five Series
      are kept and the rest become one. */
  const many = store(
    ['date', 'team'],
    Array.from({ length: 30 }, (_, i) => [`${2000 + (i % 3)}-06-15`, `t${i % 10}`]),
  );
  const spec = op({ timeBucket: { column: 'date', unit: 'year' }, groupBy: ['team'] });
  const withSeries = (o = spec) => executeOperation(many, o, { seriesBy: 'team' });

  it('keeps one Series fewer than the budget and folds the rest into one', () => {
    const r = withSeries();
    expect(SERIES_BUDGET).toBe(6);
    const series = new Set(r.rows.map((x) => x.team));
    expect(series.size).toBe(SERIES_BUDGET);
    expect(series.has(FOLD_LABEL)).toBe(true);
    expect(r.summary.fold).toMatchObject({ dimensionLabel: 'team', kept: 5, folded: 5 });
  });

  it('folds the Series to one row per x, not to one row in total', () => {
    // Five folded teams across three years pool into three "Other" rows, one per year, so the
    // folded Series is still a line.
    const r = withSeries();
    const other = r.rows.filter((x) => x.team === FOLD_LABEL);
    expect(other).toHaveLength(3);
    expect(other.map((x) => x.m)).toEqual([5, 5, 5]);
  });

  it('keeps every Series when they fit', () => {
    const few = store(
      ['date', 'team'],
      Array.from({ length: 18 }, (_, i) => [`${2000 + (i % 3)}-06-15`, `t${i % 6}`]),
    );
    const r = executeOperation(few, spec, { seriesBy: 'team' });
    expect(new Set(r.rows.map((x) => x.team)).size).toBe(6);
    expect(r.summary.fold).toBeNull();
  });

  it('ranks a Series by its whole run and not by its best single point', () => {
    // Hand-worked: six steady teams score 40 a year for three years — 120 each. `spike` plays
    // once, for 100. Ranked cell by cell `spike` holds the largest number in the result and
    // would survive; ranked over its rows it is seventh of seven and folds.
    const rows = [
      ...Array.from({ length: 6 }, (_, t) =>
        [2000, 2001, 2002].map((y) => [`${y}-06-15`, `steady${t}`, '40']),
      ).flat(),
      ['2000-06-15', 'spike', '100'],
    ];
    const s = store(['date', 'team', 'goals'], rows, { goals: 'number' });
    const r = executeOperation(
      s,
      op({
        timeBucket: { column: 'date', unit: 'year' },
        groupBy: ['team'],
        aggregations: [agg('m', 'sum', 'goals')],
      }),
      { seriesBy: 'team', metric: 'm' },
    );
    expect(r.rows.some((x) => x.team === 'spike')).toBe(false);
    // One steady team folds alongside it, so 2000 pools 40 + 100 and the other two years hold
    // that team's 40 alone. Pooled per x, and pooled from rows rather than from group totals.
    expect(r.rows.filter((x) => x.team === FOLD_LABEL).map((x) => x.m)).toEqual([140, 40, 40]);
    expect(r.summary.fold).toMatchObject({ kept: 5, folded: 2, value: 220 });
  });

  it('never names a folded Series as the extreme', () => {
    const r = withSeries();
    expect(r.summary.extreme?.label).not.toBe(FOLD_LABEL);
  });

  it('honours an explicit limit instead of the budget, because the model asked for a top-N', () => {
    const r = withSeries({ ...spec, limit: 4 });
    expect(r.rows).toHaveLength(4);
    expect(r.rows.some((x) => x.team === FOLD_LABEL)).toBe(false);
  });

  it('folds the first dimension when no Series was named, as it always did', () => {
    const r = executeOperation(many, op({ groupBy: ['team'] }));
    expect(FOLD_TOP_N).toBe(15);
    expect(r.summary.fold).toBeNull();
    expect(r.rows).toHaveLength(10);
  });
});

describe('the scatter budget', () => {
  /** Forty groups over two measures — a scatter's shape: both axes are aggregations, and the
      grouping column is on neither of them. */
  const measures = [agg('x', 'sum', 'n'), agg('y', 'avg', 'n')];
  const forty = store(
    ['k', 'series', 'n'],
    Array.from({ length: 200 }, (_, i) => [`k${i % 40}`, `s${i % 8}`, String(i)]),
    { n: 'number' },
  );
  const spec = op({ groupBy: ['k'], aggregations: measures });
  const asScatter = (o = spec, over = {}) =>
    executeOperation(forty, o, { metric: 'y', chartType: 'scatter', ...over });

  it('keeps every point, where an axis of categories would have folded at fifteen', () => {
    expect(asScatter().rows).toHaveLength(40);
    expect(asScatter().summary.fold).toBeNull();
    // The same Operation on a bar chart's budget, for contrast.
    expect(executeOperation(forty, spec, { metric: 'y' }).rows).toHaveLength(FOLD_TOP_N + 1);
  });

  it('folds the Series to three, the fold included', () => {
    const r = asScatter(op({ groupBy: ['k', 'series'], aggregations: measures }), {
      seriesBy: 'series',
    });
    expect(SCATTER_SERIES_BUDGET).toBe(3);
    const series = new Set(r.rows.map((x) => x.series));
    expect(series.size).toBe(SCATTER_SERIES_BUDGET);
    expect(series.has(FOLD_LABEL)).toBe(true);
    expect(r.summary.fold).toMatchObject({ dimensionLabel: 'series', kept: 2, folded: 6 });
  });

  it('carries a hundred times the points an aggregate chart carries', () => {
    expect(CHART_BUDGET.bar.points).toBe(POINT_CAP);
    expect(CHART_BUDGET.scatter.points).toBe(100_000);
    expect(CHART_BUDGET.line.series).toBe(SERIES_BUDGET);
    expect(CHART_BUDGET.scatter.series).toBe(SCATTER_SERIES_BUDGET);
  });

  it('keeps 1,400 points where a bar chart’s cap would have cut them at a thousand', () => {
    const many = store(
      ['k'],
      Array.from({ length: 1_400 }, (_, i) => [`k${i}`]),
    );
    // 1,400 groups: past a bar chart's thousand, inside a scatter's hundred thousand.
    const asBar = executeOperation(many, op({ groupBy: ['k'], limit: 1_000 }), { metric: 'm' });
    expect(asBar.rows).toHaveLength(1_000);
    const wide = executeOperation(many, op({ groupBy: ['k'] }), {
      metric: 'm',
      chartType: 'scatter',
    });
    expect(wide.rows).toHaveLength(1_400);
    expect(wide.truncated).toBe(false);
  });
});
