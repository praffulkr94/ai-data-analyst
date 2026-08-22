/** The named states a result can be in that the chart layer refuses to draw. Pure, so it is
    tested at the `DataEngine` seam; that the refusal actually reaches the screen instead of an
    SVG is asserted in the workspace seam. */
import { describe, expect, it } from 'vitest';
import { MARK_CAP } from '../../src/chart/marks';
import { POINT_CAP } from '../../src/engine/operation';
import { degeneracy, marksNeeded, type AnalysisResult, type ResultRow } from '../../src/engine/result';

const result = (rows: ResultRow[], truncated = false): AnalysisResult => ({
  fields: [
    { name: 'city', label: 'city', role: 'dimension', type: 'categorical' },
    { name: 'm', label: 'matches', role: 'measure', type: 'number' },
  ],
  rows,
  truncated,
  summary: {
    metricLabel: 'matches',
    aggregation: 'count',
    dimensionLabel: 'city',
    groupCount: rows.length,
    totalGroups: rows.length,
    fold: null,
    extreme: null,
    nullExcluded: 0,
    rowsMatched: 1,
    rowsTotal: 1,
  },
});

const cities = (n: number, series = 1) =>
  Array.from({ length: n * series }, (_, i) => ({
    city: `c${i % n}`,
    team: `t${Math.floor(i / n)}`,
    m: i,
  }));

const bar = { x: 'city', marks: MARK_CAP.bar };

describe('degeneracy', () => {
  it('names an empty result rather than drawing an axis around nothing', () => {
    expect(degeneracy(result([]), 'm', bar)).toBe('empty');
  });

  it('names an all-null result, which would otherwise be drawn as real zeros', () => {
    expect(degeneracy(result([{ city: 'a', m: null }, { city: 'b', m: null }]), 'm', bar)).toBe(
      'all-null',
    );
  });

  it('calls one row drawable, because one bar is a legitimate answer', () => {
    expect(degeneracy(result([{ city: 'a', m: 1 }]), 'm', bar)).toBe('single');
  });

  it('says nothing about a result that is fine', () => {
    expect(degeneracy(result(cities(20)), 'm', { x: 'city', marks: MARK_CAP.line })).toBeNull();
  });
});

describe('the renderability guard', () => {
  it('refuses 800 bars, which at any width are not a chart', () => {
    expect(degeneracy(result(cities(800)), 'm', bar)).toBe('too-many');
    expect(MARK_CAP.bar).toBe(60);
  });

  it('draws the same 800 as a line, where a point needs one pixel', () => {
    expect(degeneracy(result(cities(800)), 'm', { x: 'city', marks: MARK_CAP.line })).toBeNull();
    expect(MARK_CAP.line).toBe(POINT_CAP);
  });

  it('counts positions and not rows, because Series share one', () => {
    // 60 categories in six Series is 360 rows and 60 bands. Counting rows would refuse a chart
    // that draws perfectly well.
    const six = result(cities(60, 6));
    expect(six.rows).toHaveLength(360);
    expect(marksNeeded(six, 'city')).toBe(60);
    expect(degeneracy(six, 'm', bar)).toBeNull();
  });

  it('refuses a truncated result whatever its shape, because it is not the whole answer', () => {
    // The point cap cut it short, so drawing it draws a fraction without saying which fraction.
    const cut = result(cities(30), true);
    expect(degeneracy(cut, 'm', bar)).toBe('too-many');
    expect(degeneracy(cut, 'm', { x: 'city', marks: MARK_CAP.line })).toBe('too-many');
  });

  it('leaves the guard out when the caller only asked about the data', () => {
    expect(degeneracy(result(cities(800)), 'm')).toBeNull();
  });
});
