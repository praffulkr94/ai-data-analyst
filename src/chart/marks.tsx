/** Layer three of three: dumb marks. Each takes the scales and the rows and draws. There is no
    `<Chart type="bar">` mega-component with forty props — a chart is composed of these under
    `<ChartFrame>`, which is what keeps them dumb. */
import { format } from 'd3-format';
import { quadtree } from 'd3-quadtree';
import { area, line } from 'd3-shape';
import { utcFormat } from 'd3-time-format';
import { useEffect, useMemo, useRef } from 'react';
import { CHART_BUDGET } from '../engine/operation';
import { useApp } from '../store';
import type { ResultField, ResultRow } from '../engine/result';
import type { ChartType, TimeUnit } from '../spec/grammar';
import type { Scales } from './useScales';
import type { ChartDimensions } from './useChartDimensions';

/** What each chart type can draw and still be read. A bar has to be wide enough to compare and
    to carry its own label, which is why its cap is two orders of magnitude below a line's: at
    900px, 60 bands are 15px each and 800 would be under a pixel. Everything else needs one pixel
    per point, so its own point budget is its only limit. */
export const MARK_CAP: Record<ChartType, number> = {
  bar: 60,
  line: CHART_BUDGET.line.points,
  area: CHART_BUDGET.area.points,
  scatter: CHART_BUDGET.scatter.points,
};

/** Where SVG gives way to canvas, and nothing else. Below this a scatter is React elements like
    every other mark; above it one canvas draws every point. Five thousand `<circle>` is where
    the diff between the two stops being academic (DECISIONS §10). */
export const CANVAS_ABOVE = 5_000;

/** A drag offset in pixels. Only a canvas scatter pans — an SVG chart is already whole on the
    screen, and panning a bar chart off its own axis is not a feature. */
export type Pan = { x: number; y: number };
export const NO_PAN: Pan = { x: 0, y: 0 };

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

/** Label one temporal tick. The value arrives as a Date from a time scale, as a stringified
    epoch from a band scale — a band domain is strings — and as an ISO day from a `date` column
    that was grouped by rather than bucketed, which is what `cellText` gives a date. All three
    are accepted here rather than at three call sites; a bar chart grouped by a raw date column
    labelled every tick "no value" until the third one was. */
export function temporalLabel(unit: TimeUnit | undefined, v: number | string | Date): string {
  // `Number('')` is 0, so an empty band key would otherwise be labelled 1970.
  if (v === '') return 'no value';
  const epoch = typeof v === 'string' && !/^-?\d+$/.test(v);
  const d = v instanceof Date ? v : epoch ? new Date(v) : new Date(Number(v));
  if (Number.isNaN(d.valueOf())) return 'no value';
  return FORMATTERS[unit ?? 'none'](d);
}

/* ---- axes and grid, from scale.ticks() as React elements ----------------------------- */

