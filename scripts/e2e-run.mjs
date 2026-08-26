/** The two Playwright flows DECISIONS §14 asks for — ask → chart, and cancel mid-request →
 * resubmit succeeds — driven over canned SSE.
 *
 * `@playwright/test` is deliberately not installed: this is a plain `.mjs` with `assert`, the
 * shape `scripts/bench-run.mjs` already proves works. `page.route('**\/v1/messages')` answers
 * both calls the application makes — the one-token key check, and the streamed tool use — and the
 * SSE frames are built from `src/ai/fixtures.ts`, the same recordings Demo mode replays. That
 * dual use is why the Fixtures beat a proxy (§10), and SSE parsing plus abort behaviour is where
 * the real bugs live, so the transport is the one thing not stubbed above.
 *
 * Start the app first (`npm run dev`, or `npm run build && npm run preview`), then:
 *
 *   npm run test:e2e
 *   node scripts/e2e-run.mjs --headed --url http://localhost:4173
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DEMO_REPERTOIRE } from '../src/ai/fixtures.ts';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? true);
};
const flag = (name) => process.argv.includes(`--${name}`);

const base = arg('url', 'http://localhost:5173');
const MODEL = 'claude-sonnet-5';
const KEY = 'sk-ant-e2e-not-a-real-key';

/** The Question both flows ask, and the reply the stub streams back for it. */
const fixture = DEMO_REPERTOIRE.find(
  (f) => f.dataset === 'matches' && f.input.kind === 'analysis' && f.input.intent === 'new',
);
assert.ok(fixture, 'no `matches` analysis Fixture to drive the flows with');

const TOOL_NAME = {
  analysis: 'submit_analysis',
  clarification: 'ask_clarification',
  unsupported: 'report_unsupported',
};

/** A cross-origin fulfil is still subject to CORS, and the SDK's custom headers mean the browser
    preflights first. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const split = (text, size) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [];

/** Real frames, several deltas each, in the order the API sends them: the narration as
    `text_delta`, the tool call as `input_json_delta`. Anything less and the chip strip and the
    tolerant partial reader would never run. */
function sseBody(f) {
  const frame = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const u = f.usage;
  let out = frame('message_start', {
    message: {
      id: 'msg_e2e',
      type: 'message',
      role: 'assistant',
      model: MODEL,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: u.inputTokens,
        output_tokens: 1,
        cache_read_input_tokens: u.cacheReadTokens,
        cache_creation_input_tokens: u.cacheWriteTokens,
      },
    },
  });
  out += frame('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  for (const text of split(f.narration, 8)) {
    out += frame('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
  }
  out += frame('content_block_stop', { index: 0 });
  out += frame('content_block_start', {
    index: 1,
    content_block: { type: 'tool_use', id: 'toolu_e2e', name: TOOL_NAME[f.input.kind], input: {} },
  });
  for (const partial_json of split(JSON.stringify(f.input), 28)) {
    out += frame('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json } });
  }
  out += frame('content_block_stop', { index: 1 });
  out += frame('message_delta', {
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: u.outputTokens },
  });
  out += frame('message_stop', {});
  return out;
}

/** The key check is a non-streaming `messages.create`, so the same route has to answer both. */
const verifyBody = JSON.stringify({
  id: 'msg_e2e_verify',
  type: 'message',
  role: 'assistant',
  model: MODEL,
  content: [{ type: 'text', text: 'hi' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 8, output_tokens: 1 },
});

/** `hold` is how a cancel gets somewhere to land: the fulfil waits, the Request sits in flight,
    and the abort arrives while it does. `route.fulfill` cannot dribble a body out frame by frame,
    so the cancel is mid-request rather than between two deltas — the abort path under test is the
    same one either way, and it is the only part of the flow the stub cannot make faithful. */
const stub = { hold: 0, streams: 0 };

async function route(page) {
  await page.route('**/v1/messages*', async (r) => {
    if (r.request().method() === 'OPTIONS') {
      await r.fulfill({ status: 204, headers: CORS }).catch(() => {});
      return;
    }
    const body = r.request().postDataJSON() ?? {};
    if (!body.stream) {
      await r
        .fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: verifyBody })
        .catch(() => {});
      return;
    }
    stub.streams++;
    if (stub.hold) await new Promise((done) => setTimeout(done, stub.hold));
    // A cancelled request is gone by now, and fulfilling it throws rather than returning.
    await r
      .fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'text/event-stream' },
        body: sseBody(fixture),
      })
      .catch(() => {});
  });
}

const browser = await chromium.launch({ headless: !flag('headed') });
const errors = [];

/** A page with the Dataset loaded and BYOK mode on — which means going through the key dialog,
    because the key lives in a module variable and a fresh page has none. */
async function ready() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await route(page);
  await page.goto(base);
  await page.getByRole('button', { name: /International football matches/ }).click();
  // No Continue click: the inference gate opens only for a Dataset with a column in doubt, and
  // every column of this one types confidently (ADR-0027). The waits below are what stand in for
  // it — they fail loudly if a re-inference ever puts a gate back in this path.
  await page.getByRole('button', { name: 'Your API key' }).click();
  await page.getByLabel('API key').fill(KEY);
  await page.getByRole('button', { name: 'Verify and switch' }).click();
  const question = page.getByLabel('Question');
  await question.and(page.locator(':not([disabled])')).waitFor({ timeout: 120_000 });
  return page;
}

