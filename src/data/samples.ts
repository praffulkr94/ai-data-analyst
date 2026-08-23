/** The built-in samples. Row counts are the real, measured counts — say 99,040, never
    "100k+" (DECISIONS §A6). `scripts/build-datasets.mjs` produces every file here. */
import type { DatasetRef } from '../engine/handle';

export type Sample = {
  id: string;
  label: string;
  filename: string;
  rowCount: number;
  note: string;
};

export const SAMPLES: Sample[] = [
  {
    id: 'matches',
    label: 'International football matches',
    filename: 'matches.csv.gz',
    rowCount: 49_520,
    note: 'Every international result from 1872 to 2026.',
  },
  {
    id: 'team_matches',
    label: 'Team-match results',
    filename: 'team_matches.csv.gz',
    rowCount: 99_040,
    note: 'One row per team per match, derived from the same source by a committed script.',
  },
  {
    id: 'goals',
    label: 'Goals scored',
    filename: 'goals.csv.gz',
    rowCount: 47_914,
    note:
      'The inference showcase: 254 goal minutes are written as the string NA rather than left ' +
      'blank, and 79 rows are exact duplicates.',
  },
  {
    id: 'messy',
    label: 'Deliberately messy export',
    filename: 'messy.csv.gz',
    rowCount: 2_021,
    note:
      'Dirtied on purpose — a BOM, CRLF endings, dates mixed between two formats, ' +
      'attendances written with thousands separators, every null token, and 34 malformed rows.',
  },
];

export const sampleById = (id: string): Sample | undefined => SAMPLES.find((s) => s.id === id);

export const sampleUrl = (s: Sample): string => `${import.meta.env.BASE_URL}data/${s.filename}`;

export const sampleRef = (s: Sample): DatasetRef => ({ kind: 'sample', id: s.id });
