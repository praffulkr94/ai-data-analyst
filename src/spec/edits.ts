/** The manual editor: the two edits the interface can make to an AnalysisSpec without asking
    the model. Pure functions of a spec to a spec, so the Workspace path they feed is the one a
    spoken edit takes and the Revision they produce is identical to a spoken one.

    Natural language is one of two editors over the same application-owned spec — which is the
    point of them: a spec that only the model can write is indistinguishable from blindly
    rendered model output (DECISIONS §11).

    There are two edits and there will not be more. Axis and field pickers are a chart builder,
    which is a different product. */
import {
  AGGREGATION_FNS,
  CHART_TYPES,
  type AggregationFn,
  type AnalysisSpec,
  type ChartType,
} from './grammar';
import { validateSpec } from './validate';
import type { DatasetSchema } from '../engine/types';

export const withChartType = (spec: AnalysisSpec, type: ChartType): AnalysisSpec => ({
  ...spec,
  visualization: { ...spec.visualization, type } as AnalysisSpec['visualization'],
});

/** The Aggregation the chart's y-axis reads, which is the only one a dropdown can speak about.
    A derived ratio names no Aggregation, so it has none and the dropdown does not appear. */
export const metricAggregation = (spec: AnalysisSpec) =>
  spec.operation.aggregations.find((a) => a.id === spec.visualization.y) ?? null;

/** The label travels with the function: "average goals" left on a sum is a caption that lies. */
export function withAggregation(spec: AnalysisSpec, fn: AggregationFn): AnalysisSpec {
  return {
    ...spec,
    operation: {
      ...spec.operation,
      aggregations: spec.operation.aggregations.map((a) =>
        a.id === spec.visualization.y
          ? { ...a, fn, label: a.column === null ? fn : `${fn} of ${a.column}` }
          : a,
      ),
    },
  };
}

/** Which options a control may offer: the ones whose edited spec the semantic validator accepts.

    Asking the validator rather than restating its rules is what keeps a dropdown from offering
    `avg` on a boolean — the rule lives in one place and the control reads it. */
const legal = (spec: AnalysisSpec, schema: DatasetSchema) => validateSpec(spec, schema).length === 0;

export const chartTypeOptions = (spec: AnalysisSpec, schema: DatasetSchema): ChartType[] =>
  // Scatter appears here only for a spec whose x is already a measure, which is what the
  // validator requires of one — so it is offered on a scatter and on nothing else.
  CHART_TYPES.filter((t) => legal(withChartType(spec, t), schema));

export const aggregationOptions = (spec: AnalysisSpec, schema: DatasetSchema): AggregationFn[] =>
  metricAggregation(spec) === null
    ? []
    : AGGREGATION_FNS.filter((fn) => legal(withAggregation(spec, fn), schema));
