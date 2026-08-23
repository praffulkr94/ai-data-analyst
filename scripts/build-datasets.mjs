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

/** `goals.csv` — `goalscorers.csv` shipped as-is, because its dirt is real rather than staged.
    It is the inference showcase: `minute` is 47,660 integers and 254 literal `NA`, which naive
    inference types categorical and "average goal minute" then becomes impossible with no
    recovery, and the file carries 79 duplicate rows. */
async function goals() {
  const src = new URL('goalscorers.csv', RAW);
  await gzipFile(src, new URL('goals.csv.gz', OUT));
  return countRows(src);
}

/** `messy.csv` — the same source, hand-dirtied on purpose and re-derivable, so every awkward
    thing the reader and the inference rules claim to survive is somewhere in one file:

    a BOM and CRLF line endings; dates mixed between ISO and unambiguous day-first; a numeric
    column carrying every recognised null token; an `attendance` column written with thousands
    separators; cities quoted because they contain a comma; non-ASCII team names, which the
    source already supplies; malformed rows with a cell missing, to be counted and shown; and
    duplicate rows.

    The dirt rates are chosen against the rules rather than sprinkled: `home_score` is dirtied
    every 40th row and `attendance` every 25th, both comfortably inside the 95% threshold that
    keeps a column numeric, because a column pushed past it stops demonstrating the rule and
    starts demonstrating its absence. */
const MESSY_ROWS = 2_000;
const NULL_TOKENS = ['NA', 'N/A', '-', '--', 'null', ''];

async function messy() {
  const text = await readFile(new URL('results.csv', RAW), 'utf8');
  const [, ...body] = text.trimEnd().split('\n');
  const out = [
    'date,home_team,away_team,home_score,away_score,tournament,city,country,neutral,attendance',
  ];
  let written = 0;
  for (let i = 0; written < MESSY_ROWS && i < body.length; i++) {
    const cells = splitCsv(body[i]);
    if (cells.length !== 9) continue;
    const [date, home, away, hs, as_, tournament, city, country, neutral] = cells;
    const fields = [
      // Every third date is day-first. Plenty of them have a day past the twelfth, so the order
      // is detectable rather than a coin flip the reader would have to guess at.
      i % 3 === 0 ? dayFirst(date) : date,
      quote(home),
      quote(away),
      i % 40 === 0 ? NULL_TOKENS[(i / 40) % NULL_TOKENS.length] : hs,
      as_,
      quote(tournament),
      // A comma inside a quoted field, which is the tokenising case that breaks naive readers.
      i % 5 === 0 ? quote(`${city}, ${country}`) : quote(city),
      quote(country),
      neutral,
      i % 25 === 0 ? NULL_TOKENS[(i / 25) % NULL_TOKENS.length] : grouped(i),
    ];
    // A row missing its last cell. Counted, reported, and not allowed to cost the file.
    out.push(i % 61 === 0 ? fields.slice(0, -1).join(',') : fields.join(','));
    written++;
    if (i % 97 === 0) out.push(out.at(-1));
  }
  // A BOM and CRLF: what a spreadsheet export from Windows actually looks like.
  await gzipText('\ufeff' + out.join('\r\n') + '\r\n', new URL('messy.csv.gz', OUT));
  return out.length - 1;
}

const dayFirst = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

/** Thousands-grouped and therefore quoted, e.g. `"52,341"` — the separator is a comma, so the
    field has to survive tokenising before it can demonstrate anything about parsing numbers.
    Deterministic in the row index, so the file is re-derivable rather than random. */
const grouped = (i) => `"${(((i * 7919) % 88_000) + 2_000).toLocaleString('en-US')}"`;

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

const built = {
  'matches.csv': await matches(),
  'team_matches.csv': await teamMatches(),
  'goals.csv': await goals(),
  'messy.csv': await messy(),
};

for (const [name, rows] of Object.entries(built)) {
  console.log(`${name}\t${rows.toLocaleString('en-US')} rows`);
}
