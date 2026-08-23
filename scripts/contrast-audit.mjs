/** The contrast audit, over the tokens the application actually paints with.
 *
 * Reads `src/styles/tokens.css` — the tokens are literal hex, fixed by DECISIONS §A5, so the
 * numbers here are the numbers on screen — and reports WCAG 2.1 contrast for every pair that
 * carries meaning, in both themes.
 *
 * It is a check and not only a report: the three light-mode sub-3:1 series slots are *expected*
 * (DECISIONS §A5, ADR-0012) and are listed below by name. Any other failure, or one of those
 * three passing where it used to fail, exits non-zero — a palette edit that quietly widens the
 * relief obligation should break something.
 *
 *   node scripts/contrast-audit.mjs            # markdown to stdout
 */
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

/** The two token blocks, by the selector that introduces them. A token absent from the dark
    block keeps its light value, which is how the file is written. */
function tokens(selector) {
  const at = CSS.indexOf(selector);
  const block = CSS.slice(at, CSS.indexOf('}', at));
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]),
  );
}
const light = tokens(':root {');
const dark = { ...light, ...tokens(":root[data-theme='dark']") };

/** WCAG 2.1 relative luminance and contrast ratio. sRGB, no colour management: what the browser
    does for a flat hex over a flat hex. */
const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** What each pair has to clear. 4.5 for text under 18.66px, 3.0 for a graphic or UI component
    that carries meaning — a series colour, a focus ring. Axis and grid lines are marked 0: they
    are scaffolding for a mark that carries its own value, and the mark is what must be seen. */
const PAIRS = [
  ['body text', '--text', '--surface', 4.5],
  ['body text on a raised surface', '--text', '--surface-raised', 4.5],
  ['body text on a sunken surface', '--text', '--surface-sunken', 4.5],
  ['direct labels on marks', '--text', '--surface', 4.5],
  ['axis and Series labels', '--text-muted', '--surface', 4.5],
  ['axis and Series labels, raised', '--text-muted', '--surface-raised', 4.5],
  ['series 1 · blue', '--series-1', '--surface', 3],
  ['series 2 · orange', '--series-2', '--surface', 3],
  ['series 3 · aqua', '--series-3', '--surface', 3],
  ['series 4 · yellow', '--series-4', '--surface', 3],
  ['series 5 · magenta', '--series-5', '--surface', 3],
  ['series 6 · green', '--series-6', '--surface', 3],
  ['accent, its own text on it', '--accent-on', '--accent', 4.5],
  ['accent hover, its own text on it', '--accent-on-hover', '--accent-hover', 4.5],
  ['accent against the surface', '--accent', '--surface', 3],
  ['focus ring', '--accent-focus-tint', '--surface', 3],
  ['focus ring on a raised surface', '--accent-focus-tint', '--surface-raised', 3],
  // `good` colours the cache figure in the readout, so it is text and takes the text floor.
  // The other four are a border stripe beside text that names the state — a status colour never
  // carries meaning alone (§A5) — so they are measured and reported but not required to clear
  // 3:1. Move one of them onto text and this line is what has to change with it.
  ['status · good, as text', '--status-good', '--surface', 4.5],
  ['status stripe · warning', '--status-warning', '--surface', 0],
  ['status stripe · serious', '--status-serious', '--surface', 0],
  ['status stripe · critical', '--status-critical', '--surface', 0],
  ['status stripe · error', '--status-error', '--surface', 0],
  ['axis lines', '--border-strong', '--surface', 0],
  ['grid lines', '--border', '--surface', 0],
];

/** Known and paid for: three light-mode slots below 3:1, which is what obliges direct labels on
    marks and the "View as table" toggle. Named individually so a *fourth* one is a failure. */
const EXPECTED_WARN = new Set(['light/series 3 · aqua', 'light/series 4 · yellow', 'light/series 5 · magenta']);

let unexpected = 0;
const rows = [];
for (const [theme, set] of [
  ['light', light],
  ['dark', dark],
]) {
  for (const [what, fg, bg, need] of PAIRS) {
    const r = ratio(set[fg], set[bg]);
    const ok = r >= need;
    const known = EXPECTED_WARN.has(`${theme}/${what}`);
    if (ok === known && need > 0) unexpected++;
    rows.push({
      theme,
      what,
      fg: set[fg],
      bg: set[bg],
      r: r.toFixed(2),
      need: need === 0 ? '—' : need.toFixed(1),
      verdict: need === 0 ? 'not required' : known ? 'WARN, relieved' : ok ? 'PASS' : 'FAIL',
    });
  }
}

console.log(`# Contrast audit\n`);
console.log(`Generated by \`node scripts/contrast-audit.mjs\` from \`src/styles/tokens.css\`.`);
console.log(`WCAG 2.1 ratios; 4.5 for text below 18.66px, 3.0 for a graphic that carries`);
console.log(`meaning. ${rows.length} pairs, ${EXPECTED_WARN.size} expected warnings.\n`);
for (const theme of ['light', 'dark']) {
  console.log(`## ${theme} — surface \`${(theme === 'light' ? light : dark)['--surface']}\`\n`);
  console.log('| what | foreground | background | ratio | needs | |');
  console.log('|---|---|---|---|---|---|');
  for (const row of rows.filter((r) => r.theme === theme)) {
    console.log(`| ${row.what} | \`${row.fg}\` | \`${row.bg}\` | ${row.r} | ${row.need} | ${row.verdict} |`);
  }
  console.log('');
}

if (unexpected > 0) {
  console.error(`\n${unexpected} pair(s) disagree with what is documented — see EXPECTED_WARN.`);
  process.exit(1);
}
console.log(
  `Every pair is as documented: the three light-mode slots warn, and nothing else does.\n` +
    `The two reliefs that answers for them are asserted in the test suite, not here —\n` +
    `\`tests/workspace/analysisChart.test.tsx\`.`,
);
