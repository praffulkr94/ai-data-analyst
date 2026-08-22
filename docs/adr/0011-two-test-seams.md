# Testing happens at exactly two seams

Tests are written against `DataEngine` (a pure module: parse, infer, index, aggregate — fast, in
Node) and `Workspace` (the facade the UI calls, with a scripted fake specification generator,
covering validation, repair, cancellation, staleness and revisions). Two supplementary checks are
not seams: one browser-mode integration test of the worker transport, and two Playwright flows.

**Considered options:** a single seam at `Workspace` would have been fewer, but testing type
inference and aggregation through the full pipeline makes the red-green loop slow and points
failures at the wrong layer — and that logic is where the bug density is. Nine seams were rejected
as proliferation. Charts are tested through their accessible data table, never through SVG geometry.
