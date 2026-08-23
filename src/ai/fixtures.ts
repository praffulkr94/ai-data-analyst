/** The demo repertoire: the fixed set of Questions Demo mode can answer, and the recorded model
    reply for each.

    A Fixture is the content of one captured exchange — the sentence the model streamed as text,
    the tool call it made, and the token counts the API reported for it. The replay layer in
    `fixtureTranslator.ts` turns that back into a stream. Only the transport is faked: the JSON
    below goes through the same Zod parse, the same semantic validator, the same worker and the
    same renderer as a live reply, which is the whole argument for Fixtures over a proxy.

    Every option a Clarification offers and every suggestion an Unsupported reply makes is itself
    a Question in this file, so a refusal in Demo mode is a fork in the flow rather than a dead
    end.

    **These replies are hand-authored against the real grammar, not captured from the API** — this
    repository has no key. See the note in `HANDOFF.md`; the ledger item stays unticked until
    someone re-records them. */
import type { ModelReply } from '../spec/grammar';
import type { TokenCounts } from './models';

export type Fixture = {
  /** Which built-in sample this reply names columns of. A repertoire Question is only offered
      when its Dataset is the one loaded — the columns it names have to exist. */
  dataset: string;
  question: string;
  /** The sentence streamed as text deltas before the tool call. */
  narration: string;
  /** The tool call's input, exactly as the `input_json_delta` chunks spelled it out. */
  input: ModelReply;
  /** What the API reported for this exchange. Replayed as-is and labelled "recorded". */
  usage: TokenCounts;
};

/** Roughly what one exchange cost once the tools + system + DatasetSchema prefix was cached. */
const usage = (outputTokens: number): TokenCounts => ({
  inputTokens: 168,
  cacheReadTokens: 1_412,
  cacheWriteTokens: 0,
  outputTokens,
});

const count = (id = 'm', label = 'matches') =>
  ({ id, fn: 'count', column: null, label }) as const;

