# Six d3 submodules, React owns every DOM node

Charts are built from `d3-scale`, `d3-shape`, `d3-array`, `d3-time-format`, `d3-format`,
`d3-scale-chromatic` (plus `d3-quadtree` for scatter hit-testing) — roughly 30kB rather than 250kB
for the meta-package. `d3-axis`, `d3-selection` and `d3-transition` are excluded: axis ticks come
from `scale.ticks()` and render as React elements, because d3-axis wants to own a DOM node via
selection.

**Considered options:** Recharts or visx would have been faster to build. They were rejected because
"how did you divide responsibilities between React and D3" is a question this project exists to
answer, and a charting library answers it with "I didn't". Deliberate — see ADR-0013.
