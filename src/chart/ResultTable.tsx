/** The chart's aggregated data table. This **is** the accessible representation — pointed at by
    `aria-describedby` — and it is also a visible "View as table" toggle.

    The visible toggle is the load-bearing move. It makes the accessible representation a product
    feature everybody uses, so it cannot silently rot; it is the second of the two reliefs the
    light-mode palette obliges (ADR-0012); and it doubles as the chart test harness, which is why
    charts are tested through it and never through SVG geometry. */
import { utcFormat } from 'd3-time-format';
import { memo } from 'react';
import type { AnalysisResult } from '../engine/result';
import { formatValue } from './marks';

/** Rows rendered, however many the result holds. The table is the chart's accessible
    representation and it stays that — same element, same `aria-describedby` — but a
    99,000-point scatter is 400,000 DOM nodes, which is nobody's accessibility win. Past this
    the caption says what is being shown of what (ADR-0023). */
export const TABLE_CAP = 1_000;

/** UTC, like every other reading of a bucket start: `timeFormat` here would print a different
    day to the one the bucket names for anyone west of Greenwich. */
const isoDay = utcFormat('%Y-%m-%d');

/** Memoized on its props, which is what keeps a hover cheap: the chart re-renders on every
    pointer move, and a thousand rows of four cells re-rendered per frame is the difference
    between a tooltip that follows the pointer and one that lags behind it. Safe to memoize
    where the DataTable's window is not — an AnalysisResult is an immutable value, not a
    reader over a mutating cache (ADR-0017). */
export const ResultTable = memo(function ResultTable({
  result,
  id,
  hidden,
}: {
  result: AnalysisResult;
  id: string;
  /** When hidden, the table is still in the accessibility tree — that is the whole point. */
  hidden: boolean;
}) {
  return (
    /* The clamp is on the wrapper, not the table: `visually-hidden` on a `<table>` cannot hold a
       1px box against the table's own intrinsic width, and the overflow it leaked was the whole
       document's — a thousand hidden rows dragged 24,000px of scroll behind the app. The same
       wrapper is what bounds the table when it *is* shown. */
    <div className={hidden ? 'result-scroll visually-hidden' : 'result-scroll'}>
      <table id={id} className="result-table">
        <caption>
          {result.rows.length > TABLE_CAP
            ? `The numbers behind this chart — the first ${TABLE_CAP.toLocaleString('en-US')} of ` +
              `${result.rows.length.toLocaleString('en-US')} rows`
            : 'The numbers behind this chart'}
        </caption>
        <thead>
          <tr>
            {result.fields.map((f) => (
              <th key={f.name} scope="col">
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.slice(0, TABLE_CAP).map((row, i) => (
            <tr key={i}>
              {result.fields.map((f, j) => {
                const value = row[f.name] ?? null;
                const text =
                  value === null
                    ? 'no value'
                    : f.temporal && typeof value === 'number'
                      ? isoDay(new Date(value))
                      : typeof value === 'number'
                        ? formatValue(value)
                        : value;
                return j === 0 ? (
                  <th key={f.name} scope="row">
                    {text}
                  </th>
                ) : (
                  <td key={f.name}>{text}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
