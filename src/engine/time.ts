/** Time bucketing. UTC throughout: the ColumnStore holds dates as epoch milliseconds with no
    timezone, and the hero Dataset spans 1872 to 2026 — a local-time floor would shift a bucket
    boundary every time the rules changed under it. */
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