export function XAxis({
  scales,
  dimensions,
  field,
  pan = NO_PAN,
}: {
  scales: Scales;
  dimensions: ChartDimensions;
  /** The result field on the x-axis. It carries whether the axis is temporal and, if it came
      from a `timeBucket`, at what resolution — so the axis never has to guess either. */
  field: ResultField | undefined;
  /** The pan the marks were drawn with. The axis moves with the data — a panned chart whose
      ticks stayed put would be labelled wrongly — and a tick that lands outside the plot is
      dropped rather than drawn over the margin. */
  pan?: Pan;
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
      {ticks
        .map((t) => ({ ...t, at: t.at + pan.x }))
        .filter((t) => t.at >= 0 && t.at <= innerWidth)
        .map((t) => (
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

/** The visible y ticks, panned. Shared by the axis and the grid so a panned grid line and its
    label are never one without the other. */
function yTicks(scales: Scales, dimensions: ChartDimensions, pan: Pan) {
  return scales.y
    .ticks(Math.max(2, Math.floor(dimensions.innerHeight / 44)))
    .map((t) => ({ value: t, at: scales.y(t) + pan.y }))
    .filter((t) => t.at >= 0 && t.at <= dimensions.innerHeight);
}

export function YAxis({
  scales,
  dimensions,
  pan = NO_PAN,
}: {
  scales: Scales;
  dimensions: ChartDimensions;
  pan?: Pan;
}) {
  return (
    <g className="axis" aria-hidden="true">
      {yTicks(scales, dimensions, pan).map((t) => (
        <text key={t.value} x={-8} y={t.at} dy="0.32em" textAnchor="end">
          {formatAxisValue(t.value)}
        </text>
      ))}
    </g>
  );
}

export function Grid({
  scales,
  dimensions,
  pan = NO_PAN,
}: {
  scales: Scales;
  dimensions: ChartDimensions;
  pan?: Pan;
}) {
  return (
    <g className="grid" aria-hidden="true">
      {yTicks(scales, dimensions, pan).map((t) => (
        <line key={t.value} x2={dimensions.innerWidth} y1={t.at} y2={t.at} />
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
  /** Where to put the direct label, when the chart has moved it off the line's own end to keep
      it clear of another Series' label. */
  labelY?: number;
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

/** Dots are drawn when the points have room for them, and always on a point with no neighbour —
    an isolated value between two gaps is otherwise drawn as nothing at all, which is how a
    one-row line chart comes out empty.

    Room is measured in pixels between points and not in their number, so every Series in one
    chart makes the same choice: a 20-point Series spread over the same 152 years as a 155-point
    one is just as dense, and dotting one but not the other reads as two kinds of line. */
const DOT_GAP = 12;
const isolated = (ps: Point[], i: number) => !defined(ps[i - 1]) && !defined(ps[i + 1]);

/** The rightmost drawn point of a Series — where its direct label goes. Exported so the chart
    can space several labels apart without re-deriving where each one lands. */
export function lastPoint(
  rows: ResultRow[],
  x: string,
  y: string,
  scales: Scales,
): { at: number; value: number } | undefined {
  const found = [...points(rows, x, y, scales)].reverse().find(defined);
  return found === undefined ? undefined : { at: found.at, value: found.value! };
}

export function Line({ rows, x, y, scales, slot = 0, label, labelY, reveal = 1 }: MarkProps) {
  const ps = points(rows, x, y, scales);
  const path = PATH(ps, 0, false);
  if (path === null) return null;
  const last = [...ps].reverse().find(defined);
  const span = ps.length < 2 ? Infinity : (ps.at(-1)!.at - ps[0]!.at) / (ps.length - 1);
  const dots = ps.filter((p, i) => defined(p) && (span >= DOT_GAP || isolated(ps, i)));

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
        <text className="series-label" x={last.at + 6} y={labelY ?? last.value!} dy="0.32em">
          {truncate(label, 13)}
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

/* ---- scatter -------------------------------------------------------------------------- */

/** How far from a point the pointer counts as on it. */
const HIT_RADIUS = 14;
const POINT_RADIUS = 2.5;

/** One circle per row, and the Series named at its rightmost point the way a line is.

    The circles take no pointer events: a scatter's hit-testing is `<PointsHover>`, one quadtree
    for the whole chart rather than a listener per mark. `drawn` is false above `CANVAS_ABOVE`,
    where `<PointsCanvas>` draws the same points and this contributes the label alone — the label
    is SVG text either way, because a canvas cannot be read by anything. */
export function Points({
  rows,
  x,
  y,
  scales,
  slot = 0,
  label,
  labelY,
  drawn = true,
}: MarkProps & { drawn?: boolean }) {
  // Memoized on the rows and the scales, because everything else that re-renders this chart —
  // a hover, a tooltip, a pan — must not walk a hundred thousand rows again to do it.
  const ps = useMemo(() => points(rows, x, y, scales).filter(defined), [rows, x, y, scales]);
  const last = ps.at(-1);

  return (
    <g aria-hidden="true">
      {drawn &&
        ps.map((p, i) => (
          <circle
            key={i}
            cx={p.at}
            cy={p.value!}
            r={POINT_RADIUS}
            fill={seriesColor(slot)}
            fillOpacity={0.7}
            pointerEvents="none"
          />
        ))}
      {label && last && (
        <text className="series-label" x={last.at + 6} y={labelY ?? last.value!} dy="0.32em">
          {truncate(label, 13)}
        </text>
      )}
    </g>
  );
}

/** The same points, drawn once into a canvas rather than as thousands of elements.

    One canvas per Series rather than one for the chart, so the composition stays what it is
    everywhere else: a mark per Series, and the chart composing them. Three transparent canvases
    the size of the plot area cost nothing, and a mark that had to be handed every Series would
    not be a mark.

    It takes no pointer events. `<PointsHover>` in the SVG above does the hit-testing for both
    renderers, so hover has one implementation and not two, and the Series labels stay SVG text
    because nothing can read a canvas. */
export function PointsCanvas({
  rows,
  x,
  y,
  scales,
  dimensions,
  slot = 0,
  pan = NO_PAN,
}: MarkProps & { pan?: Pan }) {
  const ref = useRef<HTMLCanvasElement>(null);
  /** A canvas cannot inherit a CSS custom property, so it reads the token itself — and has to be
      told when the tokens changed, which is the only reason a mark knows the theme exists. */
  const theme = useApp((s) => s.theme);
  const ps = useMemo(() => points(rows, x, y, scales).filter(defined), [rows, x, y, scales]);
  const { innerWidth, innerHeight, margin } = dimensions;

  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || innerWidth <= 0) return;
    // Backing store in device pixels, coordinates in CSS pixels: on a 2× display a canvas sized
    // in CSS pixels alone draws every point blurred.
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(innerWidth * dpr);
    el.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle =
      getComputedStyle(el).getPropertyValue(`--series-${(slot % SERIES_SLOTS) + 1}`).trim() ||
      '#8a8a85';
    // Squares, not arcs: at two and a half pixels the difference is invisible and `fillRect` is
    // the difference between a smooth drag and a stuttering one at a hundred thousand points.
    const size = POINT_RADIUS * 2;
    for (const p of ps) {
      ctx.fillRect(p.at + pan.x - POINT_RADIUS, p.value! + pan.y - POINT_RADIUS, size, size);
    }
  }, [ps, innerWidth, innerHeight, pan, slot, theme]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="chart-canvas"
      style={{
        left: margin.left,
        top: margin.top,
        width: innerWidth,
        height: innerHeight,
      }}
    />
  );
}

/** Scatter hit-testing: one `d3-quadtree` over the drawn points in pixel space, queried at the
    pointer, feeding the same portal tooltip every other chart feeds. A scatter has a mark under
    the pointer, unlike a line, but ninety-nine thousand of them cannot each carry a listener —
    and above `CANVAS_ABOVE` there is no element to carry one at all.

    The tree is built in unpanned pixel space and the query is offset by the pan, because a pan
    is a pixel translation: rebuilding a hundred thousand nodes per frame is the one thing that
    would make the drag stutter. */
export function PointsHover({
  rows,
  x,
  y,
  scales,
  dimensions,
  onHover,
  pan = NO_PAN,
  onPan,
}: MarkProps & { pan?: Pan; onPan?: (pan: Pan) => void }) {
  const tree = useMemo(
    () =>
      quadtree<Point>()
        .x((p) => p.at)
        .y((p) => p.value!)
        .addAll(points(rows, x, y, scales).filter(defined)),
    [rows, x, y, scales],
  );

  /** Where the drag started and what the pan was then. A ref and not a local, because each pan
      re-renders this component: a local would be null again by the second pointermove and the
      drag would move one pixel and stop. */
  const from = useRef<{ x: number; y: number; pan: Pan } | null>(null);

  return (
    <rect
      width={dimensions.innerWidth}
      height={dimensions.innerHeight}
      fill="transparent"
      aria-hidden="true"
      style={onPan ? { cursor: 'grab', touchAction: 'none' } : undefined}
      onPointerDown={(e) => {
        if (!onPan) return;
        from.current = { x: e.clientX, y: e.clientY, pan };
        // Capture keeps the drag alive past the edge of the plot. It throws on a pointer id that
        // is no longer down, and jsdom does not implement it at all.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* the drag still works, it just ends at the edge */
        }
      }}
      onPointerUp={() => {
        from.current = null;
      }}
      onPointerMove={(e) => {
        const start = from.current;
        if (start) {
          // A drag is not a hover: leaving the tooltip up would park it wherever the drag began.
          onHover?.(null, { x: 0, y: 0 });
          onPan?.({
            x: start.pan.x + e.clientX - start.x,
            y: start.pan.y + e.clientY - start.y,
          });
          return;
        }
        if (!onHover) return;
        const box = e.currentTarget.getBoundingClientRect();
        const found = tree.find(
          e.clientX - box.left - pan.x,
          e.clientY - box.top - pan.y,
          HIT_RADIUS,
        );
        onHover(found?.row ?? null, { x: e.clientX, y: e.clientY });
      }}
      onPointerLeave={() => {
        from.current = null;
        onHover?.(null, { x: 0, y: 0 });
      }}
    />
  );
}

/* ---- the hover surface ---------------------------------------------------------------- */

/** One transparent rectangle over the plot area, and the pointer position inverted through the
    scale to find the row under it. A line has no mark to hover — it is one path — so the
    alternative is an invisible target per point, which is hundreds of elements and hundreds of
    listeners. A bar hands its own rect the pointer, so this returns nothing on a band scale. */
export function HoverArea({ rows, x, y, scales, dimensions, onHover }: MarkProps) {
  if (scales.x.kind === 'band' || !onHover) return null;
  const invert = scales.x.scale.invert;
  const ps = points(rows, x, y, scales).filter(defined);

  const nearest = (px: number, py: number) => {
    const target = Number(invert(px));
    let best: Point | undefined;
    let bestBy: [number, number] = [Infinity, Infinity];
    for (const p of ps) {
      // Nearest in the x domain first, and only then nearest in pixels — with several Series
      // the pointer picks the line it is closest to, at the position it is over.
      const by: [number, number] = [Math.abs(Number(p.row[x]) - target), Math.abs(p.value! - py)];
      if (by[0] < bestBy[0] || (by[0] === bestBy[0] && by[1] < bestBy[1])) {
        best = p;
        bestBy = by;
      }
    }
    return best;
  };

  return (
    <rect
      width={dimensions.innerWidth}
      height={dimensions.innerHeight}
      fill="transparent"
      aria-hidden="true"
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const found = nearest(e.clientX - box.left, e.clientY - box.top);
        onHover(found?.row ?? null, { x: e.clientX, y: e.clientY });
      }}
      onPointerLeave={() => onHover(null, { x: 0, y: 0 })}
    />
  );
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
