import { StatusView } from '../components/StatusView.tsx';
import type { SnapshotState } from '../data/loadSnapshot.ts';
import { formatAdr, formatInstant, formatRatio } from '../format.ts';

export function Dashboard({ state }: { state: SnapshotState }) {
  if (state.status !== 'ready') return <StatusView state={state} />;
  const { group, analytics, manifest } = state;
  const byMember = new Map(analytics.players.map((p) => [p.publicMemberId, p]));
  return (
    <section>
      <header className="page-header">
        <h1>{group.group.name}</h1>
        <dl className="meta">
          <div><dt>快照</dt><dd><code>{manifest.active.snapshotId}</code> · {manifest.active.snapshotVersion}</dd></div>
          <div><dt>資料截至</dt><dd>{formatInstant(group.dataAsOf)}</dd></div>
          <div><dt>發布時間</dt><dd>{formatInstant(manifest.active.activatedAt)}</dd></div>
        </dl>
      </header>
      <ul className="cards">
        {group.members.map((member) => {
          const a = byMember.get(member.publicMemberId);
          return (
            <li key={member.publicMemberId} className="card" data-member={member.publicMemberId}>
              <h2>{member.displayName}</h2>
              {a && a.eligible ? (
                <dl className="stats">
                  <div><dt>場次</dt><dd>{a.matchesPlayed}</dd></div>
                  <div><dt>勝 / 敗</dt><dd>{a.wins} / {a.losses}</dd></div>
                  <div><dt>K/D</dt><dd>{formatRatio(a.kd)}</dd></div>
                  {a.adr !== null ? <div><dt>ADR</dt><dd>{formatAdr(a.adr)}</dd></div> : null}
                </dl>
              ) : (
                <p className="muted">{a ? a.eligibilityReasons.join('；') || '樣本不足' : '尚無分析結果'}</p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="evidence-note">
        資料範圍：{analytics.scope.mode === 'competitive' ? '競技模式' : analytics.scope.mode}；
        歷史完整度：{group.provenance.historyCompleteness === 'provider-visible' ? '資料來源可見的歷史（非完整生涯）' : '未知'}。
        {group.provenance.summary}
      </p>
    </section>
  );
}
