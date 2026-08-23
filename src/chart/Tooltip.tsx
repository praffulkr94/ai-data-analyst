/** One portal element for the whole chart, positioned from the pointer. Never a `<title>` per
    mark, never a React state per mark: the hover state is one value in `<AnalysisChart>` and
    this is one element in `document.body`.

    `aria-hidden`, deliberately. The chart's accessible representation is its data table; an
    `aria-live` region on hover announces a value per pixel of travel, which is spam rather than
    access (DECISIONS §15). */
import { createPortal } from 'react-dom';
import type { ResultField, ResultRow } from '../engine/result';
import { formatValue, temporalLabel } from './marks';

export type Hover = { row: ResultRow; x: number; y: number };

/** Kept clear of the pointer, and clear of the viewport edges — a tooltip that runs off the
    right of the window is worse than none. */
const EDGE = 8;

export function Tooltip({
  hover,
  xField,
  yField,
  seriesBy,
  groupField,
}: {
  hover: Hover | null;
  xField: ResultField | undefined;
  yField: ResultField | undefined;
  seriesBy: string | null;
  /** The dimension the point belongs to, when it is on neither axis. A scatter plots one measure
      against another, so nothing on the screen says which group a point is — and the group is
      the one thing the reader cannot work out from the axes. Its exact x and y are in the table.
      Undefined for every other chart type, where the x-axis already names the group. */
  groupField?: ResultField;
}) {
  if (!hover || !xField || !yField) return null;
  const { row } = hover;

  const named = groupField ?? xField;
  const raw = row[named.name] ?? null;
  const at =
    raw === null
      ? 'no value'
      : named.temporal || named.type === 'date'
        ? temporalLabel(named.unit, raw)
        : String(raw);
  const value = row[yField.name];
  const series = seriesBy === null ? null : (row[seriesBy] ?? null);

  return createPortal(
    <div
      className="chart-tooltip"
      role="presentation"
      aria-hidden="true"
      style={{
        left: Math.min(Math.max(hover.x, EDGE), window.innerWidth - EDGE),
        top: Math.max(hover.y - 12, EDGE),
      }}
    >
      <span className="tooltip-at">{at}</span>
      <span className="tooltip-value">
        {series === null ? '' : `${String(series)}: `}
        {typeof value === 'number' ? formatValue(value) : 'no value'}
      </span>
    </div>,
    document.body,
  );
}
