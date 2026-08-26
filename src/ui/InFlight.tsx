/** The Request in flight, as a card on the canvas.

    It is the payoff of the whole streaming path: a narration sentence typed live tells the
    visitor they were understood before any data moves, and the chip strip beside it fills in as
    the specification's fields become readable. Both are display only.

    It subscribes to the Request slice and nothing else, so sixty narration flushes a second
    never re-render the rail or the chart. */
import { useEffect, useState } from 'react';
import { useApp } from '../store';

const PHASE: Record<string, { label: string; note: string }> = {
  thinking: { label: 'Thinking', note: 'writing the specification — no rows have been read yet' },
  repairing: { label: 'Correcting', note: 'the reply did not validate; one repair, then it stops' },
  executing: { label: 'Computing', note: 'running in the worker over the columns' },
  waiting: { label: 'Held', note: '' },
};

export function InFlight() {
  const request = useApp((s) => s.request);
  const secondsLeft = useCountdown(request?.retryAt ?? null);
  if (!request) return null;

  const phase = PHASE[request.status]!;
  const waiting = request.status === 'waiting';

  return (
    <section className="inflight" aria-live="polite">
      <div className="inflight-head">
        <span className={waiting ? 'spinner held' : 'spinner'} aria-hidden="true" />
        <span className="phase">{phase.label}</span>
        <span className="note">
          {waiting ? `${request.waiting} Retrying in ${secondsLeft}s` : phase.note}
        </span>
      </div>
      <p className="narration">
        {request.narration}
        <span className="caret" aria-hidden="true" />
      </p>
      {request.chips.length > 0 && (
        <ul className="chip-strip">
          {request.chips.map((chip, i) => (
            <li key={`${chip}-${i}`} className="chip spec-chip">
              {chip}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Ticks once a second, and only while there is something to count down. The deadline is in the
    store and the tick is not: a store that re-published every second would re-render everything
    subscribed to it for a number one element shows. */
function useCountdown(until: number | null): number {
  const [left, setLeft] = useState(() => remaining(until));
  useEffect(() => {
    setLeft(remaining(until));
    if (until === null) return;
    const timer = setInterval(() => setLeft(remaining(until)), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return left;
}

const remaining = (until: number | null) =>
  until === null ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000));
