import { describe, expect, it } from 'vitest';
import { buildColumnStore, DICT_MAX_RATIO } from '../../src/engine/columnStore';
import { parseCsv as parse } from '../../src/engine/csv';
import { inferSchema } from '../../src/engine/infer';
import { cellText, cellValue } from '../../src/engine/types';

const build = (header: string[], rows: string[][]) =>
  buildColumnStore(header, rows, inferSchema(header, rows));

describe('ColumnStore layout', () => {
  it('holds numbers in a Float64Array with NaN as the null', () => {
    const store = build(['n'], [['1'], ['NA'], ['3'], ...Array.from({ length: 17 }, () => ['2'])]);
    const col = store.columns.get('n')!;
    expect(col.kind).toBe('number');
    expect(col.kind === 'number' && col.values).toBeInstanceOf(Float64Array);
    expect(col.kind === 'number' && Number.isNaN(col.values[1]!)).toBe(true);
  });

  it('holds dates as epoch milliseconds', () => {
    const store = build(['d'], [['1872-11-30'], ['2026-07-19']]);
    const col = store.columns.get('d')!;
    expect(col.kind === 'date' && col.values[0]).toBe(Date.UTC(1872, 10, 30));
  });

  it('holds booleans in an Int8Array with -1 as the null', () => {
    const store = build(['b'], [['TRUE'], ['FALSE'], ['NA']]);
    const col = store.columns.get('b')!;
    expect(col.kind).toBe('boolean');
    expect(col.kind === 'boolean' && [...col.values]).toEqual([1, 0, -1]);
  });

  it('dictionary-encodes a low-cardinality string column', () => {
    const rows = Array.from({ length: 100 }, (_, i) => [`team${i % 4}`]);
    const col = build(['team'], rows).columns.get('team')!;
    expect(col.kind).toBe('dict');
    expect(col.kind === 'dict' && col.values).toEqual(['team0', 'team1', 'team2', 'team3']);
    expect(col.kind === 'dict' && col.codes).toBeInstanceOf(Int32Array);
  });

  it('leaves a high-cardinality string column as plain strings', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [`id-${i}`]);
    const col = build(['id'], rows).columns.get('id')!;
    expect(col.kind).toBe('text');
  });

  it('switches layout at the documented cardinality ratio', () => {
    expect(DICT_MAX_RATIO).toBe(0.5);
  });

  it('round-trips non-ASCII values through the dictionary', () => {
    const names = ['Curaçao', 'Réunion', 'Ryūkyū', 'Székely Land', 'Găgăuzia'];
    const rows = Array.from({ length: 100 }, (_, i) => [names[i % names.length]!]);
    const store = build(['team'], rows);
    const col = store.columns.get('team')!;
    expect(col.kind).toBe('dict');
    for (let r = 0; r < rows.length; r++) expect(cellText(col, r)).toBe(rows[r]![0]);
  });

  it('records the true null count over every row, not the inference sample', () => {
    const rows = Array.from({ length: 3000 }, (_, i) => [i % 10 === 0 ? 'NA' : String(i)]);
    const store = build(['n'], rows);
    expect(store.schema.columns[0]!.nullCount).toBe(300);
  });

  it('reads a null as null through both cell accessors', () => {
    const store = build(['t'], [['a'], ['']]);
    const col = store.columns.get('t')!;
    expect(cellText(col, 1)).toBeNull();
    expect(cellValue(col, 1)).toBeNull();
  });

  it('honours a user override of the inferred ColumnType', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [String(i % 3)]);
    const schema = inferSchema(['n'], rows);
    expect(schema.columns[0]!.type).toBe('number');
    schema.columns[0] = { ...schema.columns[0]!, type: 'categorical', overridden: true };
    const col = buildColumnStore(['n'], rows, schema).columns.get('n')!;
    expect(col.kind).toBe('dict');
  });
});

describe('CSV reading', () => {
  it('strips a BOM from the first header name', () => {
    const { header } = parse('﻿date,team\n1990-01-01,Peru\n');
    expect(header).toEqual(['date', 'team']);
  });

  it('reads CRLF line endings', () => {
    const { rows } = parse('a,b\r\n1,2\r\n3,4\r\n');
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('reads a quoted field containing a comma', () => {
    // 13 tournament values and 64 city values in the real data contain commas.
    const { rows } = parse('city,country\n"Kansas City, MO",USA\n');
    expect(rows[0]).toEqual(['Kansas City, MO', 'USA']);
  });

  it('reads a quoted field containing an escaped quote', () => {
    const { rows } = parse('a\n"say ""hi"""\n');
    expect(rows[0]).toEqual(['say "hi"']);
  });

  it('reports malformed rows rather than failing the file', () => {
    const { rows, skipped, badRows } = parse('a,b\n1,2\n3\n4,5,6\n7,8\n');
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(2);
    expect(badRows[0]).toEqual({ row: 2, cells: ['3'] });
  });

  it('keeps at most the first ten malformed rows for display', () => {
    const text = 'a,b\n' + Array.from({ length: 30 }, (_, i) => String(i)).join('\n') + '\n';
    const { skipped, badRows } = parse(text);
    expect(skipped).toBe(30);
    expect(badRows).toHaveLength(10);
  });

  it('caps at the row limit and says it truncated', () => {
    const text = 'a\n' + Array.from({ length: 50 }, (_, i) => String(i)).join('\n') + '\n';
    const { rows, truncated } = parse(text, { rowLimit: 20 });
    expect(rows).toHaveLength(20);
    expect(truncated).toBe(true);
  });

  it('holds non-ASCII cells intact', () => {
    const { rows } = parse('team\nCuraçao\nRyūkyū\n');
    expect(rows.map((r) => r[0])).toEqual(['Curaçao', 'Ryūkyū']);
  });
});
