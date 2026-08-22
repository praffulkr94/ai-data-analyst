/** Value-level parsing: the null tokens, and the number / date / boolean readers that the
    inference rules and the ColumnStore encoder both use. One place per format. */

/** A string that means "no value" rather than a value. Compared case-insensitively.
    Fixed by DECISIONS §A6 finding 4 — do not extend without a reason from real data. */
export const NULL_TOKENS = ['', 'na', 'n/a', '-', '--', 'null'] as const;

const NULL_SET = new Set<string>(NULL_TOKENS);

export function isNullToken(raw: string): boolean {
  return NULL_SET.has(raw.trim().toLowerCase());
}

/** Plain decimal, with an optional sign and exponent. */
const PLAIN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** Thousands-grouped, e.g. `1,234` and `1,000,000`. `1,23` is deliberately not a number —
    a comma in the wrong place is a formatting error, not a value to guess at. */
const GROUPED = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/** `NaN` for anything that is not a number — the same sentinel the ColumnStore uses. */
export function parseNumber(raw: string): number {
  const s = raw.trim();
  if (PLAIN.test(s)) return Number(s);
  if (GROUPED.test(s)) return Number(s.replace(/,/g, ''));
  return NaN;
}

export function parseBoolean(raw: string): 1 | 0 | -1 {
  const s = raw.trim().toLowerCase();
  if (s === 'true') return 1;
  if (s === 'false') return 0;
  return -1;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const SEPARATED = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;

/** How a column's separated dates are ordered. The hero Dataset is 100% ISO across 155 years,
    so this only matters for `messy.csv`. */
export type DateOrder = 'iso' | 'dmy' | 'mdy';

function utc(y: number, m: number, d: number): number {
  if (m < 1 || m > 12 || d < 1 || d > 31) return NaN;
  const t = Date.UTC(y, m - 1, d);
  // Rejects 2024-02-31 and friends, which Date.UTC would silently roll forward.
  const back = new Date(t);
  return back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? t : NaN;
}

/** Epoch milliseconds, or `NaN`. */
export function parseDate(raw: string, order: DateOrder = 'iso'): number {
  const s = raw.trim();
  const iso = ISO.exec(s);
  if (iso) {
    const day = utc(+iso[1]!, +iso[2]!, +iso[3]!);
    if (Number.isNaN(day) || !iso[4]) return day;
    const withTime = Date.parse(s);
    return Number.isNaN(withTime) ? day : withTime;
  }
  if (order === 'iso') return NaN;
  const sep = SEPARATED.exec(s);
  if (!sep) return NaN;
  const [a, b, y] = [+sep[1]!, +sep[2]!, +sep[3]!];
  return order === 'dmy' ? utc(y, b, a) : utc(y, a, b);
}

/** Which separated-date order the sample supports, or `null` if none does. A value whose first
    component exceeds 12 can only be day-first; one whose second does can only be month-first.
    Both, or neither with an ambiguous sample, and we decline rather than guess. */
export function detectDateOrder(values: readonly string[]): DateOrder | null {
  let iso = 0;
  let separated = 0;
  let dmyOnly = false;
  let mdyOnly = false;
  for (const raw of values) {
    const s = raw.trim();
    if (ISO.test(s)) {
      iso++;
      continue;
    }
    const sep = SEPARATED.exec(s);
    if (!sep) continue;
    separated++;
    if (+sep[1]! > 12) dmyOnly = true;
    if (+sep[2]! > 12) mdyOnly = true;
  }
  if (dmyOnly && mdyOnly) return null; // The column mixes both. Not a date column.
  if (separated === 0) return iso > 0 ? 'iso' : null;
  if (dmyOnly) return 'dmy';
  if (mdyOnly) return 'mdy';
  return null; // Ambiguous, e.g. every value is 03/04/2024. Guessing here corrupts data.
}
