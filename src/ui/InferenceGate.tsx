/** The stage between parsing and the workspace.

    Inference is where a live demo breaks: one column typed categorical because 254 of its values
    say `NA` makes "average goal minute" impossible, and a visitor who never saw the guess has no
    way to know why. So the guesses are put in front of a person exactly once, and the shape of
    the screen is the shape of the news — one row when everything was confident, one row per
    doubtful column when it was not (DECISIONS §21.1).

    A type changed here goes through `loader.retype`, the same path the `#/data` headers use: the
    worker re-encodes that column and rebuilds the RowIndex. There is no second inference path. */
import { useState } from 'react';
import type { Loader } from '../data/loader';
import { isCategoryStats, isNumberStats, type ColumnMeta, type ColumnType } from '../engine/types';
import { useApp } from '../store';

const TYPES: ColumnType[] = ['number', 'date', 'categorical', 'boolean'];

/** Below this, the winning type did not fit enough of the sampled values to be taken on trust. */
const CONFIDENT = 0.99;

export function InferenceGate({ loader }: { loader: Loader }) {
  const columns = useApp((s) => s.columns);
  const confirm = useApp((s) => s.confirmInference);
  const [showConfident, setShowConfident] = useState(false);

  const uncertain = columns.filter((c) => !c.overridden && c.confidence < CONFIDENT);
  const confident = columns.filter((c) => !uncertain.includes(c));

  if (uncertain.length === 0) {
    return (
      <div className="stage">
        <div className="notice notice-good" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>All {columns.length} columns typed.</span>
          <span className="muted" style={{ flex: 1 }}>
            {census(columns)}
          </span>
          <button type="button" className="primary" onClick={confirm}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stage">
      <section className="card">
        <div className="card-head" style={{ borderLeft: '2px solid var(--status-warning)' }}>
          <strong>
            {uncertain.length} of {columns.length} columns need a decision
          </strong>
          <p className="narration">
            Everything else was typed confidently. Correct these {uncertain.length} and continue.
          </p>
        </div>

        {uncertain.map((c) => (
          <div className="gate-row" key={c.name}>
            <div className="col">
              <div className="name">{c.name}</div>
              <div className="why">{why(c)}</div>
            </div>
            <div className="segmented" role="group" aria-label={`Type of ${c.name}`}>
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={c.type === t}
                  onClick={() => void loader.retype(c.name, t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <span className="sample">{samples(c)}</span>
          </div>
        ))}

        <div className="gate-foot">
          <button type="button" onClick={() => setShowConfident((v) => !v)}>
            {showConfident ? 'Hide' : 'Show'} the {confident.length} confident columns
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <button type="button" className="primary" onClick={confirm}>
            Continue
          </button>
        </div>

        {showConfident &&
          confident.map((c) => (
            <div className="gate-confident" key={c.name}>
              <span className="name">{c.name}</span>
              <span className="type">{c.type}</span>
              <span className="sample">{samples(c)}</span>
            </div>
          ))}
      </section>
    </div>
  );
}

/** "1 date · 2 numbers · 5 categorical · 1 boolean" — the tally, in the design's own words. */
function census(columns: ColumnMeta[]): string {
  const plural: Record<ColumnType, [string, string]> = {
    date: ['date', 'dates'],
    number: ['number', 'numbers'],
    categorical: ['categorical', 'categorical'],
    boolean: ['boolean', 'booleans'],
  };
  return TYPES.map((t) => [t, columns.filter((c) => c.type === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${plural[t][n === 1 ? 0 : 1]}`)
    .join(' · ');
}

/** Why this column is being asked about, in the terms the inference actually used. */
const why = (c: ColumnMeta): string =>
  `${Math.round(c.confidence * 100)}% of values matched ${c.type}` +
  (c.nullCount > 0 ? ` · ${c.nullCount.toLocaleString()} empty` : '');

/** What the column holds, in the same terms the prompt will carry. */
function samples(c: ColumnMeta): string {
  if (isNumberStats(c.stats)) {
    const fmt = c.type === 'date' ? iso : num;
    return `${fmt(c.stats.min)} → ${fmt(c.stats.max)}`;
  }
  if (isCategoryStats(c.stats)) return c.stats.top.slice(0, 4).map((t) => t.value).join(', ');
  return 'no values';
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const num = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
