/** Layer three of three: dumb marks. Each takes the scales and the rows and draws. There is no
    `<Chart type="bar">` mega-component with forty props — a chart is composed of these under
    `<ChartFrame>`, which is what keeps them dumb. */
import { format } from 'd3-format';
import { area, line } from 'd3-shape';
import { utcFormat } from 'd3-time-format';
import { POINT_CAP } from '../engine/operation';
import type { ResultField, ResultRow } from '../engine/result';
import type { ChartType, TimeUnit } from '../spec/grammar';
import type { Scales } from './useScales';
import type { ChartDimensions } from './useChartDimensions';

/** What each chart type can draw and still be read. A bar has to be wide enough to compare and
    to carry its own label, which is why its cap is two orders of magnitude below a line's: at
    900px, 60 bands are 15px each and 800 would be under a pixel. A line needs one pixel per
    point, so the point cap is its only limit. Scatter's cap is where SVG gives way to canvas in
    M8. */
export const MARK_CAP: Record<ChartType, number> = {
  bar: 60,
  line: POINT_CAP,
  area: POINT_CAP,
  scatter: 5_000,
};

/** Six slots, fixed order, never cycled. Read from the design tokens so light and dark agree. */
export const SERIES_SLOTS = 6;
export const seriesColor = (slot: number) => `var(--series-${(slot % SERIES_SLOTS) + 1})`;

const decimal = format(',.2~f');
const si = format('~s');

/** Values are shown in full: this is a tool for checking numbers, and 43,259 abbreviated to
    "43.259k" is harder to read than the number it replaced. */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? v.toLocaleString('en-US') : decimal(v);
}

/** Axis ticks are the one place abbreviation earns its keep — they repeat, and they are read as
    a scale rather than as a value. */
export const formatAxisValue = (v: number) =>
  Math.abs(v) >= 10_000 ? si(v) : formatValue(v);

/* ---- temporal labels ----------------------------------------------------------------- */

/** One format per TimeUnit, because a bucket should be labelled at the resolution it was
    bucketed to: "01 Mar 2020" under a monthly bucket invites the reader to believe the point
    describes that day. Built once — `utcFormat` compiles its pattern.

    `utcFormat` and never `timeFormat`: a bucket start is a UTC midnight, and rendering it in
    local time relabels every bucket boundary for every visitor west of Greenwich. The Dataset's
    first match would read 1872-11-29 in New York. */
const UNIT_FORMAT: Record<TimeUnit, string> = {
  day: '%d %b %Y',
  week: '%d %b %Y',
  month: '%b %Y',
  quarter: 'Q%q %Y',
  year: '%Y',
};

const FORMATTERS = {
  ...(Object.fromEntries(
    Object.entries(UNIT_FORMAT).map(([unit, pattern]) => [unit, utcFormat(pattern)]),
  ) as Record<TimeUnit, (d: Date) => string>),
  /** A date column that was never bucketed — a raw timestamp on the x-axis. */
  none: utcFormat('%d %b %Y'),
};

/** Label one temporal tick. The value arrives as a Date from a time scale and as a stringified
    epoch from a band scale, because a band domain is strings — so both are accepted here rather
    than at two call sites. */
export function temporalLabel(unit: TimeUnit | undefined, v: number | string | Date): string {
  // `Number('')` is 0, so an empty band key would otherwise be labelled 1970.
  if (v === '') return 'no value';
  const d = v instanceof Date ? v : new Date(Number(v));
  if (Number.isNaN(d.valueOf())) return 'no value';
  return FORMATTERS[unit ?? 'none'](d);
}

/* ---- axes and grid, from scale.ticks() as React elements ----------------------------- */

