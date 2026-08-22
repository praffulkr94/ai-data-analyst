/** React's window onto the SliceCache. The cache lives outside React, so this is a
    `useSyncExternalStore` over a revision counter rather than state the store holds. */
import { useEffect, useSyncExternalStore } from 'react';
import type { SliceCache } from './sliceCache';

export function useRowSlice(cache: SliceCache, from: number, to: number) {
  const revision = useSyncExternalStore(cache.subscribe, cache.getRevision, cache.getRevision);

  useEffect(() => {
    cache.setRange(from, to);
  }, [cache, from, to, revision]);

  return {
    revision,
    rowCount: cache.rowCount,
    columns: cache.columns(),
    row: cache.row,
  };
}
