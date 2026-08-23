/** Medians over benchmark runs. Its own module because every number that ships is one of these,
    and a test of it should not have to import a CSV parser to reach it. */
import type { Run } from './paths';

/** Median with its range, over N runs. Never a single run, and never a mean: one long GC pause
    moves a mean and leaves the median where it was. */
export type Stat = { n: number; median: number; min: number; max: number };

export function stat(xs: number[]): Stat {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return {
    n: sorted.length,
    median:
      sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2,
    min: sorted[0]!,
    max: sorted.at(-1)!,
  };
}

/** Every phase of a path, across its runs, in the order the phases ran. */
export function summarise(runs: Run[]): { phase: string; stat: Stat }[] {
  return (runs[0]?.phases ?? []).map(([phase], i) => ({
    phase,
    stat: stat(runs.map((r) => r.phases[i]![1])),
  }));
}
