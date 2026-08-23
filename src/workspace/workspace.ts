/** The `Workspace`: the facade the interface calls, and the owner of the Request lifecycle.

    One `ask` runs the whole thing — dispatch, the Translator call, structural then semantic
    validation, the single Repair, worker execution, and appending a Revision — with a staleness
    guard at every continuation. It is constructed with a Translator, which is what makes all of
    that testable without HTTP.

    Everything else in the application is wiring around this and the `DataEngine`. There is no
    third seam. */
import { validateSpec, type SpecViolation } from '../spec/validate';
import { specFromReply, type AnalysisSpec } from '../spec/grammar';
import type { Sample } from '../data/samples';
import type { Loader } from '../data/loader';
import type { DataPort } from '../worker/port';
import { useApp, type Notice, type Revision } from '../store';
import {
  Cancelled,
  Retryable,
  type Attempt,
  type TranslateRequest,
  type Translator,
} from '../ai/translator';
import type { AnalysisResult } from '../engine/result';
import type { Exchange } from '../ai/prompt';

/** One retry, and only one. A structural failure and a semantic one consume the same attempt.

    This is a bounded loop, not orchestration. It becomes orchestration at conditional multi-step
    repair with branching — a repair whose next step depends on which repair failed — and naming
    that threshold is the defence of the no-framework decision (ADR-0009). */
export const MAX_ATTEMPTS = 2;

/** Waits for a rate limit or an overloaded server, and only for those. A wait is not the model
    getting the specification wrong, so it does not consume the Repair — it is the same attempt,
    asked again. Two of them, then the failure is the visitor's to see. */
export const MAX_RETRIES = 2;
const BACKOFF_MS = 2_000;

export type Workspace = ReturnType<typeof createWorkspace>;

