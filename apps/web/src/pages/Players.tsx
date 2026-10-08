import { StatusView } from '../components/StatusView.tsx';
import type { SnapshotState } from '../data/loadSnapshot.ts';
import { formatDate } from '../format.ts';

export function Players({ state }: { state: SnapshotState }) {
  if (state.status !== 'ready') return <StatusView state={state} />;
  return (
    <section>
      <h1>玩家</h1>
      <p className="muted">個人頁面（Player Profile）將在後續版本提供。</p>
      <table className="table">
        <thead><tr><th>玩家</th><th>觀察到的場次（所有模式）</th><th>最早</th><th>最近</th></tr></thead>
        <tbody>
          {state.players.players.map((p) => (
            <tr key={p.publicMemberId}><td>{p.displayName}</td><td>{p.matchesObserved}</td><td>{formatDate(p.firstObservedAt)}</td><td>{formatDate(p.lastObservedAt)}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
