/** Time bucketing — the M4 x-axis. The implementation shipped with M3 with its test debt named
    in the handoff; this is that debt paid.

    Every boundary below is either a hand-worked calendar date or derived from epoch-day
    arithmetic, which shares nothing with `bucketStart`'s `Date.UTC` construction. A test that
    floored the date the way the code floors it would assert only self-consistency. */
import { describe, expect, it } from 'vitest';
import { buildColumnStore } from '../../src/engine/columnStore';
import { inferSchema } from '../../src/engine/infer';
import { executeOperation } from '../../src/engine/operation';
import { bucketStart } from '../../src/engine/time';
import { TIME_UNITS, type Operation, type TimeUnit } from '../../src/spec/grammar';

const at = (iso: string) => Date.parse(iso);
const bucket = (iso: string, unit: TimeUnit) => new Date(bucketStart(at(iso), unit)).toISOString();

/** Weekday from the epoch day count. 1970-01-01 was a Thursday, so day 0 is weekday 4, and
    `Math.floor` keeps that true on the negative side of the epoch — which the 1872 end of the
    Dataset lives on. 0 is Sunday. */
const weekdayOf = (ms: number) => (((Math.floor(ms / 86_400_000) + 4) % 7) + 7) % 7;

describe('bucketStart', () => {
  /** The first official international: Saturday 30 November 1872, Hamilton Crescent — row one of
      the hero Dataset, and 97 years before the epoch. */
  it('floors the Dataset’s first day, 1872-11-30, in all five units', () => {
    expect(bucket('1872-11-30T15:20:00Z', 'day')).toBe('1872-11-30T00:00:00.000Z');
    expect(bucket('1872-11-30T15:20:00Z', 'week')).toBe('1872-11-25T00:00:00.000Z');
    expect(bucket('1872-11-30T15:20:00Z', 'month')).toBe('1872-11-01T00:00:00.000Z');
    expect(bucket('1872-11-30T15:20:00Z', 'quarter')).toBe('1872-10-01T00:00:00.000Z');
    expect(bucket('1872-11-30T15:20:00Z', 'year')).toBe('1872-01-01T00:00:00.000Z');
  });

  it('floors the far end of the span, 2026, in all five units', () => {
    // 2026-01-04 is a Sunday, so its ISO week starts six days back — in the previous month and
    // the previous year. This is the case a `getUTCDay()`-based shift gets wrong.
    expect(bucket('2026-01-04T00:00:00Z', 'day')).toBe('2026-01-04T00:00:00.000Z');
    expect(bucket('2026-01-04T00:00:00Z', 'week')).toBe('2025-12-29T00:00:00.000Z');
    expect(bucket('2026-01-04T00:00:00Z', 'month')).toBe('2026-01-01T00:00:00.000Z');
    expect(bucket('2026-01-04T00:00:00Z', 'quarter')).toBe('2026-01-01T00:00:00.000Z');
    expect(bucket('2026-01-04T00:00:00Z', 'year')).toBe('2026-01-01T00:00:00.000Z');
  });

  it('takes a Monday as the start of its own week', () => {
    expect(bucket('1900-01-01T00:00:00Z', 'week')).toBe('1900-01-01T00:00:00.000Z');
  });

  it('keeps a leap day in February', () => {
    expect(bucket('2020-02-29T23:59:59.999Z', 'day')).toBe('2020-02-29T00:00:00.000Z');
    expect(bucket('2020-02-29T23:59:59.999Z', 'week')).toBe('2020-02-24T00:00:00.000Z');
    expect(bucket('2020-02-29T23:59:59.999Z', 'month')).toBe('2020-02-01T00:00:00.000Z');
  });

  it('assigns each month to the quarter it belongs to', () => {
    expect(bucket('1999-03-31T00:00:00Z', 'quarter')).toBe('1999-01-01T00:00:00.000Z');
    expect(bucket('1999-04-01T00:00:00Z', 'quarter')).toBe('1999-04-01T00:00:00.000Z');
    expect(bucket('1999-08-15T00:00:00Z', 'quarter')).toBe('1999-07-01T00:00:00.000Z');
    expect(bucket('1999-12-31T00:00:00Z', 'quarter')).toBe('1999-10-01T00:00:00.000Z');
  });

  it('discards the time of day, whichever unit is asked for', () => {
    const noon = at('2000-06-15T12:00:00Z');
    const midnight = at('2000-06-15T00:00:00Z');
    for (const unit of TIME_UNITS) {
      expect(bucketStart(noon, unit)).toBe(bucketStart(midnight, unit));
    }
  });

  /** One sample per unit per year, walked over the whole 1872–2026 span, checked against the
      calendar rather than against the implementation. */
  describe('over the 1872–2026 span', () => {
    const YEARS = Array.from({ length: 2026 - 1872 + 1 }, (_, i) => 1872 + i);
    const samples = YEARS.flatMap((y) =>
      // Four moments a year, one of them a leap-day candidate and one in the last hour of the year.
      ['-02-28T06:00:00Z', '-05-17T00:00:00Z', '-09-01T12:30:00Z', '-12-31T23:00:00Z'].map(
        (rest) => at(`${y}${rest}`),
      ),
    );

    it('lands every week on a Monday, no more than six days back', () => {
      for (const ms of samples) {
        const start = bucketStart(ms, 'week');
        expect(weekdayOf(start), new Date(start).toISOString()).toBe(1);
        expect(ms - start).toBeGreaterThanOrEqual(0);
        expect(ms - start).toBeLessThan(7 * 86_400_000);
      }
    });

    it('lands every month, quarter and year on the first of a month at midnight', () => {
      const firstOfMonth = /^\d{4}-\d{2}-01T00:00:00\.000Z$/;
      for (const ms of samples) {
        for (const unit of ['month', 'quarter', 'year'] as const) {
          expect(new Date(bucketStart(ms, unit)).toISOString()).toMatch(firstOfMonth);
        }
        expect(new Date(bucketStart(ms, 'quarter')).getUTCMonth() % 3).toBe(0);
        expect(new Date(bucketStart(ms, 'year')).toISOString().slice(4)).toBe(
          '-01-01T00:00:00.000Z',
        );
      }
    });

    it('never moves a moment forward, and is unchanged by a second application', () => {
      for (const ms of samples) {
        for (const unit of TIME_UNITS) {
          const start = bucketStart(ms, unit);
          expect(start).toBeLessThanOrEqual(ms);
          expect(bucketStart(start, unit)).toBe(start);
        }
      }
    });
  });
});