export const DEMO_REPERTOIRE: Fixture[] = [
  {
    dataset: 'matches',
    question: 'Which teams have hosted the most matches?',
    narration: 'Counting matches for each home team, most first.',
    input: {
      kind: 'analysis',
      intent: 'new',
      title: 'Matches hosted by team',
      narration: 'Counting matches for each home team, most first.',
      operation: {
        filters: [],
        groupBy: ['home_team'],
        timeBucket: null,
        aggregations: [count()],
        derived: [],
        sort: { by: 'm', dir: 'desc' },
        limit: null,
      },
      visualization: { type: 'bar', x: 'home_team', y: 'm', seriesBy: null },
    },
    usage: usage(243),
  },
  {
    dataset: 'matches',
    question: 'Which cities have hosted the most matches?',
    narration: 'Counting matches for each host city, most first.',
    input: {
      kind: 'analysis',
      intent: 'new',
      title: 'Matches hosted by city',
      narration: 'Counting matches for each host city, most first.',
      operation: {
        filters: [],
        groupBy: ['city'],
        timeBucket: null,
        aggregations: [count()],
        derived: [],
        sort: { by: 'm', dir: 'desc' },
        limit: null,
      },
      visualization: { type: 'bar', x: 'city', y: 'm', seriesBy: null },
    },
    usage: usage(238),
  },
  {
    dataset: 'matches',
    question: 'How many matches were played each year?',
    narration: 'Bucketing matches by year and counting them.',
    input: {
      kind: 'analysis',
      intent: 'new',
      title: 'Matches per year',
      narration: 'Bucketing matches by year and counting them.',
      operation: {
        filters: [],
        groupBy: [],
        timeBucket: { column: 'date', unit: 'year' },
        aggregations: [count()],
        derived: [],
        sort: { by: 'date', dir: 'asc' },
        limit: null,
      },
      visualization: { type: 'line', x: 'date', y: 'm', seriesBy: null },
    },
    usage: usage(251),
  },
  {
    dataset: 'matches',
    question: 'How has the average home score changed over time?',
    narration: 'Averaging the home score for each year.',
    input: {
      kind: 'analysis',
      intent: 'new',
      title: 'Average home score by year',
      narration: 'Averaging the home score for each year.',
      operation: {
        filters: [],
        groupBy: [],
        timeBucket: { column: 'date', unit: 'year' },
        aggregations: [{ id: 'hs', fn: 'avg', column: 'home_score', label: 'average home score' }],
        derived: [],
        sort: { by: 'date', dir: 'asc' },
        limit: null,
      },
      visualization: { type: 'line', x: 'date', y: 'hs', seriesBy: null },
    },
    usage: usage(262),
  },
  {
    dataset: 'matches',
    question: 'What share of matches were played on neutral ground each year?',
    narration: 'Taking the share of matches on neutral ground, year by year.',
    input: {
      kind: 'analysis',
      intent: 'new',
      title: 'Neutral-ground share by year',
      narration: 'Taking the share of matches on neutral ground, year by year.',
      operation: {
        filters: [],
        groupBy: [],
        timeBucket: { column: 'date', unit: 'year' },
        aggregations: [{ id: 'n', fn: 'rate', column: 'neutral', label: 'neutral share' }],
        derived: [],
        sort: { by: 'date', dir: 'asc' },
        limit: null,
      },
      visualization: { type: 'area', x: 'date', y: 'n', seriesBy: null },
    },
    usage: usage(268),
  },
  {
    dataset: 'matches',
    question: 'Which tournaments have the most matches?',
    narration: 'Counting matches in each tournament, most first.',
    input: {
      kind: 'analysis',
      intent: 'new',
      title: 'Matches by tournament',
      narration: 'Counting matches in each tournament, most first.',
      operation: {
        filters: [],
        groupBy: ['tournament'],
        timeBucket: null,
        aggregations: [count()],
        derived: [],
        sort: { by: 'm', dir: 'desc' },
        limit: null,
      },
      visualization: { type: 'bar', x: 'tournament', y: 'm', seriesBy: null },
    },
    usage: usage(240),
  },
  {
    dataset: 'matches',
    question: 'How many home goals per match does each tournament average?',
    narration: 'Dividing home goals by matches played, for each tournament.',
    input: {
      kind: 'analysis',
      intent: 'new',
      title: 'Home goals per match by tournament',
      narration: 'Dividing home goals by matches played, for each tournament.',
      operation: {
        filters: [],
        groupBy: ['tournament'],
        timeBucket: null,
        aggregations: [
          { id: 'g', fn: 'sum', column: 'home_score', label: 'home goals' },
          count(),
        ],
        derived: [{ id: 'gpm', label: 'home goals per match', numerator: 'g', denominator: 'm' }],
        sort: { by: 'gpm', dir: 'desc' },
        limit: 20,
      },
      visualization: { type: 'bar', x: 'tournament', y: 'gpm', seriesBy: null },
    },
    usage: usage(324),
  },
  {
    dataset: 'matches',
    question: 'How many matches has England hosted each year?',
    narration: 'Filtering to matches England hosted, then counting them by year.',
    input: {
      kind: 'analysis',
      intent: 'new',
      title: 'Matches hosted by England, by year',
      narration: 'Filtering to matches England hosted, then counting them by year.',
      operation: {
        filters: [{ op: 'eq', column: 'home_team', value: 'England' }],
        groupBy: [],
        timeBucket: { column: 'date', unit: 'year' },
        aggregations: [count()],
        derived: [],
        sort: { by: 'date', dir: 'asc' },
        limit: null,
      },
      visualization: { type: 'line', x: 'date', y: 'm', seriesBy: null },
    },
    usage: usage(279),
  },
  {
    dataset: 'matches',
    question: 'Which countries host the most matches?',
    narration: 'Counting matches in each host country, most first.',
    input: {
      kind: 'analysis',
      intent: 'new',
      title: 'Matches by host country',
      narration: 'Counting matches in each host country, most first.',
      operation: {
        filters: [],
        groupBy: ['country'],
        timeBucket: null,
        aggregations: [count()],
        derived: [],
        sort: { by: 'm', dir: 'desc' },
        limit: null,
      },
      visualization: { type: 'bar', x: 'country', y: 'm', seriesBy: null },
    },
    usage: usage(236),
  },
  {
    dataset: 'matches',
    question: 'How many matches were played each month of 2018?',
    narration: 'Narrowing to 2018 and counting matches month by month.',
    input: {
      kind: 'analysis',
      intent: 'new',
      title: 'Matches per month in 2018',
      narration: 'Narrowing to 2018 and counting matches month by month.',
      operation: {
        filters: [{ op: 'dateRange', column: 'date', from: '2018-01-01', to: '2018-12-31' }],
        groupBy: [],
        timeBucket: { column: 'date', unit: 'month' },
        aggregations: [count()],
        derived: [],
        sort: { by: 'date', dir: 'asc' },
        limit: null,
      },
      visualization: { type: 'bar', x: 'date', y: 'm', seriesBy: null },
    },
    usage: usage(288),
  },
  {
    dataset: 'matches',
    question: 'Show that by year instead',
    narration: 'Rebucketing the same count by year.',
    input: {
      kind: 'analysis',
      intent: 'refine',
      title: 'Matches per year',
      narration: 'Rebucketing the same count by year.',
      operation: {
        filters: [],
        groupBy: [],
        timeBucket: { column: 'date', unit: 'year' },
        aggregations: [count()],
        derived: [],
        sort: { by: 'date', dir: 'asc' },
        limit: null,
      },
      visualization: { type: 'line', x: 'date', y: 'm', seriesBy: null },
    },
    usage: usage(233),
  },
  {
    dataset: 'matches',
    question: 'Who is the best team?',
    narration: 'That could mean a few different things, so I am asking rather than guessing.',
    input: {
      kind: 'clarification',
      question:
        '"Best" could be measured several ways in this Dataset, and they give different answers. Which did you mean?',
      options: [
        'Which teams have hosted the most matches?',
        'How has the average home score changed over time?',
        'Which tournaments have the most matches?',
      ],
    },
    usage: usage(176),
  },
  {
    dataset: 'matches',
    question: 'Why did scoring decline after 1990?',
    narration: 'That asks for a cause, which this grammar cannot express.',
    input: {
      kind: 'unsupported',
      reason:
        'This can describe what the data shows, not why. The grammar has no causal analysis and ' +
        'no period-over-period comparison, because the model never sees your rows — it only ' +
        'writes the specification the application then executes.',
      suggestions: [
        'How has the average home score changed over time?',
        'How many matches were played each year?',
      ],
    },
    usage: usage(198),
  },
];

/** The Questions offered as chips for the Dataset actually loaded. A repertoire Question names
    columns, so offering one against a Dataset that lacks them would be a designed failure. */
export const repertoireFor = (dataset: string | null): Fixture[] =>
  DEMO_REPERTOIRE.filter((f) => f.dataset === dataset);
