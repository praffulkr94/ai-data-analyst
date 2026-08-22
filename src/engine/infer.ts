/** Type inference. The demo-killer, per DECISIONS §21.1 — so the rules are explicit, sampled,
    confidence-carrying and overridable, and every branch is a unit test. */
import type { CategoryStats, ColumnMeta, ColumnType, DatasetSchema, NumberStats } from './types';
import {
  detectDateOrder,
  isNullToken,
  NULL_TOKENS,
  parseBoolean,
  parseDate,
  parseNumber,
  type DateOrder,
} from './values';

export { NULL_TOKENS };

/** A column at least this share numeric, with every remaining value a recognised null token,
    is a number with nulls — never categorical. DECISIONS §A6 finding 4. The denominator is
    every sampled value, null tokens included, exactly as the rule is written. */
const NUMBER_THRESHOLD = 0.95;
/** What the prompt budget allows per categorical column (Implementation Decisions, Prompt budget). */
const TOP_VALUES = 8;

export type InferOptions = {
  /** Rows read from the head of the file. */
  headN?: number;
  /** Rows drawn at random from the rest. Never the head alone — see DECISIONS §21.1. */
  randomN?: number;
  random?: () => number;
};

/** Row indices to infer from: the first `headN`, plus `randomN` drawn from beyond them. */
export function sampleIndices(
  rowCount: number,
  { headN = 500, randomN = 500, random = Math.random }: InferOptions = {},
): number[] {
  if (rowCount <= headN + randomN) return Array.from({ length: rowCount }, (_, i) => i);
  const picked = new Set<number>();
  for (let i = 0; i < headN; i++) picked.add(i);
  const tail = rowCount - headN;
  for (let i = 0; i < randomN; i++) picked.add(headN + Math.floor(random() * tail));
  return [...picked].sort((a, b) => a - b);
}

type Counts = {
  values: string[];
  nulls: number;
  numbers: number;
  booleans: number;
  dates: number;
  dateOrder: DateOrder | null;
};

function tally(values: string[]): Counts {
  let nulls = 0;
  let numbers = 0;
  let booleans = 0;
  const dateOrder = detectDateOrder(values);
  let dates = 0;
  for (const raw of values) {
    if (isNullToken(raw)) {
      nulls++;
      continue;
    }
    if (!Number.isNaN(parseNumber(raw))) numbers++;
    if (parseBoolean(raw) >= 0) booleans++;
    if (dateOrder && !Number.isNaN(parseDate(raw, dateOrder))) dates++;
  }
  return { values, nulls, numbers, booleans, dates, dateOrder };
}

/** The rules, in order. Each returns the winning ColumnType or nothing. */
function decide(c: Counts): ColumnType {
  const total = c.values.length;
  const real = total - c.nulls;

  // Boolean before number: `TRUE`/`FALSE` is one column, not two Categories. DECISIONS §A6.3.
  if (real > 0 && c.booleans === real) return 'boolean';

  // Date before number so a four-digit year still reads as a number, not a date.
  if (real > 0 && c.dates === real) return 'date';

  // Number with nulls beats categorical.
  if (real > 0 && c.numbers === real && total > 0 && c.numbers / total >= NUMBER_THRESHOLD) {
    return 'number';
  }

  return 'categorical';
}

function numberStats(values: string[], read: (raw: string) => number): NumberStats | null {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (const raw of values) {
    if (isNullToken(raw)) continue;
    const v = read(raw);
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return n === 0 ? null : { min, max, mean: sum / n };
}

function categoryStats(values: string[]): CategoryStats {
  const counts = new Map<string, number>();
  for (const raw of values) {
    if (isNullToken(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  const top = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_VALUES)
    .map(([value, count]) => ({ value, count }));
  return { distinct: counts.size, top };
}

/** Infer one column from its sampled values. `nullCount` is scaled to the sample, so it is an
    estimate on a sampled file and exact on a fully-read one; the ColumnStore records the true
    count when it encodes. */
export function inferColumn(name: string, values: string[]): ColumnMeta {
  const counts = tally(values);
  const type = decide(counts);
  const total = counts.values.length;
  const matched =
    type === 'boolean'
      ? counts.booleans
      : type === 'date'
        ? counts.dates
        : type === 'number'
          ? counts.numbers
          : total - counts.nulls;
  return {
    name,
    type,
    confidence: total === 0 ? 0 : matched / total,
    nullCount: counts.nulls,
    stats:
      type === 'number'
        ? numberStats(values, parseNumber)
        : type === 'date'
          ? numberStats(values, (raw) => parseDate(raw, counts.dateOrder ?? 'iso'))
          : categoryStats(values),
  };
}

/** The order in which a column's separated dates are read. The encoder needs the same answer
    the inference reached, so it is recomputed from the same sample rather than stored on the
    ColumnMeta, which is a UI-facing description. */
export function columnDateOrder(values: string[]): DateOrder {
  return detectDateOrder(values) ?? 'iso';
}

export function inferSchema(
  header: string[],
  rows: readonly string[][],
  opts: InferOptions = {},
): DatasetSchema {
  const indices = sampleIndices(rows.length, opts);
  return {
    columns: header.map((name, col) => inferColumn(name, indices.map((r) => rows[r]?.[col] ?? ''))),
  };
}
