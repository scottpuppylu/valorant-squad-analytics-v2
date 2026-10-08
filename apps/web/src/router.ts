import { useEffect, useState } from 'react';

/** Minimal hash router: works on any static host without server rewrites. */
export const ROUTES = [
  { path: '/', label: '總覽' },
  { path: '/players', label: '玩家' },
  { path: '/compare', label: '比較' },
  { path: '/synergy', label: '默契' },
  { path: '/team-builder', label: '組隊建議' },
  { path: '/about', label: '資料說明' },
] as const;
export type RoutePath = (typeof ROUTES)[number]['path'];

export function parseRoute(hash: string): RoutePath {
  const path = hash.replace(/^#/u, '') || '/';
  return (ROUTES.find((r) => r.path === path)?.path ?? '/') as RoutePath;
}

export function useRoute(): RoutePath {
  const [route, setRoute] = useState<RoutePath>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
