/** A naive reference implementation of the Operation, written the obvious way over row objects.
    Expectations must come from an independent source — a test that recomputes the aggregation the
    way the code under test does asserts only that the code is self-consistent. This file exists
    to be slow, dumb and readable. */
import type { Aggregation, Operation } from '../../src/spec/grammar';

export type Obj = Record<string, string | number | boolean | null>;

const asNumber = (v: Obj[string]): number | null => {
  if (v === null || v === '') return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

function keep(row: Obj, op: Operation): boolean {
  return op.filters.every((f) => {
    const v = row[f.column] ?? null;
    switch (f.op) {
      case 'eq':
        return String(v) === String(f.value);
      case 'neq':
        return String(v) !== String(f.value);
      case 'gt':
        return asNumber(v) !== null && asNumber(v)! > f.value;
      case 'gte':
        return asNumber(v) !== null && asNumber(v)! >= f.value;
      case 'lt':
        return asNumber(v) !== null && asNumber(v)! < f.value;
      case 'lte':
        return asNumber(v) !== null && asNumber(v)! <= f.value;
      case 'in':
        return f.values.includes(String(v));
      case 'between': {
        const n = asNumber(v);
        return n !== null && n >= f.from && n <= f.to;
      }
      case 'dateRange':
        return v !== null && String(v) >= f.from && String(v) <= f.to;
      case 'isNull':
        return v === null || v === '';
      case 'isNotNull':
        return !(v === null || v === '');
    }
  });
}

function apply(fn: Aggregation['fn'], values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null);
  switch (fn) {
    case 'count':
      return values.length;
    case 'countDistinct':
      return new Set(real).size;
    case 'sum':
      return real.length === 0 ? null : real.reduce((a, b) => a + b, 0);
    case 'avg':
    case 'rate':
      return real.length === 0 ? null : real.reduce((a, b) => a + b, 0) / real.length;
    case 'min':
      return real.length === 0 ? null : Math.min(...real);
    case 'max':
      return real.length === 0 ? null : Math.max(...real);
    case 'median': {
      if (real.length === 0) return null;
      const s = [...real].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
    }
  }
}

/** Group and aggregate, the obvious way. No folding, no sorting, no limit — those are asserted
    separately with hand-worked examples. */
export function referenceAggregate(rows: Obj[], op: Operation): Obj[] {
  const kept = rows.filter((r) => keep(r, op));
  const groups = new Map<string, Obj[]>();
  for (const row of kept) {
    const key = JSON.stringify(op.groupBy.map((g) => row[g] ?? null));
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, members]) => {
    const keys = JSON.parse(key) as (string | null)[];
    const out: Obj = {};
    op.groupBy.forEach((g, i) => {
      const v = keys[i];
      out[g] = v === null ? null : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
    });
    for (const agg of op.aggregations) {
      out[agg.id] = apply(
        agg.fn,
        members.map((m) => (agg.column === null ? 1 : asNumber(m[agg.column] ?? null))),
      );
    }
    return out;
  });
}
