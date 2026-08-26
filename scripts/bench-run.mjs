/** Drives `#/bench` and commits its JSON, so the numbers in the README are reproducible by
 * somebody who is not me — which is the whole of DECISIONS §13's argument.
 *
 * Start the app first (`npm run dev`, or `npm run build && npm run preview`), then:
 *
 *   node scripts/bench-run.mjs --machine "MacBook Pro, Apple M3 Max, 36 GB, macOS 26.5.1"
 *   node scripts/bench-run.mjs --headed --runs 9        # a real window, not headless
 *   node scripts/bench-run.mjs --url http://localhost:4173
 *
 * It writes one file per question into `docs/bench/`, and then measures the one thing the bench
 * page cannot: the canvas draw loop of a real pan, in the application, over 98,899 points.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? true);
};
const flag = (name) => process.argv.includes(`--${name}`);

const base = arg('url', 'http://localhost:5173');
const runs = Number(arg('runs', 9));
const machine = arg('machine', 'unnamed — pass --machine');
const out = new URL('../docs/bench/', import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: !flag('headed') });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', (e) => console.error('page error:', String(e)));

/** One question of the bench page, N runs of each of its three paths. */
async function bench(index) {
  await page.goto(`${base}/#/bench`);
  await page.waitForSelector('h1');
  await page.selectOption('select', String(index));
  await page.fill('input[type=number]', String(runs));
  const label = await page.locator('select option:checked').innerText();
  console.log(`\n${label} — ${runs} runs of each path`);
  await page.getByRole('button', { name: 'Run' }).click();
  await page.waitForFunction(() => !!document.querySelector('textarea'), null, { timeout: 900_000 });

  const json = JSON.parse(await page.locator('textarea').inputValue());
  json.environment.machine = machine;
  json.environment.headless = !flag('headed');
  json.driver = 'scripts/bench-run.mjs';
  const file = new URL(`${json.dataset}-${json.paths.length ? json.rows : 0}.json`, out);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  for (const path of json.paths) {
    console.log(
      `  ${path.path.padEnd(24)} ${path.totalMs.toFixed(0).padStart(4)} ms total · ` +
        `${path.observed.blockedMs.toFixed(0).padStart(4)} ms blocked in ${path.observed.longTaskMs.length} long tasks`,
    );
  }
  console.log(`  → ${file.pathname.split('/').slice(-2).join('/')}`);
  return json;
}

/** The other half of what M8 shipped unmeasured: what one frame of a pan costs at 98,899
    points. Panned in the application rather than in the bench page, because the draw loop only
    exists where there is a chart — and read out of the performance timeline, which is where the
    application already puts it. */
async function pan() {
  await page.goto(base);
  await page.getByRole('button', { name: /Team-match results/ }).click();
  // The inference gate stands between parsing and the workspace (ADR-0026).
  await page.getByRole('button', { name: 'Continue' }).click({ timeout: 120_000 });
  await page.getByRole('button', { name: /goals scored compare with goals conceded/ }).click();
  await page.waitForSelector('canvas', { timeout: 120_000 });
  await page.waitForTimeout(2_000);

  const surface = page.locator('[role="application"]');
  await surface.focus();
  const drawsSince = async () =>
    page.evaluate(() =>
      performance.getEntriesByName('canvas:draw', 'measure').map((e) => Math.round(e.duration * 10) / 10),
    );
  const clear = () => page.evaluate(() => performance.clearMeasures('canvas:draw'));
  const press = async (key) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  };

  // A pan in one direction, which is the gesture a drag is. Arrow keys and not a synthetic
  // drag: pointermove coalescing would make the number of frames a matter of luck.
  await clear();
  for (let i = 0; i < runs; i++) await press('ArrowRight');
  const pans = await drawsSince();

  /** An anomaly worth recording rather than smoothing over: a frame that lands the view exactly
      back at the origin costs about five times one that moves it further away, reproducibly and
      for no reason yet established. Alternating presses show it plainly, and the number above is
      deliberately the continuous pan — that is the gesture, and the origin is one frame of it. */
  await press('Home');
  await clear();
  for (let i = 0; i < 6; i++) await press(i % 2 ? 'ArrowLeft' : 'ArrowRight');
  const alternating = await drawsSince();

  const points = await page
    .locator('.chart-caption')
    .innerText()
    .catch(() => '');
  const sorted = [...pans].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  console.log(
    `\ncanvas draw loop — ${pans.length} pans in one direction: median ${median?.toFixed(1)} ms ` +
      `(${sorted[0]?.toFixed(1)} – ${sorted.at(-1)?.toFixed(1)}) · ${points.slice(0, 40)}\n` +
      `  alternating, which lands on the origin every other frame: ${alternating.join(', ')}`,
  );
  return { pans, median, alternating };
}

const questions = [await bench(0), await bench(1)];
const canvas = await pan();
writeFileSync(
  new URL('canvas-pan.json', out),
  `${JSON.stringify(
    {
      what: 'the canvas draw loop, one arrow-key pan per entry, 98,899 points on team_matches',
      environment: { ...questions[1].environment, machine },
      runs: canvas.pans,
      medianMs: canvas.median,
      anomaly:
        'A frame that returns the view exactly to the origin costs about five times one that ' +
        'moves it further out, reproducibly, and the cause is not established. These are ' +
        'alternating presses: every other entry is a draw at pan {0,0}.',
      alternatingMs: canvas.alternating,
    },
    null,
    2,
  )}\n`,
);
await browser.close();
