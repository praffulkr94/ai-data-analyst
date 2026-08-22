# TanStack Query is not used

There is no server state here: no cache to share, nothing to refetch, no invalidation, no reused
keys. Its caching model also works against single-flight latest-wins, which is the required
behaviour for question submission. Recorded because it is the most likely library for a reader to
suggest adding.
