/** Time bucketing. UTC throughout: the ColumnStore holds dates as epoch milliseconds with no
    timezone, and the hero Dataset spans 1872 to 2026 — a local-time floor would shift a bucket
    boundary every time the rules changed under it. */
import { utcFormat } from 'd3-time-format';
import type { TimeUnit } from '../spec/grammar';

/** The start of the bucket a moment falls in. */
export function bucketStart(ms: number, unit: TimeUnit): number {
  const d = new Date(ms);
  const [y, m] = [d.getUTCFullYear(), d.getUTCMonth()];
  switch (unit) {
    case 'day':
      return Date.UTC(y, m, d.getUTCDate());
    case 'week': {
      // ISO weeks start on Monday, so Sunday (day 0) belongs to the week six days behind it.
      const shift = (d.getUTCDay() + 6) % 7;
      return Date.UTC(y, m, d.getUTCDate() - shift);
    }
    case 'month':
      return Date.UTC(y, m, 1);
    case 'quarter':
      return Date.UTC(y, Math.floor(m / 3) * 3, 1);
    case 'year':
      return Date.UTC(y, 0, 1);
  }
}

/** One format per TimeUnit, because a bucket should be labelled at the resolution it was
    bucketed to: "01 Mar 2020" under a monthly bucket invites the reader to believe the point
    describes that day. Built once — `utcFormat` compiles its pattern.

    `utcFormat` and never `timeFormat`: a bucket start is a UTC midnight, and rendering it in
    local time relabels every bucket boundary for every visitor west of Greenwich. The Dataset's
    first match would read 1872-11-29 in New York. */
const UNIT_FORMAT: Record<TimeUnit, string> = {
  day: '%d %b %Y',
  week: '%d %b %Y',
  month: '%b %Y',
  quarter: 'Q%q %Y',
  year: '%Y',
};

const FORMATTERS = {
  ...(Object.fromEntries(
    Object.entries(UNIT_FORMAT).map(([unit, pattern]) => [unit, utcFormat(pattern)]),
  ) as Record<TimeUnit, (d: Date) => string>),
  /** A date column that was never bucketed — a raw timestamp on the x-axis. */
  none: utcFormat('%d %b %Y'),
};

/** Label one temporal tick. The value arrives as a Date from a time scale, as a stringified
    epoch from a band scale — a band domain is strings — and as an ISO day from a `date` column
    that was grouped by rather than bucketed, which is what `cellText` gives a date. All three
    are accepted here rather than at three call sites; a bar chart grouped by a raw date column
    labelled every tick "no value" until the third one was. */
export function temporalLabel(unit: TimeUnit | undefined, v: number | string | Date): string {
  // `Number('')` is 0, so an empty band key would otherwise be labelled 1970.
  if (v === '') return 'no value';
  const epoch = typeof v === 'string' && !/^-?\d+$/.test(v);
  const d = v instanceof Date ? v : epoch ? new Date(v) : new Date(Number(v));
  if (Number.isNaN(d.valueOf())) return 'no value';
  return FORMATTERS[unit ?? 'none'](d);
}
