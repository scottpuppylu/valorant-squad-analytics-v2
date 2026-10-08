import { useEffect, useState } from 'react';

/** Hash router: works on any static host (and any sub-path) without server rewrites. */
export const ROUTES = [
  { path: '/', label: '總覽' },
  { path: '/players', label: '玩家' },
  { path: '/compare', label: '比較' },
  { path: '/synergy', label: '同場比較' },
  { path: '/team-builder', label: '組隊建議' },
  { path: '/about', label: '資料與方法' },
] as const;
export type RoutePath = (typeof ROUTES)[number]['path'];

export type Route =
  | { page: 'dashboard' }
  | { page: 'players' }
  | { page: 'player'; memberId: string }
  | { page: 'compare'; a: string | null; b: string | null }
  | { page: 'synergy' }
  | { page: 'team-builder' }
  | { page: 'about' };

const MEMBER = /^m_[0-9a-f]{16}$/u;

/** Parse a location hash. Unknown paths fall back to the Dashboard; ids are validated (never echoed unchecked). */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/u, '') || '/';
  const [path = '/', query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  const id = (value: string | null) => (value && MEMBER.test(value) ? value : null);
  if (path === '/players') return { page: 'players' };
  const player = /^\/players\/(m_[0-9a-f]{16})$/u.exec(path);
  if (player) return { page: 'player', memberId: player[1]! };
  if (path === '/compare') return { page: 'compare', a: id(params.get('a')), b: id(params.get('b')) };
  if (path === '/synergy') return { page: 'synergy' };
  if (path === '/team-builder') return { page: 'team-builder' };
  if (path === '/about') return { page: 'about' };
  return { page: 'dashboard' };
}

export function routePath(route: Route): RoutePath {
  switch (route.page) {
    case 'players': case 'player': return '/players';
    case 'compare': return '/compare';
    case 'synergy': return '/synergy';
    case 'team-builder': return '/team-builder';
    case 'about': return '/about';
    default: return '/';
  }
}

export const href = {
  player: (memberId: string) => `#/players/${memberId}`,
  compare: (a?: string | null, b?: string | null) => `#/compare${a || b ? `?${new URLSearchParams({ ...(a ? { a } : {}), ...(b ? { b } : {}) }).toString()}` : ''}`,
};

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => { setRoute(parseRoute(window.location.hash)); window.scrollTo?.(0, 0); };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
