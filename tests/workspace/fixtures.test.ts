/** The shipped demo repertoire, checked against the grammar and the real Dataset's shape.

    A Fixture is data, and data rots quietly: a renamed column or a mistyped aggregation id makes
    Demo mode — the default first-run path — fail in front of a visitor with no key and no way to
    work around it. The DatasetSchema below is written out by hand from the header of
    `data/raw/results.csv`, so it is an independent source rather than a re-derivation. */
import { describe, expect, it } from 'vitest';
import { DEMO_REPERTOIRE } from '../../src/ai/fixtures';
import type { ColumnMeta, DatasetSchema } from '../../src/engine/types';
import { ModelReply, specFromReply } from '../../src/spec/grammar';
import { validateSpec } from '../../src/spec/validate';

const col = (name: string, type: ColumnMeta['type'], distinct = 100): ColumnMeta => ({
  name,
  type,
  confidence: 1,
  nullCount: 0,
  stats:
    type === 'number' || type === 'date'
      ? { min: 0, max: 10, mean: 1 }
      : { distinct, top: [] },
});

/** `matches.csv` — `data/raw/results.csv` shipped as-is. */
const MATCHES: DatasetSchema = {
  columns: [
    col('date', 'date'),
    col('home_team', 'categorical', 328),
    col('away_team', 'categorical', 328),
    col('home_score', 'number'),
    col('away_score', 'number'),
    col('tournament', 'categorical', 145),
    col('city', 'categorical', 2_092),
    col('country', 'categorical', 275),
    col('neutral', 'boolean', 2),
  ],
};

const questions = new Set(DEMO_REPERTOIRE.map((f) => f.question.trim().toLowerCase()));

describe('the demo repertoire', () => {
  it('is roughly a dozen Questions and includes a refusal of each kind', () => {
    const kinds = DEMO_REPERTOIRE.map((f) => f.input.kind);
    expect(DEMO_REPERTOIRE.length).toBeGreaterThanOrEqual(12);
    expect(kinds).toContain('clarification');
    expect(kinds).toContain('unsupported');
  });

  it.each(DEMO_REPERTOIRE.map((f) => [f.question, f] as const))(
    '“%s” is structurally valid and executable against the Dataset it names',
    (_question, fixture) => {
      const parsed = ModelReply.safeParse(fixture.input);
      expect(parsed.success, parsed.error?.message).toBe(true);
      expect(fixture.dataset).toBe('matches');
      if (fixture.input.kind !== 'analysis') return;
      expect(validateSpec(specFromReply(fixture.input), MATCHES)).toEqual([]);
    },
  );

  it('repeats the streamed sentence as the narration the specification carries', () => {
    for (const f of DEMO_REPERTOIRE) {
      if (f.input.kind === 'analysis') expect(f.input.narration).toBe(f.narration);
    }
  });

  /** A refusal is a fork in the flow, not a dead end — so every chip it offers has to be a
      Question Demo mode can actually answer. */
  it('only offers chips that are themselves in the repertoire', () => {
    for (const f of DEMO_REPERTOIRE) {
      const chips =
        f.input.kind === 'clarification'
          ? f.input.options
          : f.input.kind === 'unsupported'
            ? f.input.suggestions
            : [];
      for (const chip of chips) expect(questions).toContain(chip.trim().toLowerCase());
    }
  });
});