/* ---- the executor's temporal dimension ------------------------------------------------ */

const op = (over: Partial<Operation> = {}): Operation => ({
  filters: [],
  groupBy: [],
  timeBucket: null,
  aggregations: [{ id: 'm', fn: 'count', column: null, label: 'matches' }],
  derived: [],
  sort: null,
  limit: 1000,
  ...over,
});

const store = (rows: string[][]) =>
  buildColumnStore(['date', 'goals'], rows, inferSchema(['date', 'goals'], rows));

describe('the temporal dimension', () => {
  const rows = [
    ['1872-11-30', '0'],
    ['1873-03-08', '4'],
    ['1873-03-22', '2'],
    ['2026-01-04', '1'],
  ];

  it('names the unit in the field label and marks the field temporal', () => {
    const r = executeOperation(
      store(rows),
      op({ timeBucket: { column: 'date', unit: 'month' } }),
    );
    expect(r.fields[0]).toEqual({
      name: 'date',
      label: 'date by month',
      role: 'dimension',
      type: 'date',
      temporal: true,
      unit: 'month',
    });
  });

  it('groups rows by their bucket start, as epoch milliseconds', () => {
    const r = executeOperation(
      store(rows),
      op({ timeBucket: { column: 'date', unit: 'month' } }),
    );
    // Two matches in March 1873, one each in November 1872 and January 2026.
    const byBucket = new Map(r.rows.map((row) => [row.date, row.m]));
    expect(byBucket.get(at('1873-03-01T00:00:00Z'))).toBe(2);
    expect(byBucket.get(at('1872-11-01T00:00:00Z'))).toBe(1);
    expect(byBucket.get(at('2026-01-01T00:00:00Z'))).toBe(1);
    expect(r.rows).toHaveLength(3);
  });

  it('separates by week what a month puts together', () => {
    const r = executeOperation(
      store(rows),
      op({ timeBucket: { column: 'date', unit: 'week' } }),
    );
    // 1873-03-08 and 1873-03-22 are two weeks apart, so the March pair splits.
    expect(r.rows).toHaveLength(4);
  });

  it('keeps a row with no date as its own bucket rather than dropping it', () => {
    const r = executeOperation(
      store([...rows, ['NA', '3']]),
      op({ timeBucket: { column: 'date', unit: 'year' } }),
    );
    expect(r.rows.filter((x) => x.date === null)).toEqual([{ date: null, m: 1 }]);
  });

  it('produces one bucket per year across the whole 1872–2026 span', () => {
    const yearly = Array.from({ length: 2026 - 1872 + 1 }, (_, i) => [`${1872 + i}-06-15`, '1']);
    const r = executeOperation(
      store(yearly),
      op({ timeBucket: { column: 'date', unit: 'year' } }),
    );
    expect(r.rows).toHaveLength(155);
    expect(r.rows.map((x) => x.date)).toContain(at('1872-01-01T00:00:00Z'));
    expect(r.rows.map((x) => x.date)).toContain(at('2026-01-01T00:00:00Z'));
    expect(r.summary.totalGroups).toBe(155);
  });
});
