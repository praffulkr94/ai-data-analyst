/** The ask → chart flow as a looping GIF, driven the way `scripts/screenshots.mjs` drives the
 * stills: the real application in Demo mode, no key, nothing staged.
 *
 * Two things make a scripted recording watchable rather than merely accurate.
 *
 * A cursor: Playwright's video has no pointer, so an unaided recording is a sequence of things
 * happening by themselves. `cursor()` injects one outside `#root` — React never owns it — and
 * every click travels there first, at a speed a person can follow.
 *
 * Pacing: Playwright acts faster than anyone can read. The `beat` constants below are the
 * script's only dramatic licence; the streaming itself is not slowed down, because
 * `fixtureTranslator.ts` already replays deltas at the gaps a real stream arrives in.
 *
 * Needs ffmpeg on PATH for the encode. Start the app first, then:
 *
 *   npm run demo:gif
 *   node scripts/demo-gif.mjs --url http://localhost:4173 --out docs/screenshots/ask-to-chart.gif
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { DEMO_REPERTOIRE } from '../src/ai/fixtures.ts';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? true);
};

const base = arg('url', 'http://localhost:5173');
const out = path.resolve(arg('out', 'docs/screenshots/ask-to-chart.gif'));
const FPS = Number(arg('fps', 12));

/** 1280×720 — 16:9 like the stills, but the GIF is read inline in a README at about 900px, and
    every pixel above that is weight for nothing. The 1040px column still sits comfortably. */
const VIEWPORT = { width: 1280, height: 720 };

/** How long each moment is held. Read as a storyboard. */
const BEAT = {
  settle: 900, // the picker, before anything is touched
  travel: 500, // a cursor crossing the screen
  afterPick: 500, // the Dataset named in the header
  readStarter: 1000, // the Question list, long enough to see it is a list
  inComposer: 1000, // the Question sitting in the box, not yet sent
  onChart: 2600, // the result, before the loop restarts
};

/* These are tuned against the parse, which is not a beat and cannot be shortened: picking the
   Dataset really does take a second or so to read, type and encode 49,520 rows in the worker,
   and that second is on screen. Left long, the Question list ate half the recording. */

const FIXTURE = DEMO_REPERTOIRE.find(
  (f) => f.dataset === 'matches' && f.question.includes('hosted the most matches'),
);
assert.ok(FIXTURE, 'no `matches` Fixture to record');

/** A pointer that survives React, because it is not inside the tree React renders. The ring is
    what a click looks like; the dot is where it is. */
const CURSOR_CSS = `
  #__cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
    width: 22px; height: 22px; margin: -11px 0 0 -11px;
    transition: transform 600ms cubic-bezier(.4,0,.2,1); will-change: transform; }
  #__cursor .dot { position: absolute; inset: 6px; border-radius: 50%;
    background: rgba(30,30,35,.92); box-shadow: 0 0 0 2px rgba(255,255,255,.9), 0 2px 6px rgba(0,0,0,.3); }
  #__cursor .ring { position: absolute; inset: 0; border-radius: 50%;
    border: 2px solid rgba(60,110,240,.9); opacity: 0; transform: scale(.4); }
  #__cursor.tap .ring { animation: __tap 420ms ease-out; }
  @keyframes __tap { 0% { opacity: .9; transform: scale(.4);} 100% { opacity: 0; transform: scale(1.7);} }
`;

async function cursor(page) {
  await page.addStyleTag({ content: CURSOR_CSS });
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = '__cursor';
    el.innerHTML = '<div class="ring"></div><div class="dot"></div>';
    // Off the bottom corner to begin with, so it enters rather than appearing mid-screen.
    el.style.transform = 'translate(640px, 760px)';
    document.body.appendChild(el);
  });
}

const moveTo = async (page, locator) => {
  const box = await locator.boundingBox();
  assert.ok(box, 'cannot move the cursor to something with no box');
  await page.evaluate(
    ([x, y]) => {
      const el = document.getElementById('__cursor');
      if (el) el.style.transform = `translate(${x}px, ${y}px)`;
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  await page.waitForTimeout(BEAT.travel);
};

/** Travel, tap, then really click — the ring fires slightly before the click so the feedback
    reads as the cause of what follows rather than as a reaction to it. */
async function click(page, locator) {
  await moveTo(page, locator);
  await page.evaluate(() => {
    const el = document.getElementById('__cursor');
    if (!el) return;
    el.classList.remove('tap');
    void el.offsetWidth;
    el.classList.add('tap');
  });
  await page.waitForTimeout(140);
  await locator.click();
}

const tmp = await mkdtemp(path.join(tmpdir(), 'analyst-gif-'));
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: tmp, size: VIEWPORT },
  deviceScaleFactor: 1,
});
const errors = [];

try {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  // Recording began with the context, so everything before the first paint — the navigation and
  // the module graph — is dead frames at the head of a loop. Time it, and cut it below.
  const started = Date.now();
  await page.goto(base);

  const sample = page.getByRole('button', { name: /International football matches/ });
  await sample.waitFor({ timeout: 120_000 });
  await cursor(page);
  const blankMs = Date.now() - started;
  await page.waitForTimeout(BEAT.settle);

  // Pick the Dataset. 49,520 rows are parsed, typed and encoded in the worker from here.
  await click(page, sample);
  await page.getByLabel('Question').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(BEAT.afterPick);

  // The Questions Demo mode can answer. A starter lands in the composer; sending it is separate,
  // which is the whole point of the two beats here.
  const starter = page.locator('button', { hasText: FIXTURE.question }).first();
  await starter.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(BEAT.readStarter);
  await click(page, starter);
  await page.waitForTimeout(BEAT.inComposer);

  // Ask. The Narration streams as text deltas, the chip strip fills from the tool call's
  // partial JSON, and neither is slowed down for the camera.
  await click(page, page.getByRole('button', { name: 'Ask' }));

  const card = page.locator('section.card.analysis').first();
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
  await page.waitForTimeout(BEAT.onChart);

  const video = page.video();
  assert.ok(video, 'Playwright recorded no video');
  await page.close();
  await context.close();
  const webm = await video.path();

  assert.deepEqual(errors, [], 'the page threw while being recorded');

  await mkdir(path.dirname(out), { recursive: true });
  // Two passes: one to learn the palette this UI actually uses, one to apply it. A flat 256
  // colours turns the chart's blues into bands, and `bayer` dithering keeps the type crisp
  // where a diffusing dither would smear it.
  const palette = path.join(tmp, 'palette.png');
  const filters = `fps=${FPS},scale=${VIEWPORT.width}:-1:flags=lanczos`;
  // Keep a beat of the painted picker before the cursor moves, and drop the rest of the lead-in.
  const seek = Math.max(0, blankMs - 250) / 1000;
  const from = ['-ss', seek.toFixed(2), '-i', webm];
  execFileSync('ffmpeg', ['-y', ...from, '-vf', `${filters},palettegen=stats_mode=diff`, palette], {
    stdio: 'pipe',
  });
  execFileSync(
    'ffmpeg',
    ['-y', ...from, '-i', palette, '-lavfi',
     `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
     '-loop', '0', out],
    { stdio: 'pipe' },
  );

  const { size } = await stat(out);
  console.log(`${path.relative(process.cwd(), out)} — ${(size / 1e6).toFixed(1)} MB, ${FPS} fps, ${VIEWPORT.width}×${VIEWPORT.height}`);
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  if (errors.length) console.error(`page errors: ${errors.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  await rm(tmp, { recursive: true, force: true });
}
