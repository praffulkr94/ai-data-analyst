/** Two formatters over one ChartSummary. `DataEngine` computes the facts; these turn them into
    the two strings the interface needs, and they are deliberately different strings.

    A sighted reader under a visible bar chart does not need "Bar chart, 6 categories" — that
    restates what they can see. A screen-reader user needs exactly that orientation. Making the
    two byte-identical forces one audience to read text written for the other; computing them
    independently lets caption and label drift apart until they disagree. One computation, two
    formatters. Both are pure, so both are tested at the `DataEngine` seam with no DOM. */
import { FOLD_LABEL, FOLD_TOP_N } from '../engine/operation';
import type { ChartSummary } from '../engine/result';
import type { ChartType } from '../spec/grammar';

const n = (v: number) => v.toLocaleString('en-US');

const CHART_NAMES: Record<ChartType, string> = {
  bar: 'Bar chart',
  line: 'Line chart',
  area: 'Area chart',
  scatter: 'Scatter plot',
};

/** Orientation before detail: what kind of chart, what it measures, over what, how many of
    them, and where the extreme is. This is the `role="img"` label. */
export function chartLabel(s: ChartSummary, type: ChartType): string {
  const what = s.dimensionLabel ? `${s.metricLabel} by ${s.dimensionLabel}` : s.metricLabel;

  const scale =
    s.groupCount === 0
      ? 'no results'
      : s.foldedCount > 0
        ? `showing the top ${FOLD_TOP_N} of ${n(s.totalGroups)} with the rest grouped as ${FOLD_LABEL}`
        : s.dimensionLabel === null
          ? 'a single value'
          : `${n(s.groupCount)} categories`;

  const extreme = s.extreme ? ` Highest: ${s.extreme.label}, ${n(s.extreme.value)}.` : '';
  return `${CHART_NAMES[type]}. ${what}, ${scale}.${extreme}`;
}

const AGGREGATION_WORDS: Record<string, string> = {
  sum: 'Summed',
  avg: 'Averaged',
  count: 'Counted',
  countDistinct: 'Counted as distinct values',
  min: 'Smallest',
  max: 'Largest',
  median: 'Median',
  rate: 'Shown as a share',
  ratio: 'Shown as a ratio',
};

/** What the chart cannot show: how much of the Dataset is behind it, what was folded away, and
    what the aggregation left out. Never the chart type and never the category count. */
export function chartCaption(s: ChartSummary): string {
  if (s.rowsMatched === 0 || s.groupCount === 0) return 'No rows matched.';

  const word = AGGREGATION_WORDS[s.aggregation] ?? 'Computed';
  const over =
    s.rowsMatched === s.rowsTotal
      ? `all ${n(s.rowsTotal)} rows`
      : `${n(s.rowsMatched)} of ${n(s.rowsTotal)} rows`;

  const parts = [`${word} over ${over}.`];
  if (s.foldedCount > 0 && s.dimensionLabel) {
    // The fold is not drawn as a mark, so this is where its size is stated.
    parts.push(
      s.foldedValue === null
        ? `Top ${FOLD_TOP_N} of ${n(s.totalGroups)} ${plural(s.dimensionLabel)}, rest grouped.`
        : `Top ${FOLD_TOP_N} of ${n(s.totalGroups)} ${plural(s.dimensionLabel)}; the other ` +
          `${n(s.foldedCount)} hold ${n(s.foldedValue)}.`,
    );
  }
  if (s.nullExcluded > 0) {
    parts.push(`${n(s.nullExcluded)} rows excluded for having no value.`);
  }
  return parts.join(' ');
}

/** Enough pluralisation for a column name. A wrong plural reads as sloppy, not as a bug. */
const plural = (word: string) =>
  /(s|x|z|ch|sh)$/.test(word) ? `${word}es` : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;
