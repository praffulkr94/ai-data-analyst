/** The spec→DSL formatter. It is what the "view the query the model wrote" disclosure renders,
    and it is the only place an aggregation id is turned back into words a reader knows. */
import { describe, expect, it } from 'vitest';
import { formatSpec } from '../../src/spec/format';
import type { AnalysisSpec } from '../../src/spec/grammar';

const spec = (over: Partial<AnalysisSpec['operation']>, vis?: AnalysisSpec['visualization']): AnalysisSpec => ({
  title: 'T',
  narration: 'N',
  operation: {
    filters: [],
    groupBy: [],
    timeBucket: null,
    aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
    derived: [],
    sort: null,
    limit: null,
    ...over,
  },
  visualization: vis ?? { type: 'bar', x: 'city', y: 'm', seriesBy: null },
});

describe('formatSpec', () => {
  it('writes the design’s aligned clauses, ids resolved to labels', () => {
    expect(
      formatSpec(spec({ groupBy: ['city'], sort: { by: 'm', dir: 'desc' }, limit: 12 })),
    ).toBe(
      [
        'group_by   city',
        'measure    count(*) as matches',
        'sort       matches desc',
        'limit      12',
        'chart      bar  x=city  y=matches',
      ].join('\n'),
    );
  });

  it('names the filter, the bucket and the ratio in the grammar’s own words', () => {
    const text = formatSpec(
      spec({
        filters: [{ op: 'eq', column: 'country', value: 'Atlantis' }],
        timeBucket: { column: 'date', unit: 'year' },
        aggregations: [
          { id: 'g', fn: 'sum', column: 'home_score', label: 'home goals' },
          { id: 'm', fn: 'count', column: null, label: 'matches' },
        ],
        derived: [{ id: 'gpm', label: 'goals per match', numerator: 'g', denominator: 'm' }],
        sort: { by: 'gpm', dir: 'desc' },
      }),
    );
    expect(text).toContain('filter     country = "Atlantis"');
    expect(text).toContain('bucket     date by year');
    expect(text).toContain('measure    sum(home_score) as home goals');
    expect(text).toContain('ratio      home goals / matches as goals per match');
    expect(text).toContain('sort       goals per match desc');
  });

  /** Nothing in the output may be an id: an id is the model's handle and means nothing to a
      reader looking at their own columns. */
  it('leaves no aggregation id in the rendered text', () => {
    const text = formatSpec(
      spec({ groupBy: ['city'], sort: { by: 'm', dir: 'asc' } }, {
        type: 'scatter',
        x: 'm',
        y: 'm',
        seriesBy: null,
      }),
    );
    expect(text).not.toMatch(/\bm\b(?! )/);
    expect(text).toContain('chart      scatter  x=matches  y=matches');
  });
});
