/** The active Analysis on the canvas: its title, the model's narration, and the chart drawn from
    the Revision's AnalysisResult.

    The Revision stepper, undo and the manual controls arrive in milestone 6. What is here is the
    one thing milestone 5 has to prove — that a Question becomes a validated specification and a
    chart the application computed. */
import { AnalysisChart } from '../chart/AnalysisChart';
import { MODELS } from '../ai/models';
import { useApp } from '../store';

export function AnalysisCard() {
  const analysis = useApp((s) => s.analyses.find((a) => a.id === s.activeAnalysisId) ?? null);
  if (!analysis) return null;
  const revision = analysis.revisions.at(-1)!;

  return (
    <section className="panel analysis">
      <div className="panel-head">
        <h2>{analysis.title}</h2>
        <span className="tag" title={MODELS[revision.model].note}>
          {MODELS[revision.model].label}
        </span>
      </div>
      <p className="narration">{revision.spec.narration}</p>
      <AnalysisChart result={revision.result} visualization={revision.spec.visualization} />
    </section>
  );
}
