# AI Data Analyst

A browser workspace for exploring a tabular dataset by asking questions in natural language. The
model translates a question into a validated analysis specification; the application executes it
and renders the result. The model never performs the analysis and never reports findings.

Built as a portfolio project for Senior Frontend Engineer roles — so some complexity here is
deliberate. See `docs/adr/0013-deliberate-complexity-is-spec-mandated.md` before simplifying
anything.

## Key documents

| Document | What it holds |
|---|---|
| `DECISIONS.md` | Architecture and the full decision record. Canonical. |
| `CONTEXT.md` | The project's vocabulary. Authoritative over wording everywhere else. |
| `docs/adr/` | Individual decisions that are hard to reverse. Read before changing the area. |
| `data/raw/SOURCE.md` | Source datasets and their licence. |

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI, with a single spec issue per feature rather than per-ticket
issues. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
