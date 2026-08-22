import { describe, expect, it } from 'vitest';
import { CARDINALITY_CAP, validateSpec, type SpecViolation } from '../../src/spec/validate';
import type { AnalysisSpec, Operation, Visualization } from '../../src/spec/grammar';
import type { ColumnMeta, DatasetSchema } from '../../src/engine/types';

/** The hero Dataset's schema, which is what every real spec is checked against. */
const col = (name: string, type: ColumnMeta['type'], distinct = 10): ColumnMeta => ({
  name,
  type,
  confidence: 1,
  nullCount: 0,
  stats:
    type === 'number' || type === 'date'
      ? { min: 0, max: 10, mean: 5 }
      : { distinct, top: [] },
});

const schema: DatasetSchema = {
  columns: [
    col('date', 'date'),
    col('home_team', 'categorical', 328),
    col('city', 'categorical', 2092),
    col('home_score', 'number'),
    col('neutral', 'boolean', 2),
  ],
};

const operation = (over: Partial<Operation> = {}): Operation => ({
  filters: [],
  groupBy: ['home_team'],
  timeBucket: null,
  aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
  derived: [],
  sort: null,
  limit: null,
  ...over,
});

const viz = (over: Partial<Visualization> = {}): Visualization =>
  ({ type: 'bar', x: 'home_team', y: 'm', seriesBy: null, ...over }) as Visualization;

const spec = (op: Partial<Operation> = {}, v: Partial<Visualization> = {}): AnalysisSpec => ({
  title: 'Matches by team',
  narration: 'Counting matches for each team.',
  operation: operation(op),
  visualization: viz(v),
});

const check = (s: AnalysisSpec) => validateSpec(s, schema);
const codes = (s: AnalysisSpec) => check(s).map((v) => v.code);
const only = (s: AnalysisSpec): SpecViolation => {
  const found = check(s);
  expect(found, JSON.stringify(found)).toHaveLength(1);
  return found[0]!;
};

describe('a valid spec', () => {
  it('produces no violations', () => {
    expect(check(spec())).toEqual([]);
  });

  it('accepts every legal aggregation on a numeric column', () => {
    for (const fn of ['sum', 'avg', 'min', 'max', 'median', 'countDistinct'] as const) {
      expect(
        codes(spec({ aggregations: [{ id: 'm', fn, column: 'home_score', label: fn }] })),
      ).toEqual([]);
    }
  });

  it('accepts a rate on a boolean column', () => {
    expect(
      codes(spec({ aggregations: [{ id: 'm', fn: 'rate', column: 'neutral', label: 'share' }] })),
    ).toEqual([]);
  });

  it('accepts a time bucket on a date column plotted as a line', () => {
    expect(
      codes(
        spec(
          { groupBy: [], timeBucket: { column: 'date', unit: 'year' } },
          { type: 'line', x: 'date' },
        ),
      ),
    ).toEqual([]);
  });
});

describe('columns that do not exist', () => {
  it('names the column and lists the valid ones', () => {
    const v = only(spec({ groupBy: ['revenu'] }, { x: 'revenu' }));
    expect(v.code).toBe('unknown-column');
    expect(v.message).toContain('`revenu`');
    expect(v.message).toContain('home_team');
    expect(v.message).toContain('home_score');
  });

  it('catches one in a filter', () => {
    expect(codes(spec({ filters: [{ op: 'eq', column: 'nope', value: 'x' }] }))).toEqual([
      'unknown-column',
    ]);
  });

  it('catches one in an aggregation', () => {
    expect(
      codes(spec({ aggregations: [{ id: 'm', fn: 'sum', column: 'nope', label: 'x' }] })),
    ).toEqual(['unknown-column']);
  });
});

