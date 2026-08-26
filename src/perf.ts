/** Instrumentation. Marks and measures on both threads, and the two observers.
 *
 * Everything here writes to the standard performance timeline first and to a readable object
 * second, so a DevTools trace of a real session is legible without this module and without the
 * `/bench` page — that is the whole reason for `mark`/`measure` rather than two `now()` readings
 * and a `console.log`. `performance` exists in a worker as well as a window, and each has its
 * own timeline, so the worker's phases are measured there and posted back with the response
 * they belong to.
 *
 * No DOM, so this is reachable from the kernel. */

/** Run `fn` between a mark and a measure, and hand back what it returned and how long it took.
    The measure is named for the phase, so `parse`, `infer`, `encode` and `index` show up as
    named bands in a trace rather than as one opaque worker task. */
export function timed<T>(name: string, fn: () => T): [T, number] {
  performance.mark(`${name}:start`);
  const value = fn();
  return [value, performance.measure(name, `${name}:start`).duration];
}

/** The async form. Same marks, and the measure covers the await. */
export async function timedAsync<T>(name: string, fn: () => Promise<T> | T): Promise<[T, number]> {
  performance.mark(`${name}:start`);
  const value = await fn();
  return [value, performance.measure(name, `${name}:start`).duration];
}

export const mark = (name: string): void => void performance.mark(name);

/** Measure from a mark that may not exist — the first chart of a session is drawn from a
    restored link with no Request behind it, and a measure against a missing mark throws. */
export function since(name: string, start: string): number | null {
  if (performance.getEntriesByName(start, 'mark').length === 0) return null;
  return performance.measure(name, start).duration;
}

/** What the two observers have seen since the page loaded. `blockedMs` is the money number in
    DECISIONS §7 — the main thread is either free while the worker parses or it is not — and
    `worstInteractionMs` is the INP reading: the slowest event Chrome timed, which is only ever
    a real interaction and never something this code can fake. */
export type PerfReadings = {
  longTasks: number;
  blockedMs: number;
  worstInteractionMs: number;
  worstInteraction: string | null;
};

const readings: PerfReadings = {
  longTasks: 0,
  blockedMs: 0,
  worstInteractionMs: 0,
  worstInteraction: null,
};

let watching = false;

/** Install both observers for the life of the page. Called once from the entry point, so the
    readings cover a whole session — a scripted scroll and submit included, which is what the
    Playwright flow reads them for. */
export function watchPerformance(): void {
  if (watching || typeof PerformanceObserver === 'undefined') return;
  watching = true;
  /** The one reader of these numbers is `scripts/e2e-run.mjs`, which reports them at the end of
      a scripted session. It used to read them out of a panel on the canvas; M10 deleted that
      panel, because evidence for a reviewer is not a product surface (ADR-0026) — so the
      readings are handed to the driver directly instead of being rendered at a visitor. */
  (globalThis as { __perf?: () => PerfReadings }).__perf = perfReadings;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        readings.longTasks++;
        readings.blockedMs += entry.duration;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* an engine without long-task timing still runs the application */
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration <= readings.worstInteractionMs) continue;
        readings.worstInteractionMs = entry.duration;
        readings.worstInteraction = entry.name;
      }
      // `durationThreshold` is Event Timing's own option and is missing from the DOM lib's type.
    }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  } catch {
    /* likewise */
  }
}

export const perfReadings = (): PerfReadings => ({ ...readings });
