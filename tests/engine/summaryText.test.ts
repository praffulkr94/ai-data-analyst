import { describe, expect, it } from 'vitest';
import { chartLabel, chartCaption } from '../../src/chart/summaryText';
import type { ChartSummary } from '../../src/engine/result';

const summary = (over: Partial<ChartSummary> = {}): ChartSummary => ({
  metricLabel: 'matches',
  aggregation: 'count',
  dimensionLabel: 'city',
  groupCount: 6,
  totalGroups: 6,
  foldedCount: 0,
  foldedValue: null,
  extreme: { label: 'London', value: 412 },
  nullExcluded: 0,
  rowsMatched: 49_520,
  rowsTotal: 49_520,
  ...over,
});

/** One computation, two formatters. They are deliberately not the same string: a sighted reader
    under a visible bar chart does not need "Bar chart, 6 categories" — that restates what they
    can see — while a screen-reader user needs exactly that orientation. */

describe('the screen-reader label', () => {
  it('names the chart type, the metric, the dimension, the category count and the extreme', () => {
    const label = chartLabel(summary(), 'bar');
    expect(label).toBe('Bar chart. matches by city, 6 categories. Highest: London, 412.');
  });

  it('names the chart type it was actually given', () => {
    expect(chartLabel(summary(), 'line')).toMatch(/^Line chart\./);
    expect(chartLabel(summary(), 'scatter')).toMatch(/^Scatter plot\./);
  });

  it('says there is one value rather than one category when a result has no dimension', () => {
    const label = chartLabel(summary({ dimensionLabel: null, groupCount: 1, extreme: null }), 'bar');
    expect(label).toBe('Bar chart. matches, a single value.');
  });

  it('states an empty result rather than describing a picture of nothing', () => {
    expect(chartLabel(summary({ groupCount: 0, extreme: null }), 'bar')).toBe(
      'Bar chart. matches by city, no results.',
    );
  });

  it('says how many groups were folded, because the fold is part of what is on screen', () => {
    expect(chartLabel(summary({ groupCount: 16, totalGroups: 2092, foldedCount: 2076 }), 'bar')).toBe(
      'Bar chart. matches by city, showing the top 15 of 2,092 with the rest grouped as Other. ' +
        'Highest: London, 412.',
    );
  });
});

describe('the visible caption', () => {
  it('adds what the chart cannot show rather than restating what it can', () => {
    // Nothing was folded, nothing was excluded and no filter ran, so there is nothing to add.
    expect(chartCaption(summary())).toBe('Counted over all 49,520 rows.');
  });

  it('never names the chart type or the category count, which the reader can see', () => {
    const caption = chartCaption(summary({ groupCount: 16, totalGroups: 2092, foldedCount: 2076 }));
    expect(caption).not.toMatch(/chart|categories/i);
    expect(caption).toContain('Top 15 of 2,092 cities');
  });

  it('says how large the folded remainder is, since the chart does not draw it', () => {
    const caption = chartCaption(
      summary({ groupCount: 16, totalGroups: 2092, foldedCount: 2076, foldedValue: 43_259 }),
    );
    expect(caption).toContain('Top 15 of 2,092 cities; the other 2,076 hold 43,259.');
  });

  it('states the rows a filter kept', () => {
    expect(chartCaption(summary({ rowsMatched: 1_204 }))).toBe(
      'Counted over 1,204 of 49,520 rows.',
    );
  });

  it('states the rows the aggregation excluded for having no value', () => {
    // The average was taken over fewer rows than the file holds, and the reader must be told.
    expect(chartCaption(summary({ aggregation: 'avg', nullExcluded: 254 }))).toBe(
      'Averaged over all 49,520 rows. 254 rows excluded for having no value.',
    );
  });

  it('says a result is empty', () => {
    expect(chartCaption(summary({ groupCount: 0, rowsMatched: 0 }))).toBe('No rows matched.');
  });

  it('names the aggregation in words rather than as a function name', () => {
    for (const [fn, word] of [
      ['sum', 'Summed'],
      ['avg', 'Averaged'],
      ['count', 'Counted'],
      ['countDistinct', 'Counted as distinct values'],
      ['min', 'Smallest'],
      ['max', 'Largest'],
      ['median', 'Median'],
      ['rate', 'Shown as a share'],
      ['ratio', 'Shown as a ratio'],
    ] as const) {
      expect(chartCaption(summary({ aggregation: fn }))).toMatch(new RegExp(`^${word} `));
    }
  });
});

describe('the two formatters together', () => {
  it('never produce the same string, because they are written for different readers', () => {
    const cases: Partial<ChartSummary>[] = [
      {},
      { groupCount: 0, extreme: null },
      { foldedCount: 2076, totalGroups: 2092, groupCount: 16, foldedValue: 43_259 },
      { dimensionLabel: null, groupCount: 1 },
      { nullExcluded: 254, aggregation: 'avg' },
    ];
    for (const over of cases) {
      const s = summary(over);
      expect(chartLabel(s, 'bar')).not.toBe(chartCaption(s));
    }
  });
});
