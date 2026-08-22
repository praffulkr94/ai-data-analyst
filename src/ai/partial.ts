/** A tolerant reader over half-arrived tool JSON, and the chips it feeds.

    **Display only.** Nothing here ever reaches Zod. A partially-received specification cannot be
    validated and cannot be executed, so this exists purely so the visitor watches the
    interpretation take shape while it arrives (ADR-0007). At `message_stop` the complete JSON
    goes through `ModelReply.safeParse` like any other input, and whatever this function guessed
    on the way is discarded. */

/** Close whatever the stream left open: an unterminated string, a dangling key, a trailing comma
    or colon, and every unclosed object and array.

    A string in progress is either a key or a value, and the difference matters. `{"opera` closed
    as a string yields `{"opera"}`, which is not JSON at all; dropped back to `{` it is an empty
    object. What decides it is the character before the opening quote *and* the container the
    string sits in — a comma inside an array precedes a value, not a key. */
function close(text: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  /** The closer of the container the open string sits in: `}` for an object, `]` for an array.
      Only an object has keys, so only there can a comma be followed by one. */
  let stringContainer = '';

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      stringStart = i;
      stringContainer = stack.at(-1) ?? '';
    } else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      if (stack.pop() === undefined) return null;
    }
  }

  let body = text;
  if (inString) {
    const before = body.slice(0, stringStart).trimEnd();
    const isKey = stringContainer === '}' && (before.endsWith('{') || before.endsWith(','));
    body = isKey ? before : body + (escaped ? '\\"' : '"');
  }
  body = body.trimEnd();
  while (body.endsWith(',')) body = body.slice(0, -1).trimEnd();
  if (body.endsWith(':')) body += 'null';
  return body + stack.reverse().join('');
}

/** How far back the reader will trim to find something parseable. Reached only by a truncated
    number or keyword — `tru`, `1.`, `-` — which `close` cannot repair.
    ponytail: a fixed lookback rather than a real incremental parser; if a longer literal ever
    appears in the grammar, raise it or parse properly. */
const LOOKBACK = 24;

export function readPartial(text: string): unknown {
  for (let cut = 0; cut <= LOOKBACK && cut < text.length; cut++) {
    const closed = close(text.slice(0, text.length - cut));
    if (closed === null) continue;
    try {
      return JSON.parse(closed);
    } catch {
      // Keep trimming: the tail is a token the stream has not finished sending.
    }
  }
  return undefined;
}

/** The chip strip: the specification's fields as they become readable, in the order the pipeline
    applies them. Short enough to read at a glance and never a substitute for the chart. */
export function chipsFrom(partial: unknown): string[] {
  const reply = partial as {
    operation?: {
      filters?: { op?: string; column?: string; value?: unknown; values?: unknown[] }[];
      timeBucket?: { column?: string; unit?: string } | null;
      groupBy?: string[];
      aggregations?: { fn?: string; column?: string | null }[];
    };
    visualization?: { type?: string };
  };
  const chips: string[] = [];
  const op = reply?.operation;

  for (const f of op?.filters ?? []) {
    if (!f?.column || !f.op) continue;
    const value = f.values ? `${f.values.length} values` : f.value;
    chips.push(value === undefined ? `${f.column} ${f.op}` : `${f.column} ${f.op} ${value}`);
  }
  if (op?.timeBucket?.column) {
    chips.push(
      op.timeBucket.unit ? `${op.timeBucket.column} by ${op.timeBucket.unit}` : op.timeBucket.column,
    );
  }
  for (const g of op?.groupBy ?? []) if (g) chips.push(g);
  for (const a of op?.aggregations ?? []) {
    if (!a?.fn) continue;
    chips.push(a.column ? `${a.fn} ${a.column}` : a.fn);
  }
  if (reply?.visualization?.type) chips.push(reply.visualization.type);
  return chips;
}
