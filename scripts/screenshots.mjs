/** The screenshots the README shows, taken from the running application rather than cropped by
 * hand — so that a UI change invalidates them visibly and one command puts them right again.
 *
 * Demo mode is what makes this scriptable at all: no key, and a fixed repertoire whose replies
 * are deterministic, so the same command produces the same chart every time. Free text is closed
 * in that mode by design, so each Question is chosen the way a visitor chooses it — click the
 * starter, then send it — which is also the flow `tests/workspace/starters.test.tsx` asserts.
 *
 * A plain `.mjs` with `assert`, the shape `scripts/e2e-run.mjs` and `scripts/bench-run.mjs`
 * already prove works. Start the app first, then:
 *
 *   npm run screenshots
 *   node scripts/screenshots.mjs --headed --url http://localhost:4173 --out docs/screenshots
 */
import assert from 'node:assert/strict';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { DEMO_REPERTOIRE } from '../src/ai/fixtures.ts';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? true);
};
const flag = (name) => process.argv.includes(`--${name}`);

const base = arg('url', 'http://localhost:5173');
const out = path.resolve(arg('out', 'docs/screenshots'));

/** 1600×900 at 2× — 16:9 exactly, because these are read in a portfolio grid that crops
    anything else, and retina because a README image is read at 2×. */
const VIEWPORT = { width: 1600, height: 900 };
const SCALE = 2;

const question = (dataset, needle) => {
  const f = DEMO_REPERTOIRE.find((f) => f.dataset === dataset && f.question.includes(needle));
  assert.ok(f, `no Fixture on ${dataset} matching “${needle}”`);
  return f;
};

/** The six shots, in the order the README wants them. Each names what it is evidence of, because
    a screenshot without a claim attached is decoration. */
const HERO = question('matches', 'hosted the most matches');
const TREND = question('matches', 'average home score');
const SCATTER = question('team_matches', 'goals scored compare');
const CLARIFY = question('matches', 'best team');

const browser = await chromium.launch({ headless: !flag('headed') });
const errors = [];
const taken = [];

/** A fresh page per shot. The theme lives in memory for the life of the tab and nothing is
    persisted anywhere, so a new page is a clean light-theme session — which is the only reason
    the dark shot does not leak into the five before it. */
async function open(sample) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.getByRole('button', { name: new RegExp(sample) }).click();
  await page.getByLabel('Question').waitFor({ timeout: 120_000 });
  return page;
}

/** A starter lands in the composer; sending it is a second, separate act. */
async function ask(page, fixture) {
  await page.locator('button', { hasText: fixture.question }).first().click();
  await page.getByRole('button', { name: 'Ask' }).click();
}

/** The replay streams with real gaps between deltas, so "the card is on screen" is not the same
    as "the card has settled" — and the chart is measured by a ResizeObserver, so the first frame
    after it appears can still carry the width from before layout. Photographing there produces a
    chart whose marks and axis disagree. Wait for the measured width to stop changing. */
async function settled(page, card) {
  await card.getByRole('img').waitFor({ timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const svg = document.querySelector('section.card.analysis svg');
      if (!svg) return false;
      const now = Math.round(svg.getBoundingClientRect().width);
      const last = globalThis.__w;
      globalThis.__w = now;
      return now > 0 && now === last;
    },
    null,
    { timeout: 30_000, polling: 250 },
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

async function shot(page, name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  taken.push(name);
  console.log(`  ${name}.png`);
}

const card = (page) => page.locator('section.card.analysis').first();

/** 01 — the picker: four samples, their sizes, and what each is there to demonstrate. The first
    screen a stranger meets, and the one that says this runs on real data without a signup. */
async function picker() {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.getByRole('button', { name: /International football matches/ }).waitFor({ timeout: 60_000 });
  await shot(page, '01-picker');
  await page.close();
}

/** 02 — the answer: a Question in English, the model's one-sentence Narration, and a chart whose
    every figure was computed from the rows by the worker. The hero image. */
async function answer() {
  const page = await open('International football matches');
  await ask(page, HERO);
  await settled(page, card(page));
  await shot(page, '02-answer');

  // 03 — the same Analysis as its own data table: the accessible representation, which is also
  // the chart test harness, exposed as a product feature rather than a hidden `aria-` string.
  await card(page).getByRole('button', { name: 'View as table' }).click();
  await page.locator('section.card.analysis table tbody tr').first().waitFor({ timeout: 30_000 });
  await shot(page, '03-table');
  await page.close();
}

/** 04 — the scatter: 98,899 points on one canvas per Series past the 5,000-point budget, with the
    quadtree hit-test keeping the tooltip identical either side of the switch (ADR-0023). */
async function scatter() {
  const page = await open('Team-match results');
  await ask(page, SCATTER);
  await settled(page, card(page));
  await shot(page, '04-scatter');
  await page.close();
}

/** 05 — the refusal: a Question with several defensible readings gets asked back, with options
    that are themselves Questions inside the grammar. Hitting the ceiling is never an error. */
async function clarification() {
  const page = await open('International football matches');
  await ask(page, CLARIFY);
  await page.getByText(CLARIFY.input.question).waitFor({ timeout: 120_000 });
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await shot(page, '05-clarification');
  await page.close();
}

/** 06 — the dark theme, on a different Question so the pair is not the same picture twice. Both
    themes are audited for contrast by `npm run audit:contrast`. */
async function dark() {
  const page = await open('International football matches');
  await page.getByRole('button', { name: 'Switch to the dark theme' }).click();
  await ask(page, TREND);
  await settled(page, card(page));
  await shot(page, '06-dark');
  await page.close();
}

try {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  console.log(`${base} → ${path.relative(process.cwd(), out)}/\n`);

  await picker();
  await answer();
  await scatter();
  await clarification();
  await dark();

  assert.deepEqual(errors, [], 'the page threw while being photographed');
  const written = (await readdir(out)).filter((f) => f.endsWith('.png'));
  assert.equal(written.length, taken.length, `${taken.length} shots asked for, ${written.length} written`);
  console.log(`\n${written.length} screenshots at ${VIEWPORT.width}×${VIEWPORT.height} @${SCALE}x`);
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  if (errors.length) console.error(`page errors: ${errors.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