export function XAxis({
  scales,
  dimensions,
  field,
}: {
  scales: Scales;
  dimensions: ChartDimensions;
  /** The result field on the x-axis. It carries whether the axis is temporal and, if it came
      from a `timeBucket`, at what resolution — so the axis never has to guess either. */
  field: ResultField | undefined;
}) {
  const { x } = scales;
  const { innerHeight, innerWidth } = dimensions;

  /** A band scale's ticks are its categories, thinned until the labels stop colliding. */
  const ticks =
    x.kind === 'band'
      ? thin(x.scale.domain(), innerWidth).map((v) => ({
          value: v,
          at: (x.scale(v) ?? 0) + x.scale.bandwidth() / 2,
        }))
      : x.scale.ticks(Math.max(2, Math.floor(innerWidth / 80))).map((v: number | Date) => ({
          value: v,
          at: x.kind === 'time' ? x.scale(v as Date) : (x.scale as (n: number) => number)(v as number),
        }));

  const temporal = field?.temporal === true || field?.type === 'date' || x.kind === 'time';
  const label = (v: number | Date | string) =>
    temporal ? temporalLabel(field?.unit, v) : String(v);

  // How many characters fit in one band, at roughly 6.2px per character at 11px. Truncating to a
  // fixed length instead lets neighbouring labels collide as soon as the bands narrow.
  const fits = x.kind === 'band' ? Math.max(4, Math.floor(x.scale.bandwidth() / 6.2)) : 14;

  return (
    <g transform={`translate(0,${innerHeight})`} className="axis" aria-hidden="true">
      <line x2={innerWidth} />
      {ticks.map((t) => (
        <g key={String(t.value)} transform={`translate(${t.at},0)`}>
          <line y2={4} />
          <text y={16} textAnchor="middle">
            {truncate(label(t.value), fits)}
          </text>
        </g>
      ))}
    </g>
  );
}

export function YAxis({ scales, dimensions }: { scales: Scales; dimensions: ChartDimensions }) {
  const ticks = scales.y.ticks(Math.max(2, Math.floor(dimensions.innerHeight / 44)));
  return (
    <g className="axis" aria-hidden="true">
      {ticks.map((t) => (
        <text key={t} x={-8} y={scales.y(t)} dy="0.32em" textAnchor="end">
          {formatAxisValue(t)}
        </text>
      ))}
    </g>
  );
}

export function Grid({ scales, dimensions }: { scales: Scales; dimensions: ChartDimensions }) {
  const ticks = scales.y.ticks(Math.max(2, Math.floor(dimensions.innerHeight / 44)));
  return (
    <g className="grid" aria-hidden="true">
      {ticks.map((t) => (
        <line key={t} x2={dimensions.innerWidth} y1={scales.y(t)} y2={scales.y(t)} />
      ))}
    </g>
  );
}

/* ---- bars ---------------------------------------------------------------------------- */

export type MarkProps = {
  rows: ResultRow[];
  x: string;
  y: string;
  scales: Scales;
  dimensions: ChartDimensions;
  /** The palette slot this Series holds. One number per mark component, not per row: a Series
      keeps its colour for as long as it keeps its position. */
  slot?: number;
  /** Which of how many Series this is, so grouped bars can share a band. */
  subIndex?: number;
  subCount?: number;
  /** The Series name, drawn on the mark itself. Direct labelling is what keeps the Series
      identifiable without reading its colour (ADR-0012). Omitted for a single Series. */
  label?: string;
  onHover?: (row: ResultRow | null, at: { x: number; y: number }) => void;
  /** Roving tabindex support: which mark is focusable, and what to call when it is entered. */
  focusIndex?: number;
  onFocusIndex?: (index: number) => void;
  /** How much of a line to draw, 0 to 1. Driven by the transition hook, which returns 1 at
      once when the visitor asked for reduced motion. */
  reveal?: number;
};

export function Bars({
  rows,
  x,
  y,
  scales,
  dimensions,
  slot = 0,
  subIndex = 0,
  subCount = 1,
  label,
  onHover,
  focusIndex,
  onFocusIndex,
}: MarkProps) {
  if (scales.x.kind !== 'band') return null;
  const band = scales.x.scale;
  // Series share a band by splitting it, so two Series read as a pair rather than as one bar
  // drawn over another.
  const width = band.bandwidth() / subCount;
  const zero = scales.y(0);

  return (
    <g>
      {rows.map((row, i) => {
        const value = row[y];
        if (typeof value !== 'number') return null;
        const left = (band(String(row[x] ?? '')) ?? 0) + subIndex * width;
        const top = scales.y(value);
        const height = Math.abs(zero - top);
        const focusable = focusIndex === i;
        return (
          <g key={`${String(row[x])}-${i}`}>
            <rect
              x={left}
              y={Math.min(top, zero)}
              width={width}
              height={Math.max(1, height)}
              fill={seriesColor(slot)}
              tabIndex={focusable ? 0 : -1}
              role="graphics-symbol"
              aria-label={
                label
                  ? `${label}, ${String(row[x] ?? 'no value')}: ${formatValue(value)}`
                  : `${String(row[x] ?? 'no value')}: ${formatValue(value)}`
              }
              onFocus={() => onFocusIndex?.(i)}
              onMouseEnter={(e) => onHover?.(row, { x: e.clientX, y: e.clientY })}
              onMouseLeave={() => onHover?.(null, { x: 0, y: 0 })}
            />
            {/* Direct labels on marks. A hard palette requirement, not polish: aqua, yellow and
                magenta fall below 3:1 on white, and this is one of the two reliefs that makes
                the palette compliant (ADR-0012). */}
            {width >= 18 && (
              <text
                className="mark-label"
                x={left + width / 2}
                y={Math.min(top, zero) - 4}
                textAnchor="middle"
                aria-hidden="true"
              >
                {formatValue(value)}
              </text>
            )}
          </g>
        );
      })}
      <line
        className="axis"
        y1={zero}
        y2={zero}
        x2={dimensions.innerWidth}
        aria-hidden="true"
      />
    </g>
  );
}

