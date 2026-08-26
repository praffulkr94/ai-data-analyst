/** The stage between parsing and the workspace.

    Inference is where a live demo breaks: one column typed categorical because 254 of its values
    say `NA` makes "average goal minute" impossible, and a visitor who never saw the guess has no
    way to know why. So the doubtful guesses are put in front of a person exactly once
    (DECISIONS §21.1).

    Only the doubtful ones. This screen used to open for every Dataset, and with every column
    confident it was a one-line receipt with a Continue button on an otherwise empty stage — a
    screen asking permission to do what had just been asked for. That case never reaches here
    now: the store leaves `load` ready and the census goes to the workspace as `LoadNews`. What
    is left is the branch that earns a screen, because it has a decision in it (ADR-0027).

    A type changed here goes through `loader.retype`, the same path the `#/data` headers use: the
    worker re-encodes that column and rebuilds the RowIndex. There is no second inference path. */
import { useState } from 'react';
import type { Loader } from '../data/loader';
import {
  isCategoryStats,
  isNumberStats,
  isUncertain,
  type ColumnMeta,
  type ColumnType,
} from '../engine/types';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';
import { DatasetMenu } from './DatasetMenu';

const TYPES: ColumnType[] = ['number', 'date', 'categorical', 'boolean'];

export function InferenceGate({ loader, workspace }: { loader: Loader; workspace: Workspace }) {
  const columns = useApp((s) => s.columns);
  const confirm = useApp((s) => s.confirmInference);
  const [showConfident, setShowConfident] = useState(false);

  const uncertain = columns.filter(isUncertain);
  const confident = columns.filter((c) => !uncertain.includes(c));

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
          {/* The way out, for a Dataset picked by mistake. Nothing has been asked of it yet, so
              this is the cheapest moment to leave — and before this it cost a tab reload. */}
          <DatasetMenu workspace={workspace} className="plain-trigger" align="end">
            Choose a different dataset
          </DatasetMenu>
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
