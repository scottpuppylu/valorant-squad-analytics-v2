import { useEffect, useState } from 'react';
import { browserFetcher, loadSnapshot, type SnapshotState } from './data/loadSnapshot.ts';
import { Dashboard } from './pages/Dashboard.tsx';
import { About, Compare, Synergy, TeamBuilder } from './pages/Placeholders.tsx';
import { Players } from './pages/Players.tsx';
import { ROUTES, useRoute, type RoutePath } from './router.ts';

export function Page({ route, state }: { route: RoutePath; state: SnapshotState }) {
  switch (route) {
    case '/players': return <Players state={state} />;
    case '/compare': return <Compare />;
    case '/synergy': return <Synergy />;
    case '/team-builder': return <TeamBuilder />;
    case '/about': return <About />;
    default: return <Dashboard state={state} />;
  }
}

export function App() {
  const route = useRoute();
  const [state, setState] = useState<SnapshotState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    loadSnapshot(browserFetcher).then((next) => { if (active) setState(next); });
    return () => { active = false; };
  }, []);
  return (
    <div className="shell">
      <nav className="nav" aria-label="主要導覽">
        <span className="brand">Squad Analytics</span>
        {ROUTES.map((r) => <a key={r.path} href={`#${r.path}`} aria-current={route === r.path ? 'page' : undefined}>{r.label}</a>)}
      </nav>
      <main className="main"><Page route={route} state={state} /></main>
    </div>
  );
}
