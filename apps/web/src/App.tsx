import { useEffect, useState } from 'react';
import { StatusView } from './components/StatusView.tsx';
import { browserFetcher, loadSnapshot, type SnapshotState } from './data/loadSnapshot.ts';
import { About } from './pages/About.tsx';
import { Compare } from './pages/Compare.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { PlayerProfile } from './pages/PlayerProfile.tsx';
import { Players } from './pages/Players.tsx';
import { Synergy } from './pages/Synergy.tsx';
import { TeamBuilder } from './pages/TeamBuilder.tsx';
import { parseRoute, ROUTES, routePath, useRoute, type Route } from './router.ts';

/** Route → page. Every data page renders an explicit state view until a valid snapshot is ready. */
export function Page({ route, state }: { route: Route | string; state: SnapshotState }) {
  const r = typeof route === 'string' ? parseRoute(route) : route;
  if (r.page === 'about') return <About state={state} />;
  if (state.status !== 'ready') return <StatusView state={state} />;
  switch (r.page) {
    case 'players': return <Players state={state} />;
    case 'player': return <PlayerProfile state={state} memberId={r.memberId} />;
    case 'compare': return <Compare state={state} a={r.a} b={r.b} />;
    case 'synergy': return <Synergy state={state} />;
    case 'team-builder': return <TeamBuilder state={state} />;
    default: return <Dashboard state={state} />;
  }
}

export function Shell({ route, state }: { route: Route; state: SnapshotState }) {
  const active = routePath(route);
  return (
    <div className="shell">
      <a className="skip" href="#main">跳到主要內容</a>
      <header className="topbar">
        <a className="brand" href="#/"><span className="brand-mark" aria-hidden="true">◆</span>哥布林大調查</a>
        <nav className="nav" aria-label="主要導覽">
          {ROUTES.map((r) => <a key={r.path} href={`#${r.path}`} aria-current={active === r.path ? 'page' : undefined}>{r.label}</a>)}
        </nav>
      </header>
      <main id="main" className="main" tabIndex={-1}><Page route={route} state={state} /></main>
      <footer className="footer">
        <span>社群表現分析：非官方牌位、非 MMR、非勝率預測。</span>
        {state.status === 'ready' ? <span>快照 <code>{state.manifest.active.snapshotId}</code> · {state.manifest.active.snapshotVersion}</span> : null}
      </footer>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [state, setState] = useState<SnapshotState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    loadSnapshot(browserFetcher).then((next) => { if (active) setState(next); });
    return () => { active = false; };
  }, []);
  return <Shell route={route} state={state} />;
}
