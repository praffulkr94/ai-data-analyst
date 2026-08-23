import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from '@tanstack/react-table';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Filter } from '../spec/grammar';
import { useApp } from '../store';
import type { Row, SliceCache } from '../table/sliceCache';
import { useRowSlice } from '../table/useRowSlice';

/** Fixed row height is mandatory. Dynamic measurement plus async data is where this design
    dies: a RowSlice arriving after a fling would change the height of rows above the viewport
    and the scroll position would jump. */
const ROW_HEIGHT = 30;
/** Rows rendered beyond the viewport, so a scroll of one row does not expose a skeleton. */
const OVERSCAN = 8;

export function DataTable({ cache }: { cache: SliceCache }) {
  const viewState = useApp((s) => s.viewState);
  const schema = useApp((s) => s.columns);
  const sortBy = useApp((s) => s.sortBy);
  const toggleColumn = useApp((s) => s.toggleColumn);
  const clearTableFilter = useApp((s) => s.clearTableFilter);

  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  // The worker builds a RowIndex for every ViewState. Sorting 49,520 locale-aware strings is
  // the expensive work this architecture exists to keep off the main thread.
  useEffect(() => {
    void cache.setView(viewState);
  }, [cache, viewState]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // ResizeObserver entries are the only measurement source.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const count = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const { revision, rowCount, columns, row } = useRowSlice(cache, first, first + count);
  const last = Math.min(rowCount, first + count);

  /** Only the rows on screen — about thirty of them, whatever the Dataset holds. A row that has
      not arrived is `null` and renders as a skeleton. */
  const visible = useMemo(
    () => Array.from({ length: Math.max(0, last - first) }, (_, i) => row(first + i)),
    // `row` is a stable reader over a cache that mutates, so the revision is what says a
    // RowSlice has landed and these rows are worth reading again.
    [row, first, last, revision],
  );

  /** The RowSlice names its own columns, which is the authoritative row shape: a hidden column
      is absent from the slice, so cell positions shift and must not be read off the schema.
      Before the first RowSlice lands the schema order is the best guess available. */
  const names = columns.length > 0 ? columns : schema.map((c) => c.name);
  const key = names.join(' ');
  const defs = useMemo<ColumnDef<Row | null>[]>(
    () =>
      key
        .split(' ')
        .map((name, i) => ({ id: name, header: name, accessorFn: (r) => r?.[i] ?? null })),
    [key],
  );

  const columnVisibility = useMemo<VisibilityState>(
    () => Object.fromEntries(viewState.hidden.map((c) => [c, false])),
    [viewState.hidden],
  );

  // Fully manual: TanStack holds header and visibility state and nothing else. Sorting,
  // filtering and pagination are the worker's, so every row model but the core one is absent.
  const table = useReactTable({
    data: visible,
    columns: defs,
    state: { columnVisibility },
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const headers = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <section className="table-wrap">
      <div className="table-head">
        <ColumnMenu
          schema={schema.map((c) => c.name)}
          hidden={viewState.hidden}
          onToggle={toggleColumn}
        />
        {/* The active Analysis's filters, as one removable chip: these are the rows its chart
            was computed from. Removing it widens the table and leaves the Analysis alone —
            table sort and filter never drive the chart, only ever the other way. */}
        {viewState.filters.length > 0 && (
          <button
            type="button"
            className="chip chip-button"
            onClick={clearTableFilter}
            aria-label={`Show all rows, removing the filter ${describe(viewState.filters)}`}
          >
            {describe(viewState.filters)} &times;
          </button>
        )}
      </div>
      <div
        className="table-scroll"
        ref={scroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table className="grid">
          <thead>
            <tr>
              {headers.map((h) => {
                const sorted = viewState.sort?.column === h.column.id ? viewState.sort.dir : null;
                return (
                  <th key={h.id} scope="col" aria-sort={ariaSort(sorted)}>
                    <button type="button" onClick={() => sortBy(h.column.id)}>
                      {String(h.column.columnDef.header)}
                      <span aria-hidden="true" className="sort-mark">
                        {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : ''}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Spacer rows carry the scroll height. A transform on the row group would be the
                smaller diff, but a spacer is a real table row: it participates in layout, so
                the sticky header and the fixed column widths keep working. */}
            <Spacer height={first * ROW_HEIGHT} span={headers.length} />
            {table.getRowModel().rows.map((r, i) => (
              <tr key={first + i}>
                {r.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {visible[i] === null ? (
                      <span className="skeleton" aria-hidden="true" />
                    ) : (
                      ((cell.getValue() as string | null) ?? <span className="null-cell">&mdash;</span>)
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <Spacer height={(rowCount - last) * ROW_HEIGHT} span={headers.length} />
          </tbody>
        </table>
      </div>
      <p className="table-foot muted" aria-live="polite">
        {rowCount.toLocaleString()} rows &middot; showing {(first + 1).toLocaleString()}&ndash;
        {last.toLocaleString()}
      </p>
    </section>
  );
}

const SYMBOL: Record<'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte', string> = {
  eq: '=',
  neq: '\u2260',
  gt: '>',
  gte: '\u2265',
  lt: '<',
  lte: '\u2264',
};

/** The filters as the chip's text. The Operation's own words, so a visitor can see that the
    table is showing the same selection the chart was drawn from. */
const describe = (filters: Filter[]): string =>
  filters
    .map((f) => {
      switch (f.op) {
        case 'in':
          return `${f.column} in ${f.values.join(', ')}`;
        case 'between':
        case 'dateRange':
          return `${f.column} ${f.from}\u2013${f.to}`;
        case 'isNull':
          return `${f.column} is empty`;
        case 'isNotNull':
          return `${f.column} is not empty`;
        default:
          return `${f.column} ${SYMBOL[f.op]} ${f.value}`;
      }
    })
    .join(' \u00b7 ');

/** Occupies the height of the rows that are not rendered. */
function Spacer({ height, span }: { height: number; span: number }) {
  if (height <= 0) return null;
  return (
    <tr aria-hidden="true" style={{ height }}>
      <td colSpan={span} className="spacer" />
    </tr>
  );
}

const ariaSort = (dir: 'asc' | 'desc' | null) =>
  dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';

function ColumnMenu({
  schema,
  hidden,
  onToggle,
}: {
  schema: string[];
  hidden: string[];
  onToggle: (name: string) => void;
}) {
  return (
    <details className="column-menu">
      <summary>
        Columns
        {hidden.length > 0 && <span className="muted"> &middot; {hidden.length} hidden</span>}
      </summary>
      <ul>
        {schema.map((name) => (
          <li key={name}>
            <label>
              <input
                type="checkbox"
                checked={!hidden.includes(name)}
                onChange={() => onToggle(name)}
              />
              {name}
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
