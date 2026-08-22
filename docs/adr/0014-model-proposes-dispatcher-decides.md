# The model proposes routing; the dispatcher decides it

A ModelReply carries `intent: 'new' | 'refine'`, but that is a proposal consumed at dispatch and then
discarded — it is never persisted on a Revision. The dispatcher overrides it where reality demands
(`refine` with no Analysis selected becomes `new`), and the outcome is already encoded structurally:
Revision index 0 came from `new`, any later index from `refine`.

**Consequences:** do not re-add an `intent` field to "record what the model said". A persisted copy
can disagree with the dispatcher's actual action, and a field that can disagree with the structure
will eventually be trusted over it.
