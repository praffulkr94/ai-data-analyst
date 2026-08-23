/** `/bench` — the performance evidence, run by whoever is reading it.
 *
 * Not linked from the interface and code-split, so it costs a visitor nothing; reachable at
 * `#bench` in any build, including the deployed one, because a number a stranger cannot
 * reproduce is a number in a README (DECISIONS §13). It runs each of the three paths N times,
 * reports the median of every phase with its range, watches the main thread for long tasks
 * while each one runs, and hands the whole thing over as JSON to commit.
 *
 * The author re-runs this before any number ships. Nothing here is cached, memoised or
 * warmed: run one of a path pays for a cold module and a cold worker, which is why N ≥ 7 and
 * why the median and not the mean is the figure. */
import { useEffect, useRef, useState } from 'react';
import { SAMPLES, sampleUrl } from '../data/samples';
import { createTransport } from '../worker/transport';
import type { DataPort } from '../worker/port';
import { PATHS, type PathName, type Run } from './paths';
import { summarise, type Stat } from './stats';

/** Long tasks and slow interactions seen while one path ran. The first is the money number in
    §7 — the naive path blocks the main thread for hundreds of milliseconds and the worker path
    does not — and the second is empty unless somebody interacts with the page during a run,
    which is exactly what the Playwright flow does. */
type Observed = { longTaskMs: number[]; blockedMs: number; worstEventMs: number };

type Result = { path: PathName; runs: Run[]; observed: Observed; error?: string };

const ms = (v: number) => `${v.toFixed(1)} ms`;
const range = (s: Stat) => `${ms(s.median)}  (${ms(s.min)} – ${ms(s.max)})`;

/** What the numbers are worth nothing without. `deviceMemory` and `hardwareConcurrency` are
    Chrome's own readings; the machine itself has to be named by the person committing the JSON,
    which is what the `machine` field is for. */
function environment() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: nav.deviceMemory ?? null,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    machine: 'name this by hand before committing',
  };
}

export default function Bench() {
  const [sample, setSample] = useState(SAMPLES[1]!.id);
  const [n, setN] = useState(9);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const port = useRef<DataPort | null>(null);

  useEffect(() => {
    port.current = createTransport();
    return () => {
      port.current?.dispose();
      port.current = null;
    };
  }, []);

  async function run(): Promise<void> {
    const found = SAMPLES.find((s) => s.id === sample);
    if (!found || !port.current) return;
    const url = sampleUrl(found);
    setResults([]);

    for (const path of Object.keys(PATHS) as PathName[]) {
      const runs: Run[] = [];
      const observed: Observed = { longTaskMs: [], blockedMs: 0, worstEventMs: 0 };

      /** One observer per path, and every entry checked against the moment the path started:
          an observer is disconnected before the previous path's last long task has been
          delivered, and that task then arrives at the next path's observer. Unfiltered, the
          worker path was credited with one 98ms block that was the main-thread path's. */
      const from = performance.now();
      const longTasks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime < from) continue;
          observed.longTaskMs.push(Math.round(entry.duration));
          observed.blockedMs += entry.duration;
        }
      });
      const events = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime < from) continue;
          observed.worstEventMs = Math.max(observed.worstEventMs, entry.duration);
        }
      });
      try {
        longTasks.observe({ type: 'longtask', buffered: false });
        // INP's own entry type. 16ms is one frame: below it there is nothing to report.
        // `durationThreshold` is Event Timing's own option and is not in the DOM lib's type.
        events.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
      } catch {
        /* an engine without either observer still gets the timings */
      }

      let error: string | undefined;
      for (let i = 0; i < n; i++) {
        setRunning(`${path} — run ${i + 1} of ${n}`);
        // A frame between runs, so the observers flush and the page repaints its progress.
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        try {
          runs.push(await PATHS[path](port.current, url, found.id));
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          break;
        }
      }
      longTasks.disconnect();
      events.disconnect();
      setResults((prev) => [...prev, { path, runs, observed, error }]);
    }
    setRunning(null);
  }

  const json = JSON.stringify(
    {
      dataset: sample,
      rows: results[0]?.runs[0]?.rows ?? null,
      n,
      operation: 'count and sum of home_score by home_team, ranked',
      environment: environment(),
      paths: results.map((r) => ({
        path: r.path,
        error: r.error ?? null,
        phases: summarise(r.runs),
        totalMs: summarise(r.runs).reduce((sum, p) => sum + p.stat.median, 0),
        observed: r.observed,
        columnarBytes: r.runs[0]?.bytes ?? null,
        groups: r.runs[0]?.groups ?? null,
      })),
    },
    null,
    2,
  );

  return (
    <div className="app bench">
      <main className="canvas">
        <h1>Benchmark</h1>
        <p className="muted">
          Three paths over one Dataset and one question. Aggregation is the cheapest step and is
          not what the worker is for — read <code>docs/adr/0004</code> before quoting a number
          from here. What separates the paths is parsing, inference, encoding and index building,
          and which thread they run on.
        </p>

        <div className="dev-actions">
          <label>
            Dataset{' '}
            <select value={sample} onChange={(e) => setSample(e.target.value)}>
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {s.rowCount.toLocaleString('en-US')} rows
                </option>
              ))}
            </select>
          </label>
          <label>
            Runs{' '}
            <input
              type="number"
              min={7}
              max={30}
              value={n}
              onChange={(e) => setN(Math.max(7, Number(e.target.value) || 7))}
            />
          </label>
          <button type="button" className="primary" disabled={running !== null} onClick={() => void run()}>
            {running ? 'Running…' : 'Run'}
          </button>
          {running && <span className="muted">{running}</span>}
        </div>

        {results.map((r) => (
          <section key={r.path}>
            <h2>{r.path}</h2>
            {r.error && <p className="notice notice-error">{r.error}</p>}
            <table className="result-table">
              <caption>
                {r.runs.length} runs · {r.runs[0]?.rows.toLocaleString('en-US')} rows ·{' '}
                {r.runs[0]?.groups.toLocaleString('en-US')} groups · main thread blocked{' '}
                {r.observed.blockedMs.toFixed(0)} ms in {r.observed.longTaskMs.length} long tasks
                {r.runs[0]?.bytes != null &&
                  ` · ${(r.runs[0].bytes / 1_048_576).toFixed(1)} MB of columns`}
                {r.observed.worstEventMs > 0 &&
                  ` · worst interaction ${r.observed.worstEventMs.toFixed(0)} ms`}
              </caption>
              <thead>
                <tr>
                  <th scope="col">phase</th>
                  <th scope="col">median (min – max)</th>
                </tr>
              </thead>
              <tbody>
                {summarise(r.runs).map(({ phase, stat }) => (
                  <tr key={phase}>
                    <th scope="row">{phase}</th>
                    <td>{range(stat)}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">total of the medians</th>
                  <td>{ms(summarise(r.runs).reduce((sum, p) => sum + p.stat.median, 0))}</td>
                </tr>
              </tbody>
            </table>
          </section>
        ))}

        {results.length > 0 && running === null && (
          <>
            <h2>The JSON to commit</h2>
            <p className="muted">
              Name the machine in the <code>machine</code> field before committing it, and say
              which Chrome built the <code>userAgent</code> — a version string is not a browser.
            </p>
            <textarea readOnly value={json} rows={16} aria-label="Benchmark JSON" />
          </>
        )}
      </main>
    </div>
  );
}
