# The link carries the chart on screen, and nothing else survives a reload

There is no persistence. The URL hash carries exactly three things — the mode, a DatasetRef, and
one AnalysisSpec — base64url-encoded and written with `replaceState`. Everything else is lost on
reload: the other Analyses, every Revision but one, the usage totals, and the key.

The Revision the hash carries is **the one on screen, not the newest**. This departs from the
wording in `DECISIONS.md` §21.3 and issue #1, which both say "the active Analysis's latest
Revision", and the departure is deliberate rather than a slip. The two only disagree after an
undo, and there the user story is unambiguous: *a link that reproduces the chart I am looking at*.
Handing a reader back a Revision the sender had stepped away from would be a different chart under
the same link. Where an implementation note and a user story disagree about the same behaviour,
the story is the requirement and the note is shorthand.

**Considered options.** IndexedDB was cut in `DECISIONS.md` §19 and stays cut: it would make the
application stateful across sessions, and every schema change would then need a migration for data
nobody asked to keep. Encoding every Analysis was rejected because the URL then grows without
bound with the length of a session — the use case is sharing a finding, not restoring a desk.
`pushState` was rejected because it hijacks the Back button, and undo already has a key: Back
belongs to the browser and Cmd+Z steps a Revision (ADR-0021).

**A DatasetRef is not a Dataset.** For a built-in sample it is an id, so the file is re-fetched,
re-inferred and the spec re-executed with no questions asked. For an upload it is a filename and a
row count, because the rows went with the tab and no hash can bring them back; the application
names the file and asks for it, and a differently-named file warns and loads anyway — a renamed
copy is far more likely than a different Dataset, and the semantic validator is what actually
decides whether the analysis still holds. Both paths converge: one subscription waits for a
DatasetHandle to arrive and re-executes against the DatasetSchema *just inferred*, never the one
the link was written against. A spec that no longer validates renders its SpecViolations — the
same unknown-column state a bad model reply produces — rather than throwing.

A hash is untrusted input; anyone can type one. The spec inside it therefore goes through the same
Zod grammar a ModelReply does before anything is executed, and a hash from an older version
decodes to nothing and starts clean, which beats restoring half of it.

**Consequences.** The failure being guarded against is not losing the work — that is the accepted
price of having no backend — but losing it *silently*, so a visitor reloads and concludes the
application is broken. Two things follow and are load-bearing rather than polish: the rail says
once, quietly, that Analyses are not saved and that the link keeps one, the first time there are
two to lose; and a reload whose hash says `byok` opens the key dialog instead of dropping to Demo
mode behind the visitor's back, announcing the fallback in words if the dialog is dismissed. A
mode the visitor did not choose has to be said out loud.
