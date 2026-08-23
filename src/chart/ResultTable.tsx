/** The chart's aggregated data table. This **is** the accessible representation — pointed at by
    `aria-describedby` — and it is also a visible "View as table" toggle.

    The visible toggle is the load-bearing move. It makes the accessible representation a product
    feature everybody uses, so it cannot silently rot; it is the second of the two reliefs the
    light-mode palette obliges (ADR-0012); and it doubles as the chart test harness, which is why
    charts are tested through it and never through SVG geometry. */
import { utcFormat } from 'd3-time-format';
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

export function ResultTable({
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
    <table id={id} className={hidden ? 'result-table visually-hidden' : 'result-table'}>
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
  );
}
