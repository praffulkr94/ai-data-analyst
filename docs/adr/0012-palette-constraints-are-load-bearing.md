# The chart palette imposes two non-negotiable UI requirements

The validated six-colour categorical palette produces a sub-3:1 contrast warning in light mode for
aqua, yellow and magenta. That warning is not dismissable: it obliges direct labels on marks and a
visible "View as table" toggle. Additionally, series are capped at six (then folded to "Other") and
at three for scatter, because beyond three yellow and orange become indistinguishable under
colour-vision deficiency.

**Consequences:** if direct labels or the table view are cut, the palette becomes
non-compliant. These are accessibility requirements wearing the costume of visual polish.