/* ---- lines and areas ------------------------------------------------------------------ */

/** A point on the x-axis. `value` is null where the metric had none — the point keeps its
    position so the line can break there rather than interpolating across it: a year with no
    matches is not a straight line through the gap. A row the scale cannot place at all — the
    null bucket on a time axis — is not a point. */
type Point = { at: number; value: number | null; row: ResultRow };

function points(rows: ResultRow[], x: string, y: string, scales: Scales): Point[] {
  return rows
    .flatMap((row) => {
      const at = scales.x.mid(row[x]);
      if (at === undefined) return [];
      const value = row[y];
      return [{ at, value: typeof value === 'number' ? scales.y(value) : null, row }];
    })
    // Drawn left to right whatever order the result arrived in: a line through its points in
    // metric order is not a line, it is a scribble.
    .sort((a, b) => a.at - b.at);
}

const defined = (p: Point | undefined) => p !== undefined && p.value !== null;

const PATH = (ps: Point[], y0: number, filled: boolean) =>
  filled
    ? area<Point>()
        .defined(defined)
        .x((p) => p.at)
        .y0(y0)
        .y1((p) => p.value!)(ps)
    : line<Point>()
        .defined(defined)
        .x((p) => p.at)
        .y((p) => p.value!)(ps);

/** Dots are drawn when the Series is short enough for them to be read, and always on a point
    with no neighbour — an isolated value between two gaps is otherwise drawn as nothing at all,
    which is how a one-row line chart comes out empty. */
const DOT_LIMIT = 40;
const isolated = (ps: Point[], i: number) => !defined(ps[i - 1]) && !defined(ps[i + 1]);

export function Line({ rows, x, y, scales, slot = 0, label, reveal = 1 }: MarkProps) {
  const ps = points(rows, x, y, scales);
  const path = PATH(ps, 0, false);
  if (path === null) return null;
  const last = [...ps].reverse().find(defined);
  const dots = ps.filter((p, i) => defined(p) && (ps.length <= DOT_LIMIT || isolated(ps, i)));

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={seriesColor(slot)}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={reveal < 1 ? 1 : undefined}
        strokeDashoffset={reveal < 1 ? 1 - reveal : undefined}
      />
      {dots.map((p, i) => (
        <circle key={i} cx={p.at} cy={p.value!} r={2.5} fill={seriesColor(slot)} />
      ))}
      {/* The Series named on the line itself, so the reader never has to match a colour. */}
      {label && last && (
        <text className="series-label" x={last.at + 5} y={last.value!} dy="0.32em">
          {label}
        </text>
      )}
    </g>
  );
}

export function Area({ rows, x, y, scales, slot = 0 }: MarkProps) {
  const ps = points(rows, x, y, scales);
  // The baseline is zero, clamped into the plot when zero is outside the domain.
  const [bottom] = scales.y.range();
  const path = PATH(ps, Math.min(Math.max(scales.y(0), 0), bottom!), true);
  if (path === null) return null;
  return <path d={path} fill={seriesColor(slot)} fillOpacity={0.16} stroke="none" />;
}

/** Thin a category list until the labels have room. Returning every third label beats
    overlapping every one. */
function thin<T>(items: T[], width: number): T[] {
  const room = Math.max(1, Math.floor(width / 56));
  if (items.length <= room) return items;
  const step = Math.ceil(items.length / room);
  return items.filter((_, i) => i % step === 0);
}

const truncate = (s: string, at: number) => (s.length > at ? `${s.slice(0, at - 1)}…` : s);
