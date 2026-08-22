import type { Loader } from '../data/loader';
import { useApp } from '../store';
import { isCategoryStats, isNumberStats, type ColumnMeta, type ColumnType } from '../engine/types';

const TYPES: ColumnType[] = ['number', 'date', 'categorical', 'boolean'];

/** The DatasetSchema, shown as soon as parsing finishes and overridable per column. Inference
    is where a live demo breaks, so it is visible and correctable rather than hidden
    (DECISIONS §21.1). */
export function SchemaPanel({ loader }: { loader: Loader }) {
  const columns = useApp((s) => s.columns);
  const handle = useApp((s) => s.datasetHandle);
  const report = useApp((s) => s.parseReport);
  if (!handle) return null;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{handle.label}</h2>
        <span className="muted">
          {handle.rowCount.toLocaleString()} rows · {columns.length} columns
        </span>
      </header>

      {report && (report.skipped > 0 || report.truncated) && (
        <ParseNotice
          skipped={report.skipped}
          total={report.totalRows}
          truncated={report.truncated}
          badRows={report.badRows}
        />
      )}

      <table className="schema">
        <caption className="visually-hidden">
          Inferred column types, with confidence and null counts
        </caption>
        <thead>
          <tr>
            <th scope="col">Column</th>
            <th scope="col">Type</th>
            <th scope="col">Confidence</th>
            <th scope="col">Nulls</th>
            <th scope="col">Values</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name}>
              <th scope="row">{c.name}</th>
              <td>
                <select
                  aria-label={`Type of ${c.name}`}
                  value={c.type}
                  onChange={(e) => void loader.retype(c.name, e.target.value as ColumnType)}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {c.overridden && <span className="tag">yours</span>}
              </td>
              <td>{c.overridden ? '—' : `${Math.round(c.confidence * 100)}%`}</td>
              <td>{c.nullCount.toLocaleString()}</td>
              <td className="values">{describe(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ParseNotice({
  skipped,
  total,
  truncated,
  badRows,
}: {
  skipped: number;
  total: number;
  truncated: boolean;
  badRows: { row: number; cells: string[] }[];
}) {
  return (
    <div className="notice notice-warning">
      {truncated && <strong>Capped at 500,000 rows — the rest of the file was not read. </strong>}
      {skipped > 0 && (
        <>
          Parsed {(total - skipped).toLocaleString()} of {total.toLocaleString()} ·{' '}
          {skipped.toLocaleString()} skipped
          <details>
            <summary>First {badRows.length} malformed rows</summary>
            <ol className="bad-rows">
              {badRows.map((b) => (
                <li key={b.row}>
                  row {b.row.toLocaleString()}: <code>{b.cells.join(',')}</code>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </div>
  );
}

/** What the column holds, in the same terms the prompt will carry: the most frequent values,
    or the numeric range. */
function describe(c: ColumnMeta): string {
  if (isNumberStats(c.stats)) {
    const fmt = c.type === 'date' ? iso : num;
    return `${fmt(c.stats.min)} → ${fmt(c.stats.max)}${
      c.type === 'number' ? ` · mean ${num(c.stats.mean)}` : ''
    }`;
  }
  if (isCategoryStats(c.stats)) {
    return `${c.stats.distinct.toLocaleString()} distinct · ${c.stats.top
      .slice(0, 4)
      .map((t) => t.value)
      .join(', ')}`;
  }
  return 'no values';
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const num = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
