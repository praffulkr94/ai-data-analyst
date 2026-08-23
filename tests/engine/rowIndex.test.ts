import { describe, expect, it } from 'vitest';
import { buildColumnStore } from '../../src/engine/columnStore';
import { inferSchema } from '../../src/engine/infer';
import { buildRowIndex, readSlice, type ViewState } from '../../src/engine/rowIndex';

const store = (header: string[], rows: string[][]) =>
  buildColumnStore(header, rows, inferSchema(header, rows));

const view = (over: Partial<ViewState> = {}): ViewState => ({ sort: null, filters: [], hidden: [], ...over });

/** Reads one column back in RowIndex order, which is what the table renders. */
const ordered = (header: string[], rows: string[][], v: ViewState, col = 0) => {
  const s = store(header, rows);
  const index = buildRowIndex(s, v);
  return readSlice(s, index, 0, index.length, header.filter((h) => !v.hidden.includes(h))).map(
    (r) => r[col],
  );
};

describe('a filtered RowIndex', () => {
  const rows = [
    ['Scotland', '0'],
    ['England', '4'],
    ['Scotland', '2'],
    ['England', '2'],
  ];

  it('keeps only the rows the filters select, in file order', () => {
    const out = ordered(
      ['team', 'n'],
      rows,
      view({ filters: [{ op: 'eq', column: 'team', value: 'Scotland' }] }),
      1,
    );
    expect(out).toEqual(['0', '2']);
  });

  it('applies every filter, and sorts what survives them', () => {
    const out = ordered(
      ['team', 'n'],
      rows,
      view({
        filters: [
          { op: 'neq', column: 'team', value: 'Scotland' },
          { op: 'gte', column: 'n', value: 2 },
        ],
        sort: { column: 'n', dir: 'desc' },
      }),
      1,
    );
    // Both England rows pass, ordered by the sort rather than by the file.
    expect(out).toEqual(['4', '2']);
  });

  it('is the whole Dataset when there are no filters', () => {
    expect(ordered(['team', 'n'], rows, view(), 1)).toEqual(['0', '4', '2', '2']);
  });
});

describe('RowIndex ordering', () => {
  it('is the natural row order when nothing is sorted', () => {
    expect(ordered(['a'], [['3'], ['1'], ['2']], view())).toEqual(['3', '1', '2']);
  });

  it('sorts numbers by value rather than by their text', () => {
    // The text ordering would put 100 before 9. Twenty rows so the column types as a number.
    const rows = [['100'], ['9'], ['20'], ...Array.from({ length: 17 }, () => ['50'])];
    const out = ordered(['n'], rows, view({ sort: { column: 'n', dir: 'asc' } }));
    expect(out.slice(0, 3)).toEqual(['9', '20', '50']);
    expect(out.at(-1)).toBe('100');
  });

  it('sorts text with locale-correct ordering', () => {
    // Hand-worked against the Unicode collation a person would expect: Curaçao sorts as if
    // spelled Curacao, so it precedes Cyprus; Réunion sorts under R, not after Z.
    const names = ['Réunion', 'Cyprus', 'Curaçao', 'Zambia', 'Ryūkyū'];
    const rows = names.flatMap((n) => Array.from({ length: 4 }, () => [n]));
    const out = ordered(['team'], rows, view({ sort: { column: 'team', dir: 'asc' } }));
    expect([...new Set(out)]).toEqual(['Curaçao', 'Cyprus', 'Réunion', 'Ryūkyū', 'Zambia']);
  });

  it('reverses on descending', () => {
    const rows = ['b', 'a', 'c'].flatMap((n) => Array.from({ length: 4 }, () => [n]));
    const out = ordered(['t'], rows, view({ sort: { column: 't', dir: 'desc' } }));
    expect([...new Set(out)]).toEqual(['c', 'b', 'a']);
  });

  it('sorts nulls last in both directions, because a null is not a small value', () => {
    const rows = [['5'], ['NA'], ['1'], ...Array.from({ length: 17 }, () => ['3'])];
    const asc = ordered(['n'], rows, view({ sort: { column: 'n', dir: 'asc' } }));
    const desc = ordered(['n'], rows, view({ sort: { column: 'n', dir: 'desc' } }));
    expect(asc.at(-1)).toBeNull();
    expect(desc.at(-1)).toBeNull();
  });

  it('sorts booleans FALSE before TRUE', () => {
    const rows = [['TRUE'], ['FALSE'], ['TRUE']];
    expect(ordered(['b'], rows, view({ sort: { column: 'b', dir: 'asc' } }))).toEqual([
      'FALSE',
      'TRUE',
      'TRUE',
    ]);
  });

  it('sorts dates chronologically across the whole 1872 to 2026 span', () => {
    const rows = [['2026-07-19'], ['1872-11-30'], ['1950-06-24']];
    expect(ordered(['d'], rows, view({ sort: { column: 'd', dir: 'asc' } }))).toEqual([
      '1872-11-30',
      '1950-06-24',
      '2026-07-19',
    ]);
  });

  it('ignores a sort on a column that does not exist rather than throwing', () => {
    expect(ordered(['a'], [['1'], ['2']], view({ sort: { column: 'revenu', dir: 'asc' } }))).toEqual(
      ['1', '2'],
    );
  });

  it('is a stable ordering, so equal rows keep their file order', () => {
    const rows = [['b', '1'], ['a', '2'], ['b', '3'], ['a', '4']];
    const s = store(['k', 'seq'], rows);
    const index = buildRowIndex(s, view({ sort: { column: 'k', dir: 'asc' } }));
    expect(readSlice(s, index, 0, 4, ['k', 'seq']).map((r) => r[1])).toEqual(['2', '4', '1', '3']);
  });
});

describe('RowSlices', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => [String(i), `t${i % 3}`]);

  it('returns a contiguous run of rows at the requested offset', () => {
    const s = store(['n', 't'], rows);
    const index = buildRowIndex(s, view());
    const slice = readSlice(s, index, 200, 3, ['n', 't']);
    expect(slice.map((r) => r[0])).toEqual(['200', '201', '202']);
  });

  it('returns fewer rows than asked for at the end rather than padding', () => {
    const s = store(['n', 't'], rows);
    const index = buildRowIndex(s, view());
    expect(readSlice(s, index, 998, 100, ['n'])).toHaveLength(2);
  });

  it('returns nothing for an offset past the end', () => {
    const s = store(['n', 't'], rows);
    expect(readSlice(s, buildRowIndex(s, view()), 5000, 10, ['n'])).toEqual([]);
  });

  it('returns only the visible columns, in the order the view lists them', () => {
    const s = store(['n', 't'], rows);
    const index = buildRowIndex(s, view({ hidden: ['n'] }));
    expect(readSlice(s, index, 0, 1, ['t'])).toEqual([['t0']]);
  });
});
