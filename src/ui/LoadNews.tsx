/** What the load has to say, as one strip at the top of the workspace.

    There is one convention for all of it and not two. A file that read cleanly, a file with rows
    the parser could not use, and a file that hit the row cap are the same kind of news — what
    happened on the way in — so they are the same strip, and the only thing that changes between
    them is the left stripe and the words. Nothing is gated on reading it: the workspace behind
    it is already usable, which is the whole difference from the screen this replaced.

    It says nothing about types when the inference gate has just been through them. The gate is
    the loud telling of the same news, and telling it twice is noise. */
import { CircleAlert, CircleCheck, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { navigate } from '../route';
import { useApp } from '../store';
import type { ColumnMeta, ColumnType } from '../engine/types';

const TYPES: ColumnType[] = ['number', 'date', 'categorical', 'boolean'];

export function LoadNews() {
  const report = useApp((s) => s.parseReport);
  const columns = useApp((s) => s.columns);
  const reviewed = useApp((s) => s.typesReviewed);
  const failure = useApp((s) => s.loadFailure);
  /** The dismissal is of a *message*, not of the strip. A file refused after the census was
      dismissed is different news, and swallowing it because the strip had been closed once is
      how an error goes unread. */
  const [read, setRead] = useState<string | null>(null);

  const skipped = report?.skipped ?? 0;
  const truncated = report?.truncated ?? false;
  const parsed = report ? report.totalRows - skipped : 0;

  // Most serious first. A refused file leads: it is the only one about something the visitor
  // just did, and the Dataset the rest of the strip describes is not the one they asked for.
  // Then the cap, which is the one thing here that changes what an answer means.
  const news = failure
    ? {
        kind: 'notice-critical',
        mark: CircleAlert,
        title: 'That file was not loaded.',
        aside: `${failure} The Dataset below is the one that was already open`,
        link: 'Check the types',
      }
    : truncated
    ? {
        kind: 'notice-warning',
        mark: TriangleAlert,
        title: 'Capped at 500,000 rows.',
        aside:
          skipped > 0
            ? `The rest of the file was not read · ${skipped.toLocaleString()} malformed rows skipped`
            : 'The rest of the file was not read.',
        link: 'See what was read',
      }
    : skipped > 0
      ? {
          kind: 'notice-serious',
          mark: TriangleAlert,
          title: `Parsed ${parsed.toLocaleString()} of ${report!.totalRows.toLocaleString()} rows.`,
          aside: `${skipped.toLocaleString()} malformed rows skipped — a malformed row never fails the file`,
          link: 'See which',
        }
      : !reviewed && columns.length > 0
        ? {
            kind: 'notice-good',
            mark: CircleCheck,
            title: `All ${columns.length} columns typed.`,
            aside: census(columns),
            link: 'Check the types',
          }
        : null;

  if (news === null || news.title === read) return null;

  // Beside the words and the stripe, never instead of either — see `Notice`.
  const Mark = news.mark;

  return (
    <p className={`notice ${news.kind}`} role="status">
      <span className="notice-head">
        <Mark className="notice-mark" />
        <span className="title">{news.title}</span>
        <span className="aside">
          {news.aside}{' '}
          <button type="button" className="link" onClick={() => navigate('data')}>
            {news.link}
          </button>
        </span>
        <button
          type="button"
          className="close"
          aria-label="Dismiss"
          onClick={() => setRead(news.title)}
        >
          <X />
        </button>
      </span>
    </p>
  );
}

/** "2 numbers · 1 date · 5 categorical · 1 boolean" — the tally, in the design's own words. */
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
