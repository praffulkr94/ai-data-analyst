import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from '@tanstack/react-table';
import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Loader } from '../data/loader';
import type { ColumnType } from '../engine/types';
import { navigate } from '../route';
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

const TYPES: ColumnType[] = ['number', 'date', 'categorical', 'boolean'];

/** The `#/data` surface: the rows, and the type of every column set in its own header.

    Metadata and rows are one surface and not two. A type is corrected next to the values that
    let you see it is wrong, which is why there is no schema panel and no settings screen —
    inference is where a live demo breaks, so it is visible and correctable rather than hidden
    (DECISIONS §21.1). Changing a type routes through `loader.retype`, which re-encodes that one
    column in the worker and rebuilds the RowIndex. */
export function DataSurface({ cache, loader }: { cache: SliceCache; loader: Loader }) {
  const handle = useApp((s) => s.datasetHandle);
  const columns = useApp((s) => s.columns);
  const report = useApp((s) => s.parseReport);
  if (!handle) return null;

  return (
    <div className="data-surface">
      <div className="data-head">
        <h2>{handle.label}</h2>
        <span className="muted">
          {handle.rowCount.toLocaleString()} rows · {columns.length} columns · types set in the
          headers
        </span>
        <span className="spacer" />
        <button type="button" onClick={() => navigate('home')}>
          Back to analysis
        </button>
      </div>
      {report && (report.skipped > 0 || report.truncated) && (
        <p className="notice notice-serious" style={{ margin: '12px 20px' }} role="status">
          {report.truncated && (
            <strong>Capped at 500,000 rows — the rest of the file was not read. </strong>
          )}
          {report.skipped > 0 && (
            <>
              Parsed {(report.totalRows - report.skipped).toLocaleString()} of{' '}
              {report.totalRows.toLocaleString()} · {report.skipped.toLocaleString()} skipped
              <details>
                <summary>First {report.badRows.length} malformed rows</summary>
                <ol className="bad-rows">
                  {report.badRows.map((b) => (
                    <li key={b.row}>
                      row {b.row.toLocaleString()}: <code>{b.cells.join(',')}</code>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
        </p>
      )}
      <Grid cache={cache} loader={loader} scrollClass="table-scroll" />
    </div>
  );
}

/** The same rows, inside the analysis card and collapsed: the selection the chart was computed
    from. Sorting or unfiltering here never changes the chart — the coupling runs one way only
    (DECISIONS §11). */
export function DrillDown({ cache }: { cache: SliceCache }) {
  const filters = useApp((s) => s.viewState.filters);
  const clearTableFilter = useApp((s) => s.clearTableFilter);

  return (
    <details className="disclosure">
      <summary>the rows behind the chart</summary>
      <div className="drill-head">
        {filters.length > 0 && (
          <span className="chip">
            <span style={{ fontFamily: 'var(--font-mono)' }}>{describe(filters)}</span>
            <button
              type="button"
              className="close"
              onClick={clearTableFilter}
              aria-label={`Show all rows, removing the filter ${describe(filters)}`}
            >
              <X />
            </button>
          </span>
        )}
        <span className="spacer">
          {filters.length > 0 ? 'the rows this chart was computed from' : 'every row'}
        </span>
        <span>sorting these rows never changes the chart</span>
      </div>
      <Grid cache={cache} scrollClass="drill-scroll" />
    </details>
  );
}

/** The virtualised grid itself. One implementation for both surfaces: the only difference is
    the height of the scroller and whether the headers carry a type control. */
function Grid({
  cache,
  loader,
  scrollClass,
}: {
  cache: SliceCache;
  loader?: Loader;
  scrollClass: string;
}) {
  const viewState = useApp((s) => s.viewState);
  const schema = useApp((s) => s.columns);
  const sortBy = useApp((s) => s.sortBy);
  const toggleColumn = useApp((s) => s.toggleColumn);

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
  const typeOf = new Map(schema.map((c) => [c.name, c.type]));

  return (
    <>
      <div
        className={scrollClass}
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
                    <div className="head-cell">
                      <button type="button" className="sort" onClick={() => sortBy(h.column.id)}>
                        {String(h.column.columnDef.header)}
                        <span aria-hidden="true" className="sort-mark">
                          {sorted === 'asc' ? ' ↑' : sorted === 'desc' ? ' ↓' : ''}
                        </span>
                      </button>
                      {loader && (
                        <TypeMenu
                          name={h.column.id}
                          type={typeOf.get(h.column.id) ?? 'categorical'}
                          onPick={(t) => void loader.retype(h.column.id, t)}
                          onHide={() => toggleColumn(h.column.id)}
                        />
                      )}
                    </div>
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
      <p className="table-foot" aria-live="polite">
        <span>
          rows {(first + 1).toLocaleString()}–{last.toLocaleString()} of{' '}
          {rowCount.toLocaleString()} · virtualised at {ROW_HEIGHT}px
        </span>
        {loader && <span>· changing a type re-runs inference on that column only</span>}
        {viewState.hidden.length > 0 && <span>· {viewState.hidden.length} hidden</span>}
      </p>
    </>
  );
}

/** The type control, as a chip in the header.

    `<details name>` is the whole menu: the shared name makes it an exclusive group, so opening
    one header's types shuts every other, and there is no focus trap because focus never left the
    page. Light-dismiss is the one thing the native element does not give, and `useLightDismiss`
    adds it once for every named menu on the page — see that hook for why it is a `pointerdown`.

    Still a disclosure rather than a `role="menu"`: no arrow-key roving, no `aria-haspopup`. The
    items are ordinary buttons, so a screen reader gets a summary and a list it can tab through,
    which is honest about what this is.
    ponytail: if it ever needs to behave like a real menu — arrow keys, typeahead, focus
    returning to the trigger on every path — that is the point to take Radix's Dropdown Menu
    rather than grow the keyboard handling here. */
function TypeMenu({
  name,
  type,
  onPick,
  onHide,
}: {
  name: string;
  type: ColumnType;
  onPick: (type: ColumnType) => void;
  onHide: () => void;
}) {
  const shut = (e: { currentTarget: HTMLElement }) => {
    e.currentTarget.closest('details')?.removeAttribute('open');
  };

  return (
    <details className="type-menu" name="column-type">
      <summary aria-label={`Type of ${name}: ${type}`}>
        {type}
        <ChevronDown />
      </summary>
      <ul>
        {TYPES.map((t) => (
          <li key={t}>
            <button
              type="button"
              onClick={(e) => {
                shut(e);
                onPick(t);
              }}
            >
              <span className="tick" aria-hidden="true">
                {t === type && <Check />}
              </span>
              {t}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={(e) => {
              shut(e);
              onHide();
            }}
          >
            <span className="tick" aria-hidden="true" />
            hide column
          </button>
        </li>
      </ul>
    </details>
  );
}

const SYMBOL: Record<'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte', string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
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
          return `${f.column} ${f.from}–${f.to}`;
        case 'isNull':
          return `${f.column} is empty`;
        case 'isNotNull':
          return `${f.column} is not empty`;
        default:
          return `${f.column} ${SYMBOL[f.op]} ${f.value}`;
      }
    })
    .join(' · ');

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
