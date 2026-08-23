# The chart palette imposes two non-negotiable UI requirements

The validated six-colour categorical palette produces a sub-3:1 contrast warning in light mode for
aqua, yellow and magenta. That warning is not dismissable: it obliges direct labels on marks and a
visible "View as table" toggle. Additionally, series are capped at six (then folded to "Other") and
at three for scatter, because beyond three yellow and orange become indistinguishable under
colour-vision deficiency.

**Consequences:** if direct labels or the table view are cut, the palette becomes
non-compliant. These are accessibility requirements wearing the costume of visual polish.

**Verified, M9:** `node scripts/contrast-audit.mjs` measures every pair the application paints
and exits non-zero if anything other than those three light-mode slots fails — captured in
`docs/contrast-audit.md`. The audit found three failures of its own on the way: `--text-faint`
at 2.69:1 carrying the table's "no value" cells, white label text on the *lighter* dark-mode
accent hover at 2.87:1, and the readout's cache figure at 3.35:1. The reliefs themselves are
asserted in `tests/workspace/analysisChart.test.tsx` — a bar's value on the bar, a Series named
at the end of its line and at a scatter Series' rightmost point, and the visible table toggle.
A scatter cannot carry a label per mark, so those two are the whole of its relief.
