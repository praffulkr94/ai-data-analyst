/** The shipped Datasets, read as they ship.

    `scripts/build-datasets.mjs` is committed and re-runnable so every derived count is auditable,
    and the sample notes quote those counts to a visitor who has not run it. This is what keeps
    the two honest: the numbers below are read out of `public/data/`, and the note beside each
    sample has to agree with them. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sampleById } from '../../src/data/samples';
import { buildColumnStore } from '../../src/engine/columnStore';
import { parseCsv } from '../../src/engine/csv';
import { inferSchema } from '../../src/engine/infer';
import type { ColumnMeta } from '../../src/engine/types';

function load(id: string) {
  const sample = sampleById(id)!;
  const text = gunzipSync(readFileSync(`public/data/${sample.filename}`)).toString('utf8');
  const parsed = parseCsv(text);
  const schema = inferSchema(parsed.header, parsed.rows);
  const store = buildColumnStore(parsed.header, parsed.rows, schema);
  const column = (name: string): ColumnMeta => store.schema.columns.find((c) => c.name === name)!;
  return { sample, parsed, column };
}

describe('goals.csv, the inference showcase', () => {
  const { sample, parsed, column } = load('goals');

  it('holds the row count the picker promises, with nothing skipped', () => {
    expect(parsed.rows.length).toBe(47_914);
    expect(sample.rowCount).toBe(parsed.rows.length);
    expect(parsed.skipped).toBe(0);
  });

  /** The whole point of the file. Naive inference types this categorical because 254 values are
      the literal string NA, and "average goal minute" then becomes impossible with no recovery.
      Both numbers are in the note beside the sample. */
  it('types minute as a number with 254 nulls rather than as text', () => {
    expect(column('minute').type).toBe('number');
    expect(column('minute').nullCount).toBe(254);
    expect(sample.note).toContain('254');
  });

  it('carries the 79 duplicate rows the note claims', () => {
    const lines = parsed.rows.map((r) => r.join(''));
    expect(lines.length - new Set(lines).size).toBe(79);
    expect(sample.note).toContain('79');
  });
});

describe('messy.csv, dirtied on purpose', () => {
  const { sample, parsed, column } = load('messy');

  it('loads anyway, and counts the rows it could not read', () => {
    expect(parsed.rows.length).toBe(1_987);
    expect(parsed.skipped).toBe(34);
    expect(parsed.rows.length + parsed.skipped).toBe(sample.rowCount);
    // Ten of them kept for display, whatever the total.
    expect(parsed.badRows).toHaveLength(10);
  });

  it('reads a header written with a BOM', () => {
    expect(parsed.header[0]).toBe('date');
  });

  /** Each of these would be typed wrongly by a rule the DatasetSchema deliberately does not use:
      dates that are not all ISO, numbers spelled with a comma, numbers carrying null tokens, and
      TRUE/FALSE read as two Categories. */
  it('types every dirtied column the way the rules say, not the way the dirt suggests', () => {
    expect(column('date').type).toBe('date');
    expect(column('attendance').type).toBe('number');
    expect(column('home_score').type).toBe('number');
    expect(column('neutral').type).toBe('boolean');
    expect(column('attendance').nullCount).toBeGreaterThan(0);
    expect(column('home_score').nullCount).toBeGreaterThan(0);
  });

  it('reads the day-first dates as days rather than losing them', () => {
    const dates = parsed.rows.map((r) => r[0]!);
    expect(dates.some((d) => d.includes('/'))).toBe(true);
    // Every value parsed, so the mixed format cost no rows.
    expect(column('date').nullCount).toBe(0);
  });
});
