/** Builds the shipped Datasets from the raw source under `data/raw/`, gzipped into `public/data/`.
    Re-runnable and committed, so every derived row count is auditable rather than asserted.
    Source: martj42/international_results, CC0-1.0. See `data/raw/SOURCE.md`. */
import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';

const RAW = new URL('../data/raw/', import.meta.url);
const OUT = new URL('../public/data/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const gzipFile = (from, to) =>
  pipeline(createReadStream(from), createGzip({ level: 9 }), createWriteStream(to));

const gzipText = (text, to) =>
  pipeline(Readable.from([text]), createGzip({ level: 9 }), createWriteStream(to));

const countRows = async (path) => {
  const text = await readFile(path, 'utf8');
  return text.trimEnd().split('\n').length - 1;
};

/** `matches.csv` — the hero Dataset, `results.csv` shipped as-is. */
async function matches() {
  const src = new URL('results.csv', RAW);
  await gzipFile(src, new URL('matches.csv.gz', OUT));
  return countRows(src);
}

/** `team_matches.csv` — the performance Dataset: one row per team per match, so every match in
    `results.csv` yields two rows. 49,520 x 2 = 99,040. Say 99,040, never "100k+". */
async function teamMatches() {
  const text = await readFile(new URL('results.csv', RAW), 'utf8');
  const [, ...body] = text.trimEnd().split('\n');
  const out = [
    'date,team,opponent,at_home,goals_for,goals_against,result,tournament,city,country,neutral',
  ];
  for (const line of body) {
    const cells = splitCsv(line);
    if (cells.length !== 9) continue;
    const [date, home, away, hs, as_, tournament, city, country, neutral] = cells;
    const tail = `${quote(tournament)},${quote(city)},${quote(country)},${neutral}`;
    out.push(`${date},${quote(home)},${quote(away)},TRUE,${hs},${as_},${result(hs, as_)},${tail}`);
    out.push(`${date},${quote(away)},${quote(home)},FALSE,${as_},${hs},${result(as_, hs)},${tail}`);
  }
  await gzipText(out.join('\n') + '\n', new URL('team_matches.csv.gz', OUT));
  return out.length - 1;
}

const result = (a, b) => (Number(a) > Number(b) ? 'win' : Number(a) < Number(b) ? 'loss' : 'draw');
const quote = (v) => (v.includes(',') || v.includes('"') ? `"${v.replaceAll('"', '""')}"` : v);

/** Enough CSV to read the source file, which has quoted fields but no embedded newlines. */
function splitCsv(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (line[i + 1] === '"') (cell += '"'), i++;
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') (cells.push(cell), (cell = ''));
    else cell += ch;
  }
  cells.push(cell);
  return cells;
}

const built = { 'matches.csv': await matches(), 'team_matches.csv': await teamMatches() };

for (const [name, rows] of Object.entries(built)) {
  console.log(`${name}\t${rows.toLocaleString('en-US')} rows`);
}
