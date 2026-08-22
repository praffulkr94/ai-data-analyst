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

const built = { 'matches.csv': await matches() };

for (const [name, rows] of Object.entries(built)) {
  console.log(`${name}\t${rows.toLocaleString('en-US')} rows`);
}
export { gzipText };
