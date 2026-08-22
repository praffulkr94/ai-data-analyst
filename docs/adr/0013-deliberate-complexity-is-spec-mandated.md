# Some complexity here is deliberate and must not be simplified away

This is a portfolio artifact whose purpose is demonstrating specific engineering competencies, so
several choices are more complex than a product would justify: the hand-rolled worker RPC
(ADR-0005), d3 submodules with hand-rendered axes (ADR-0008), the columnar store (ADR-0003), and the
absence of TanStack Query (ADR-0010). Each exists to make a competency visible and legible.

**Consequences:** simplification passes — automated or human — should treat these as requirements
with a documented rationale, not as accidental complexity. Accidental complexity elsewhere remains
fair game, and separating the two is itself part of the exercise.