describe('aggregations illegal for a ColumnType', () => {
  it('rejects avg on a boolean and points at rate', () => {
    const v = only(
      spec({ aggregations: [{ id: 'm', fn: 'avg', column: 'neutral', label: 'avg' }] }),
    );
    expect(v.code).toBe('illegal-aggregation');
    expect(v.message).toContain('boolean');
    expect(v.message).toContain('rate');
  });

  it('rejects sum on a boolean, which is a miscount dressed as a total', () => {
    expect(
      codes(spec({ aggregations: [{ id: 'm', fn: 'sum', column: 'neutral', label: 'sum' }] })),
    ).toEqual(['illegal-aggregation']);
  });

  it('rejects sum on a categorical column and lists the numeric ones', () => {
    const v = only(
      spec({ aggregations: [{ id: 'm', fn: 'sum', column: 'home_team', label: 'sum' }] }),
    );
    expect(v.message).toContain('home_score');
  });

  it('rejects rate on anything but a boolean', () => {
    expect(
      codes(spec({ aggregations: [{ id: 'm', fn: 'rate', column: 'home_score', label: 'r' }] })),
    ).toEqual(['illegal-aggregation']);
  });

  it('rejects avg on a date, which averages calendar instants into nothing', () => {
    expect(
      codes(spec({ aggregations: [{ id: 'm', fn: 'avg', column: 'date', label: 'a' }] })),
    ).toEqual(['illegal-aggregation']);
  });

  it('accepts min and max on a date', () => {
    expect(
      codes(spec({ aggregations: [{ id: 'm', fn: 'min', column: 'date', label: 'first' }] })),
    ).toEqual([]);
  });

  it('rejects a column on count, because count counts rows', () => {
    expect(
      codes(spec({ aggregations: [{ id: 'm', fn: 'count', column: 'home_team', label: 'c' }] })),
    ).toEqual(['count-takes-no-column']);
  });

  it('rejects a missing column on an aggregation that needs one', () => {
    expect(
      codes(spec({ aggregations: [{ id: 'm', fn: 'sum', column: null, label: 's' }] })),
    ).toEqual(['unknown-column']);
  });

  it('rejects two aggregations sharing an id', () => {
    expect(
      codes(
        spec({
          aggregations: [
            { id: 'm', fn: 'count', column: null, label: 'a' },
            { id: 'm', fn: 'countDistinct', column: 'city', label: 'b' },
          ],
        }),
      ),
    ).toEqual(['duplicate-id']);
  });
});

describe('fields that exist in the source but not in the output', () => {
  /** The specific defect this layer exists for: `city` is a real column, and it is still not a
      field of a result that never grouped by it. */
  it('rejects an x that is a Dataset column but not an Operation output field', () => {
    const v = only(spec({ groupBy: ['home_team'] }, { x: 'city' }));
    expect(v.code).toBe('unknown-field');
    expect(v.message).toContain('`city`');
    expect(v.message).toContain('home_team');
    expect(v.message).toMatch(/grouped by, bucketed, or aggregated/);
  });

  it('rejects a y naming a column rather than an aggregation id', () => {
    expect(codes(spec({}, { y: 'home_score' }))).toEqual(['unknown-field']);
  });

  it('rejects a sort by a field the Operation does not produce', () => {
    expect(codes(spec({ sort: { by: 'city', dir: 'desc' } }))).toEqual(['unknown-field']);
  });

  it('rejects a derived metric referring to an aggregation that is not there', () => {
    expect(
      codes(
        spec({
          derived: [{ id: 'per', label: 'per', numerator: 'g', denominator: 'm' }],
        }),
      ),
    ).toEqual(['unknown-field']);
  });

  it('accepts a derived metric over aggregations that are', () => {
    expect(
      codes(
        spec(
          {
            aggregations: [
              { id: 'g', fn: 'sum', column: 'home_score', label: 'goals' },
              { id: 'm', fn: 'count', column: null, label: 'matches' },
            ],
            derived: [{ id: 'per', label: 'per match', numerator: 'g', denominator: 'm' }],
          },
          { y: 'per' },
        ),
      ),
    ).toEqual([]);
  });

  it('rejects a derived id colliding with an aggregation id', () => {
    expect(
      codes(spec({ derived: [{ id: 'm', label: 'x', numerator: 'm', denominator: 'm' }] })),
    ).toEqual(['duplicate-id']);
  });
});

