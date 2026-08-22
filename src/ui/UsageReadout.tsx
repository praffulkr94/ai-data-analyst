/** Tokens and cost, in the manner of a chat interface rather than buried in a panel.

    Every number here is what the API reported on the stream — `message_start` for input and cache
    reads, `message_delta` for output. Never estimated, and never a second `count_tokens` call,
    which would cost a round trip to report on a round trip.

    The cached figure is shown separately on purpose. The minimum cacheable prefix is roughly
    1,024 tokens and a shorter one silently fails to cache, so a caching claim that is not visible
    is a caching claim that is not checked. */
import { buildRequest } from '../ai/anthropic';
import { costOf, MODELS } from '../ai/models';
import { useApp } from '../store';

export function UsageReadout() {
  const usage = useApp((s) => s.usage);
  const columns = useApp((s) => s.columns);
  const model = useApp((s) => s.model);
  const mode = useApp((s) => s.mode);
  const question = useApp((s) => s.request?.question ?? '');

  const last = usage.last;
  const recorded = last?.recorded ?? mode === 'demo';
  const total = costOf(model, usage.total);

  return (
    <details className="usage">
      <summary>
        {last ? (
          <>
            <span>
              {num(last.inputTokens + last.cacheReadTokens)} in · {num(last.outputTokens)} out
            </span>
            {last.cacheReadTokens > 0 && (
              <span className="usage-cache" title="Served from the prompt cache at a tenth the price">
                {num(last.cacheReadTokens)} cached
              </span>
            )}
          </>
        ) : (
          <span className="muted">No questions asked yet</span>
        )}
        <span className="usage-total">
          {usage.requests} {usage.requests === 1 ? 'question' : 'questions'} ·{' '}
          {recorded ? <em>recorded, $0.00</em> : money(total)}
        </span>
      </summary>

      <table className="usage-table">
        <tbody>
          <Row label="Input (uncached)" value={num(last?.inputTokens ?? 0)} />
          <Row label="Input (cache read)" value={num(last?.cacheReadTokens ?? 0)} />
          <Row label="Input (cache write)" value={num(last?.cacheWriteTokens ?? 0)} />
          <Row label="Output" value={num(last?.outputTokens ?? 0)} />
          <Row label="Model" value={MODELS[last?.model ?? model].id} />
          <Row label="Session total" value={`${num(sum(usage.total))} tokens · ${money(total)}`} />
        </tbody>
      </table>
      {recorded && (
        <p className="muted">
          Demo mode replays a recorded response. The counts are the ones that response really
          used; nothing was charged.
        </p>
      )}

      <details className="inspector">
        <summary>What the model sees</summary>
        <p className="muted">
          Exactly the request that goes over the wire. The DatasetSchema is there; the rows are
          not, and this is the place to check that rather than take it on trust.
        </p>
        <pre>
          {JSON.stringify(
            buildRequest({
              question: question || 'your question goes here',
              schema: { columns },
              model,
            }),
            null,
            2,
          )}
        </pre>
      </details>
    </details>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <tr>
    <th scope="row">{label}</th>
    <td>{value}</td>
  </tr>
);

const sum = (t: { [k: string]: number }) => Object.values(t).reduce((a, b) => a + b, 0);
const num = (n: number) => n.toLocaleString('en-US');
/** Sub-cent costs are the normal case here, so two decimals would read as free. */
const money = (n: number) => (n === 0 ? '$0.00' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
