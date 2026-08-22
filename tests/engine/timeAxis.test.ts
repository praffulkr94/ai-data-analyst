/** The temporal axis labels. Pure string formatting over a bucket start, so it is tested at the
    `DataEngine` seam with no DOM — the same arrangement as the two ChartSummary formatters.

    UTC throughout. These expectations are written as the UTC calendar reads them, so they fail
    if the axis ever formats a bucket start in local time. Run the suite under
    `TZ=America/Los_Angeles` and nothing here may move. */
import { describe, expect, it } from 'vitest';
import { temporalLabel } from '../../src/chart/marks';
import { bucketStart } from '../../src/engine/time';
import { TIME_UNITS } from '../../src/spec/grammar';

const at = (iso: string) => Date.parse(iso);

describe('temporal tick labels', () => {
  it('labels each unit at its own resolution', () => {
    expect(temporalLabel('year', at('1872-01-01T00:00:00Z'))).toBe('1872');
    expect(temporalLabel('quarter', at('1999-07-01T00:00:00Z'))).toBe('Q3 1999');
    expect(temporalLabel('month', at('2020-03-01T00:00:00Z'))).toBe('Mar 2020');
    expect(temporalLabel('week', at('2025-12-29T00:00:00Z'))).toBe('29 Dec 2025');
    expect(temporalLabel('day', at('2026-01-04T00:00:00Z'))).toBe('04 Jan 2026');
  });

  it('numbers the quarters one to four', () => {
    const q = (month: string) => temporalLabel('quarter', at(`2024-${month}-01T00:00:00Z`));
    expect([q('01'), q('04'), q('07'), q('10')]).toEqual([
      'Q1 2024',
      'Q2 2024',
      'Q3 2024',
      'Q4 2024',
    ]);
  });

  it('reads a stringified epoch, which is what a band domain holds', () => {
    // A bar chart over a time bucket puts the bucket starts in a band scale, and a band domain
    // is strings. `new Date("1583020800000")` is Invalid Date, so the coercion is load-bearing.
    const ms = at('2020-03-01T00:00:00Z');
    expect(temporalLabel('month', String(ms))).toBe('Mar 2020');
    expect(temporalLabel('month', new Date(ms))).toBe('Mar 2020');
  });

  it('says "no value" for the null bucket rather than showing the epoch', () => {
    // A band domain stringifies a null key to the empty string, and `Number('')` is 0.
    expect(temporalLabel('year', '')).toBe('no value');
    expect(temporalLabel('year', Number.NaN)).toBe('no value');
  });

  it('falls back to a full date for a date column that was never bucketed', () => {
    expect(temporalLabel(undefined, at('1966-07-30T00:00:00Z'))).toBe('30 Jul 1966');
  });

  it('never labels the Dataset’s first day as 1871, in any unit', () => {
    // 1872-11-30T00:00:00Z is 1872-11-29 in every timezone west of Greenwich, and its year
    // bucket starts at a UTC midnight that local formatting drags into 1871.
    const first = at('1872-11-30T00:00:00Z');
    for (const unit of TIME_UNITS) {
      expect(temporalLabel(unit, bucketStart(first, unit))).toContain('1872');
    }
  });
});
