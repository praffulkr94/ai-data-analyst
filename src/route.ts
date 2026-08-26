/** The hash carries two independent things: which surface is on screen, and the Analysis being
    shared. Before this module it carried only the second — `session.ts` wrote a base64url blob
    straight into `location.hash` and `main.tsx` tested `location.hash === '#bench'` once, at
    module load. So the bench page was reachable only from a clean URL, no second route could be
    added, and every surface that was not the current Analysis ended up stacked on the one screen
    that existed.

    The split is `#/<route>?s=<payload>`: the route is an address, the payload is state. A hash
    with no leading `/` is a link written before this change and still decodes — its whole body
    is the payload and the route is home. */
export const ROUTES = ['home', 'data', 'bench'] as const;
export type Route = (typeof ROUTES)[number];

const PATHS: Record<Route, string> = { home: '/', data: '/data', bench: '/bench' };

/** The route and the session payload, read out of one hash. */
export function parseHash(hash = location.hash): { route: Route; payload: string } {
  const raw = hash.replace(/^#/, '');
  if (raw === '') return { route: 'home', payload: '' };
  // The one address that was documented before this format existed, and is in the README of
  // every copy of it already cloned.
  if (raw === 'bench') return { route: 'bench', payload: '' };
  // Any other legacy link: the entire hash is the payload, and it names no route.
  if (!raw.startsWith('/')) return { route: 'home', payload: raw };
  const [path, query = ''] = raw.split('?', 2);
  const route = (ROUTES.find((r) => PATHS[r] === path) ?? 'home') as Route;
  return { route, payload: new URLSearchParams(query).get('s') ?? '' };
}

export const formatHash = (route: Route, payload: string): string =>
  `#${PATHS[route]}${payload ? `?s=${payload}` : ''}`;

/** Navigation is `pushState`, so Back leaves a route the way it arrived. The session payload is
    written with `replaceState` (see `trackSession`) precisely because it is not navigation — a
    Revision step is undone with Cmd+Z, never with the browser's Back button. */
export function navigate(route: Route): void {
  const { payload } = parseHash();
  history.pushState(null, '', formatHash(route, payload));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Fires on `hashchange` and on `popstate`: `pushState` does not raise `hashchange` by itself,
    and the Back button raises only `popstate`. */
export function watchRoute(onChange: (route: Route) => void): () => void {
  const read = () => onChange(parseHash().route);
  window.addEventListener('hashchange', read);
  window.addEventListener('popstate', read);
  return () => {
    window.removeEventListener('hashchange', read);
    window.removeEventListener('popstate', read);
  };
}