export function createWorkspace({
  translator,
  port,
  loader,
  store = useApp,
}: {
  translator: Translator;
  port: DataPort;
  loader: Loader;
  store?: typeof useApp;
}) {
  /** One app-global monotonic counter, spanning both async boundaries. Only a new submission
      increments it. Every continuation returns early if it is no longer current, which is what
      makes correctness independent of whether the abort and the worker cancel actually landed
      (ADR-0006). */
  let requestId = 0;
  let inFlight: AbortController | null = null;
  let nextAnalysisId = 1;

  const stale = (id: number) => id !== requestId;

  /** Deltas accumulate in a closure and flush on a frame, into the one slice the streaming
      element subscribes to. Per-token text in the same slice as `analyses` would re-render the
      rail sixty times a second. */
  function events(id: number) {
    let pending = '';
    let scheduled = false;
    return {
      onNarration(delta: string) {
        pending += delta;
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          const text = pending;
          pending = '';
          if (!stale(id) && text) store.getState().appendNarration(id, text);
        });
      },
      onChips(chips: string[]) {
        if (!stale(id)) store.getState().setChips(id, chips);
      },
    };
  }

  /** Rejects rather than resolves on cancel, so a visitor waiting out a rate limit is not made
      to wait out the rest of it before their cancel is noticed. */
  function delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new Cancelled());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  /** One Translator call, waited out and repeated if the failure was the kind waiting fixes. */
  async function translate(
    id: number,
    req: TranslateRequest,
    signal: AbortSignal,
  ): Promise<Attempt> {
    for (let retry = 0; ; retry++) {
      try {
        return await translator.translate(req, events(id), signal);
      } catch (e) {
        if (!(e instanceof Retryable) || retry >= MAX_RETRIES || stale(id)) throw e;
        const wait = e.afterMs ?? BACKOFF_MS * 2 ** retry;
        store.getState().waitToRetry(id, Date.now() + wait, e.message);
        await delay(wait, signal);
        if (stale(id)) throw new Cancelled();
        store.getState().setRequestStatus(id, 'thinking');
      }
    }
  }

  /** The worker call both editors make. A crashed worker rejects rather than answering, and the
      whole point of respawning it is that one Analysis fails instead of the tab. */
  async function analyze(spec: AnalysisSpec): Promise<{ result: AnalysisResult } | { error: string }> {
    try {
      const res = await port.send({
        type: 'analyze',
        operation: spec.operation,
        metric: spec.visualization.y,
        seriesBy: spec.visualization.seriesBy,
      }).done;
      if (res.type === 'analyze:done') return { result: res.result };
      return { error: res.type === 'error' ? res.message : 'The analysis was cancelled.' };
    } catch (e) {
      return {
        error:
          `${e instanceof Error ? e.message : String(e)} ` +
          'The worker has been restarted — re-load the Dataset to carry on.',
      };
    }
  }

  function notice(id: number, value: Notice): void {
    store.getState().setNotice(value);
    store.getState().endRequest(id);
  }

  /** The Questions that produced each Analysis's Revisions, newest last.

      Kept here rather than on the Revision because a Revision is the AnalysisSpec, the
      AnalysisResult and the model, and nothing else (CONTEXT.md). A Question is dispatch context
      — the same category as `intent` — so it lives with the dispatcher. */
  const exchanges = new Map<string, Exchange[]>();

  async function ask(question: string): Promise<void> {
    const id = ++requestId;
    const state = store.getState();
    const schema = { columns: state.columns };
    /** Captured at dispatch, not read at resolve. Selecting a different Analysis mid-Request
        must not redirect where the result lands (ADR-0015). */
    const target = state.activeAnalysisId;
    const current = state.analyses.find((a) => a.id === target)?.revisions.at(-1)?.spec ?? null;
    const model = state.model;
    const refine = current
      ? { spec: current, history: exchanges.get(target!) ?? [] }
      : undefined;

    inFlight?.abort();
    inFlight = new AbortController();
    const signal = inFlight.signal;
    store.getState().startRequest(id, question);

    let repair: TranslateRequest['repair'];

    for (let attemptNo = 0; attemptNo < MAX_ATTEMPTS; attemptNo++) {
      let attempt: Attempt;
      try {
        attempt = await translate(id, { question, schema, model, refine, repair }, signal);
      } catch (e) {
        // Continuation 1 — after the Translator resolves.
        if (stale(id)) return;
        if (e instanceof Cancelled) return void store.getState().endRequest(id);
        return notice(id, {
          kind: 'failed',
          message: e instanceof Error ? e.message : String(e),
          violations: [],
        });
      }
      // The Request was charged for whether or not its result is still wanted, so it counts
      // towards the session total either way — but only a current one is the `last` figure.
      store.getState().recordUsage(attempt.usage, !stale(id));
      if (stale(id)) return;

      // Structural. A `max_tokens` stop and a reply that called no tool arrive here too, and
      // consume the same single Repair a malformed one does.
      if (!attempt.reply) {
        repair = { attempt, problem: { message: attempt.failure!.message } };
        store.getState().setRequestStatus(id, 'repairing');
        continue;
      }

      const reply = attempt.reply;
      if (reply.kind === 'clarification') {
        return notice(id, { kind: 'clarification', question: reply.question, options: reply.options });
      }
      if (reply.kind === 'unsupported') {
        return notice(id, {
          kind: 'unsupported',
          reason: reply.reason,
          suggestions: reply.suggestions,
        });
      }

      // Semantic, against the DatasetSchema actually loaded.
      const spec = specFromReply(reply);
      const violations = validateSpec(spec, schema);
      if (violations.length > 0) {
        repair = { attempt, problem: { violations } };
        store.getState().setRequestStatus(id, 'repairing');
        continue;
      }

      // Continuation 2 — before the work is handed to the worker. On the happy path this is the
      // same tick as the guard above, because validation is synchronous; it is written out
      // anyway so that the boundary is guarded rather than guarded by accident.
      if (stale(id)) return;
      store.getState().setRequestStatus(id, 'executing');
      const res = await analyze(spec);
      // Continuation 3 — after the worker responds. The worker cancel is best-effort; this is
      // what makes the correctness independent of it.
      if (stale(id)) return;
      if ('error' in res) {
        return notice(id, { kind: 'failed', message: res.error, violations: [] });
      }

      // The model proposes and the dispatcher decides: `refine` with nothing captured at
      // dispatch has nothing to refine, so it becomes a new Analysis (ADR-0014). `intent` is
      // consumed here and never persisted.
      land(reply.intent === 'refine' ? target : null, question, spec, {
        spec,
        result: res.result,
        model,
      });
      store.getState().endRequest(id);
      return;
    }

    // Both attempts spent. Never a dead end: the violations name the columns that would work.
    const problem = repair!.problem;
    notice(id, {
      kind: 'failed',
      message:
        'violations' in problem
          ? 'That question produced a specification this Dataset cannot answer, twice.'
          : problem.message,
      violations: 'violations' in problem ? problem.violations : [],
    });
  }

  function land(
    target: string | null,
    question: string | null,
    spec: AnalysisSpec,
    revision: Revision,
  ): void {
    const known = store.getState().analyses.some((a) => a.id === target);
    const id = known ? target! : `a${nextAnalysisId++}`;
    store.getState().landRevision(target, id, spec.title, revision);
    // A manual edit has no Question, so it contributes nothing to the history a later refine
    // carries — the spec it produced is already the one that history is about.
    if (question !== null) exchanges.set(id, [...(exchanges.get(id) ?? []), { question, spec }]);
  }

  /** A manual edit: the chart-type toggle or the aggregation dropdown, already applied to the
      spec by `spec/edits`. It skips the Translator and nothing else — the same semantic
      validation, the same worker execution, the same captured target, and a Revision identical
      to the one a spoken edit produces, in one history.

      It is a submission, so it takes a requestId: a manual edit made while a Question is in
      flight supersedes that Question rather than racing it. */
  async function revise(spec: AnalysisSpec): Promise<void> {
    const id = ++requestId;
    const state = store.getState();
    const target = state.activeAnalysisId;
    const analysis = state.analyses.find((a) => a.id === target);
    if (!analysis) return;
    inFlight?.abort();
    store.getState().dismissNotice();

    const violations = validateSpec(spec, { columns: state.columns });
    if (violations.length > 0) {
      return notice(id, {
        kind: 'failed',
        message: 'That change does not describe an analysis this Dataset can answer.',
        violations,
      });
    }

    // ponytail: a chart-type toggle re-executes an Operation that has not changed, to keep one
    // path with no special case (ADR-0021). Reuse the previous Revision's result when the
    // Operation is deep-equal if the tens of milliseconds ever measure.
    const res = await analyze(spec);
    if (stale(id)) return;
    if ('error' in res) {
      return notice(id, { kind: 'failed', message: res.error, violations: [] });
    }
    // The model of the Revision this was derived from: a manual edit changes the spec, not who
    // wrote the analysis it descends from.
    land(target, null, spec, { spec, result: res.result, model: analysis.revisions[analysis.at]!.model });
  }

  return {
    /** A Dataset the Analyses were not asked against makes every one of them meaningless, so the
        store drops them — and any Request still in flight is abandoned here rather than allowed
        to land against columns that no longer exist. */
    async loadDataset(source: Sample | File): Promise<void> {
      requestId++;
      inFlight?.abort();
      exchanges.clear();
      store.getState().dismissNotice();
      await (source instanceof File ? loader.loadFile(source) : loader.loadSample(source));
    },

    ask,

    revise,

    /** Deleting an Analysis takes its Questions with it: they are dispatch context for refining
        that Analysis, and there is no longer one to refine. */
    deleteCard(id: string): void {
      exchanges.delete(id);
      store.getState().deleteAnalysis(id);
    },

    /** A pure view change. It cancels nothing. */
    selectCard(id: string | null): void {
      store.getState().selectAnalysis(id);
    },

    /** The visitor's cancel. Best-effort on the wire; the counter is what makes it correct. */
    cancel(): void {
      requestId++;
      inFlight?.abort();
      store.getState().cancelRequest();
    },

    latestSpec(): AnalysisSpec | null {
      const s = store.getState();
      return s.analyses.find((a) => a.id === s.activeAnalysisId)?.revisions.at(-1)?.spec ?? null;
    },
  };
}

export type { SpecViolation };
