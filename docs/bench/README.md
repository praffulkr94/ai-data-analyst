# Raw benchmark output

Committed as it came out of the page, not summarised. Regenerate the whole directory with the app
running:

```
npm run dev
node scripts/bench-run.mjs --machine "MacBook Pro, Apple M3 Max, 36 GB, macOS 26.5.1" --runs 9
```

`--headed` runs a real window instead of headless; `--url http://localhost:4173` points it at a
production preview instead of the dev server. Every file names its own machine, browser and
`headless` flag in `environment`, because a number without those is not a measurement.

These were taken on a **MacBook Pro, Apple M3 Max, 36 GB, macOS 26.5.1**, in Playwright's bundled
**HeadlessChrome/151.0.7922.34**, at a 1400x1000 viewport and `devicePixelRatio` 1. Chrome reports
14 cores and 32 GB — its `deviceMemory` reading is capped at 8 in most builds and rounded here;
the machine has 36 GB.

| file | what |
|---|---|
| `matches-49520.json` | 16 bars over 49,520 rows — the ordinary case |
| `team_matches-99040.json` | 98,899 points over 99,040 rows — the case ADR-0023 is about |
| `canvas-pan.json` | the canvas draw loop, one frame of a pan, 98,899 points |

Read `docs/adr/0004-the-worker-is-not-for-aggregation.md` before quoting any of it. The headline is
not that the worker is faster — on the 98,899-point question it is 23 ms *slower* end to end. The
headline is the last column: 0 ms of main-thread blocking against 2,627 ms.
