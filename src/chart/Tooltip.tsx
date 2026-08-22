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
}: {
  hover: Hover | null;
  xField: ResultField | undefined;
  yField: ResultField | undefined;
  seriesBy: string | null;
}) {
  if (!hover || !xField || !yField) return null;
  const { row } = hover;

  const raw = row[xField.name] ?? null;
  const at =
    raw === null
      ? 'no value'
      : xField.temporal || xField.type === 'date'
        ? temporalLabel(xField.unit, raw)
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