const analyses = (page) => page.locator('section.card.analysis');

/** The in-flight card is transient — `route.fulfill` hands over the whole body at once, so every
    delta is read in one task, React coalesces them into a single render and the card can come and
    go between two Playwright polls. What it showed is therefore recorded from inside the page:
    the last narration is what the `text_delta` frames added up to, and the chips are what the
    tolerant partial reader made of the `input_json_delta` ones. */
const watchStream = (page) =>
  page.evaluate(() => {
    const seen = (globalThis.__stream = { narration: [], chips: [] });
    new MutationObserver(() => {
      const text = document.querySelector('.inflight .narration')?.textContent;
      if (text && seen.narration.at(-1) !== text) seen.narration.push(text);
      const chips = [...document.querySelectorAll('.inflight .chip')].map((c) => c.textContent);
      if (chips.length > seen.chips.length) seen.chips = chips;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

async function ask(page) {
  await page.getByLabel('Question').fill(fixture.question);
  await page.getByRole('button', { name: 'Ask' }).click();
}

/** Flow one: ask → chart. The reply arrives as SSE, is parsed by the SDK, validated, executed in
    the worker and drawn — and the chart is checked through its accessible name and its data
    table, never through path geometry. */
async function askToChart(page) {
  await watchStream(page);
  await ask(page);
  const card = analyses(page).first();
  await card.getByRole('heading', { name: fixture.input.title }).waitFor({ timeout: 120_000 });

  const stream = await page.evaluate(() => globalThis.__stream);
  assert.equal(
    stream.narration.at(-1),
    fixture.narration,
    'the narration the strip showed was not what the text deltas spelled out',
  );
  assert.ok(stream.chips.length > 0, 'the chip strip never published a field');

  const chart = card.getByRole('img');
  await chart.waitFor({ timeout: 60_000 });
  const label = await chart.getAttribute('aria-labelledby');
  assert.ok(label, 'the chart has no accessible name');
  const name = (await card.locator(`#${label}`).textContent()) ?? '';
  assert.match(name, /^(Bar|Line|Area|Scatter) chart/, `chart label was “${name}”`);

  await card.getByRole('button', { name: 'View as table' }).click();
  const header = card.locator('table th').first();
  assert.equal((await header.textContent())?.trim(), fixture.input.visualization.x);
  const rows = await card.locator('table tbody tr').count();
  assert.ok(rows > 1, `the data table has ${rows} rows`);
  assert.equal(await analyses(page).count(), 1);
  console.log(
    `ask → chart: “${fixture.question}” → ${name} · ${rows} rows in the table · ` +
      `${stream.chips.length} chips`,
  );
}

/** Flow two: cancel, then resubmit. The cancelled Request must leave nothing behind — no
    Analysis, no notice — and the resubmission must land as the only Analysis on screen. */
async function cancelToResubmit(page) {
  stub.hold = 4_000;
  const before = stub.streams;
  await ask(page);
  const cancel = page.locator('.composer').getByRole('button', { name: 'Cancel', exact: true });
  await cancel.waitFor({ timeout: 30_000 });
  await page.locator('.inflight .phase').filter({ hasText: 'Thinking' }).waitFor({ timeout: 30_000 });
  await cancel.click();

  await page.getByRole('button', { name: 'Ask' }).waitFor({ timeout: 30_000 });
  assert.equal(await page.locator('.inflight').count(), 0, 'the cancelled Request is still on screen');
  assert.equal(await analyses(page).count(), 0, 'the cancelled Request left an Analysis behind');
  assert.equal(await page.getByRole('alert').count(), 0, 'a cancel reported an error');
  assert.equal(stub.streams, before + 1, 'the cancelled Request never reached the transport');

  stub.hold = 0;
  await ask(page);
  await analyses(page)
    .first()
    .getByRole('heading', { name: fixture.input.title })
    .waitFor({ timeout: 120_000 });
  assert.equal(await analyses(page).count(), 1, 'the resubmission is not the only Analysis');
  console.log(`cancel → resubmit: cancelled mid-request, resubmitted, one Analysis on screen`);
}

/** The observers have been running since before anything else in `main.tsx`, so this covers the
    whole scripted session. INP only ever times a real interaction, so this readout is the only
    place an INP figure can come from at all — and it is reported, not asserted: a click that
    stays under one frame legitimately produces no reading. */
async function instrumentation(page) {
  const r = await page.evaluate(() => globalThis.__perf?.() ?? null);
  assert.ok(r, 'the performance observers were never installed');
  console.log(
    `instrumentation: ${r.longTasks} long tasks on the main thread, ` +
      `${r.blockedMs.toFixed(0)} ms in all · ` +
      (r.worstInteractionMs > 0
        ? `slowest interaction ${r.worstInteractionMs.toFixed(0)} ms (${r.worstInteraction})`
        : 'no interaction over one frame'),
  );
}

try {
  const first = await ready();
  await askToChart(first);
  await instrumentation(first);
  await first.close();

  const second = await ready();
  await cancelToResubmit(second);
  await second.close();

  assert.deepEqual(errors, [], 'the page threw');
  console.log('\nboth flows passed');
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  if (errors.length) console.error(`page errors: ${errors.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
