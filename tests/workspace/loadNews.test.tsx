/** The load's news, as one strip.

    Three kinds of news arrive at the same moment — the types were all confident, some rows were
    malformed, the file hit the row cap — and before this they had two conventions between them:
    a full-screen gate for the first and a dismissible notice for the other two. One strip now
    carries all three, so what is under test is which one wins when more than one is true, and
    that the strip says nothing at all when there is nothing to say. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ColumnMeta } from '../../src/engine/types';
import type { ParseReport } from '../../src/engine/handle';
import { LoadNews } from '../../src/ui/LoadNews';
import { useApp } from '../../src/store';
import { reset } from './harness';

const columns: ColumnMeta[] = [
  { name: 'date', type: 'date', confidence: 1, nullCount: 0, stats: null },
  {
    name: 'city',
    type: 'categorical',
    confidence: 1,
    nullCount: 0,
    stats: null,
  },
  { name: 'goals', type: 'number', confidence: 1, nullCount: 0, stats: null },
];

const report = (over: Partial<ParseReport> = {}): ParseReport => ({
  totalRows: 48_000,
  skipped: 0,
  badRows: [],
  truncated: false,
  ...over,
});

function show(
  state: { report?: ParseReport | null; reviewed?: boolean; failure?: string } = {},
) {
  useApp.setState({
    columns,
    parseReport: state.report ?? null,
    typesReviewed: state.reviewed ?? false,
    loadFailure: state.failure ?? null,
  });
  render(<LoadNews />);
}

describe('the load news strip', () => {
  beforeEach(reset);
  afterEach(cleanup);

  it('reports the census when the gate did not need to open', () => {
    show();
    expect(screen.getByText('All 3 columns typed.')).toBeTruthy();
    expect(screen.getByText(/1 number · 1 date · 1 categorical/)).toBeTruthy();
  });

  /** The gate is the loud telling of the same news. Saying it again in a strip underneath is
      noise, and it is the second convention this strip exists to remove. */
  it('says nothing about types when the gate has just been through them', () => {
    show({ reviewed: true });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('names the rows the parser could not use', () => {
    show({ report: report({ skipped: 86 }) });
    expect(screen.getByText('Parsed 47,914 of 48,000 rows.')).toBeTruthy();
  });

  /** A capped file is the one piece of news here that changes what an answer means — an average
      over the first 500,000 rows is not an average over the file — so it outranks the rest. */
  it('leads with the cap when the file was both capped and dirty', () => {
    show({ report: report({ skipped: 86, truncated: true }) });
    expect(screen.getByText('Capped at 500,000 rows.')).toBeTruthy();
    expect(screen.getByText(/86 malformed rows skipped/)).toBeTruthy();
  });

  /** A file refused at the door — not a CSV, or over the cap — changes nothing: the Dataset the
      rest of the strip describes is still loaded and still answerable. It leads anyway, because
      it is the only news here about something the visitor just did. */
  it('leads with a refused file, over news about the Dataset that is still open', () => {
    show({ report: report({ skipped: 86, truncated: true }), failure: 'notes.pdf is not a CSV.' });
    expect(screen.getByText('That file was not loaded.')).toBeTruthy();
    expect(screen.getByText(/notes\.pdf is not a CSV/)).toBeTruthy();
  });

  it('is silent when a clean file arrives after the gate', () => {
    show({ report: report(), reviewed: true });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