describe('chart types that do not suit the result', () => {
  it('rejects a dimension on the y-axis', () => {
    // Swapping the axes is wrong twice over, and both halves are reported.
    const found = check(spec({}, { x: 'm', y: 'home_team' }));
    expect(found.map((v) => v.code).sort()).toEqual(['not-a-dimension', 'not-a-measure']);
    expect(found.find((v) => v.code === 'not-a-measure')!.message).toContain('Measures available: m');
  });

  it('rejects a measure on the x-axis of a bar chart', () => {
    expect(
      codes(
        spec(
          {
            aggregations: [
              { id: 'm', fn: 'count', column: null, label: 'a' },
              { id: 'n', fn: 'countDistinct', column: 'city', label: 'b' },
            ],
          },
          { x: 'n', y: 'm' },
        ),
      ),
    ).toEqual(['not-a-dimension']);
  });

  it('rejects a dimension on the x-axis of a scatter, which plots measure against measure', () => {
    const v = only(spec({}, { type: 'scatter', x: 'home_team', y: 'm' }));
    expect(v.code).toBe('chart-mismatch');
    expect(v.message).toContain('scatter');
  });

  it('accepts a scatter of one measure against another', () => {
    expect(
      codes(
        spec(
          {
            aggregations: [
              { id: 'm', fn: 'count', column: null, label: 'a' },
              { id: 'g', fn: 'sum', column: 'home_score', label: 'b' },
            ],
          },
          { type: 'scatter', x: 'g', y: 'm' },
        ),
      ),
    ).toEqual([]);
  });

  it('rejects a line over unordered categories, because joining them implies an order', () => {
    const v = only(spec({ groupBy: ['home_team'] }, { type: 'line', x: 'home_team' }));
    expect(v.code).toBe('chart-mismatch');
    expect(v.message).toMatch(/implies an order/);
  });

  it('accepts a line over a numeric dimension', () => {
    expect(
      codes(spec({ groupBy: ['home_score'] }, { type: 'line', x: 'home_score' })),
    ).toEqual([]);
  });

  it('rejects a measure separating the Series', () => {
    expect(codes(spec({}, { seriesBy: 'm' }))).toEqual(['not-a-dimension']);
  });

  it('rejects a Series split by the column already on the x-axis', () => {
    expect(codes(spec({}, { seriesBy: 'home_team' }))).toEqual(['chart-mismatch']);
  });

  it('accepts a Series split by the second grouping column', () => {
    expect(
      codes(spec({ groupBy: ['home_team', 'neutral'] }, { seriesBy: 'neutral' })),
    ).toEqual([]);
  });
});

describe('time bucketing', () => {
  it('rejects bucketing a column that is not a date, and lists the date columns', () => {
    const v = only(
      spec(
        { groupBy: [], timeBucket: { column: 'home_team', unit: 'year' } },
        { x: 'home_team' },
      ),
    );
    expect(v.code).toBe('not-temporal');
    expect(v.message).toContain('date');
  });

  it('rejects bucketing a column that does not exist', () => {
    expect(
      codes(spec({ groupBy: [], timeBucket: { column: 'when', unit: 'year' } }, { x: 'when' })),
    ).toContain('unknown-column');
  });
});

describe('filters whose operator does not suit the column', () => {
  it('rejects an ordering comparison against a categorical column', () => {
    const v = only(spec({ filters: [{ op: 'gt', column: 'home_team', value: 3 }] }));
    expect(v.code).toBe('filter-type');
    expect(v.message).toContain('home_score');
  });

  it('rejects a date range against a column that is not a date', () => {
    expect(
      codes(
        spec({
          filters: [{ op: 'dateRange', column: 'home_team', from: '2000-01-01', to: '2001-01-01' }],
        }),
      ),
    ).toEqual(['filter-type']);
  });

  it('accepts a date range against a date column', () => {
    expect(
      codes(
        spec({
          filters: [{ op: 'dateRange', column: 'date', from: '2000-01-01', to: '2001-01-01' }],
        }),
      ),
    ).toEqual([]);
  });

  it('accepts equality against any ColumnType', () => {
    expect(codes(spec({ filters: [{ op: 'eq', column: 'neutral', value: true }] }))).toEqual([]);
    expect(codes(spec({ filters: [{ op: 'eq', column: 'city', value: 'London' }] }))).toEqual([]);
  });

  it('accepts a null test against any ColumnType', () => {
    expect(codes(spec({ filters: [{ op: 'isNull', column: 'city' }] }))).toEqual([]);
  });
});

describe('cardinality past what the application will draw', () => {
  it('refuses a grouping column with more categories than the cap and offers a top-N', () => {
    const huge: DatasetSchema = {
      columns: [col('id', 'categorical', CARDINALITY_CAP + 1), col('n', 'number')],
    };
    const found = validateSpec(
      { ...spec({ groupBy: ['id'] }, { x: 'id' }) },
      huge,
    ).filter((v) => v.code === 'cardinality');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/top-N/);
  });

  it('accepts city, which the fold handles rather than the cap', () => {
    expect(codes(spec({ groupBy: ['city'] }, { x: 'city' }))).toEqual([]);
  });
});

describe('several violations at once', () => {
  it('reports every one, because the Repair gets a list and not the first failure', () => {
    const found = check(
      spec(
        {
          groupBy: ['revenu'],
          aggregations: [{ id: 'm', fn: 'avg', column: 'neutral', label: 'x' }],
        },
        { x: 'nope', y: 'alsonope' },
      ),
    );
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(new Set(found.map((v) => v.code))).toEqual(
      new Set(['unknown-column', 'illegal-aggregation', 'unknown-field']),
    );
  });

  it('says where each one is, so the model can see which part to change', () => {
    const found = check(spec({ groupBy: ['revenu'] }, { x: 'revenu' }));
    expect(found.map((v) => v.path)).toContain('operation.groupBy[0]');
  });
});
