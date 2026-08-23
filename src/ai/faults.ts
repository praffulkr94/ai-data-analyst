/** Dev-only. Every starred row of the failure taxonomy has to be demonstrable on demand
    (DECISIONS §18), and most of those rows are properties of a reply the model would have to
    misbehave to produce. This is the one place that can make it misbehave.

    A fault is armed from the dev panel and consumed by the Fixture Translator, so the failure
    travels the whole real path — the Repair, the staleness guard, the notice — rather than being
    drawn as a picture of itself. `times` is what separates the two demonstrations that matter:
    once is the glitch the single Repair hides, twice is the recoverable message. */
export type Fault =
  | 'malformed'
  | 'max-tokens'
  | 'no-tool'
  | 'unknown-column'
  | 'rate-limit'
  | 'overloaded';

let armed: { fault: Fault; times: number } | null = null;

export const armFault = (fault: Fault, times = 1): void => {
  armed = { fault, times };
};

/** Consumes one use. Nothing outside the Fixture Translator should call this. */
export function takeFault(): Fault | null {
  if (!armed) return null;
  const { fault } = armed;
  if (--armed.times <= 0) armed = null;
  return fault;
}
