import { Empty, Explain, HistoryNotice, Reasons, ScoreBar, StatusBadge } from '../components/ui.tsx';
import type { ReadySnapshot } from '../data/loadSnapshot.ts';
import { formatDate, formatInt, formatScore } from '../format.ts';
import { RECENT_FORM_LABEL, ROLE_LABEL } from '../i18n.ts';
import { href } from '../router.ts';
import { dashboardViewModel, type DashboardRow } from '../viewModels.ts';

function Row({ row }: { row: DashboardRow }) {
  const p = row.profile;
  const cs = p.currentStrength; const community = p.communityScore;
  return (
    <tr data-member={p.publicMemberId}>
      <td data-label="排名" className="rank-cell">{row.rank ?? '—'}</td>
      <th scope="row" data-label="玩家"><a href={href.player(p.publicMemberId)}>{p.displayName}</a><span className="sub">{p.primaryRole ? ROLE_LABEL[p.primaryRole] : '角色未知'}</span></th>
      <td data-label="目前實力">
        {cs.value !== null && cs.status !== 'insufficient' ? <><span className="num strong">{formatScore(cs.value)}</span><ScoreBar value={cs.value} label="目前實力" /></> : <span className="muted">證據不足</span>}
        <StatusBadge status={cs.status} />
      </td>
      <td data-label="社群分數（全部）">{community.value !== null ? <span className="num">{formatScore(community.value)}</span> : <span className="muted">—</span>} <StatusBadge status={community.status} /></td>
      <td data-label="近期狀態">{RECENT_FORM_LABEL[p.recentForm.status]}</td>
      <td data-label="樣本">{p.currentWindow.matches} 場 / {p.currentWindow.rounds} 回合<span className="sub">全部競技 {p.competitiveMatches} 場</span></td>
      <td data-label="信心">{cs.confidence !== null && cs.status !== 'insufficient' ? `${formatInt(cs.confidence)}/100` : '—'}</td>
    </tr>
  );
}

export function Dashboard({ state }: { state: ReadySnapshot }) {
  const vm = dashboardViewModel(state);
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">群組總覽</p>
        <h1>{vm.groupName}</h1>
        <dl className="meta">
          <div><dt>資料期間</dt><dd>{formatDate(vm.coverage.firstMatchAt)} – {formatDate(vm.coverage.lastMatchAt)}</dd></div>
          <div><dt>公開成員</dt><dd>{vm.memberCount} 人</dd></div>
          <div><dt>對戰</dt><dd>{vm.coverage.matchesObserved} 場（競技 {vm.coverage.competitiveMatches}）</dd></div>
        </dl>
        <HistoryNotice from={vm.coverage.firstMatchAt} to={vm.coverage.lastMatchAt} />
      </header>

      <div className="quick">
        <a className="quick-card" href={href.compare()}><strong>比較兩位成員</strong><span>全部紀錄與同場對戰分開比較</span></a>
        <a className="quick-card" href="#/team-builder"><strong>組隊建議</strong><span>選 5 人＋地圖，看歷史契合度與分工（{vm.teamBuilderMaps.length} 張地圖）</span></a>
        <a className="quick-card" href="#/synergy"><strong>同場比較</strong><span>{vm.sharedPairsWithEvidence} 組搭檔有足夠的共同對戰</span></a>
      </div>

      <section className="panel" aria-labelledby="ranking-title">
        <header className="panel-head"><h2 id="ranking-title">目前實力排名</h2><span className="muted small">只用競技模式；依近期區間自動選樣</span></header>
        {vm.ranked.length === 0 ? <Empty title="目前沒有成員達到近期區間的最低樣本">累積更多競技對戰後才會排名。</Empty> : (
          <table className="table responsive">
            <thead><tr><th scope="col">#</th><th scope="col">玩家</th><th scope="col">目前實力</th><th scope="col">社群分數（全部）</th><th scope="col">近期狀態</th><th scope="col">近期樣本</th><th scope="col">信心</th></tr></thead>
            <tbody>{vm.ranked.map((row) => <Row key={row.profile.publicMemberId} row={row} />)}</tbody>
          </table>
        )}
        {vm.insufficient.length > 0 ? (
          <div className="insufficient" data-state="insufficient">
            <h3>樣本不足（不排名）</h3>
            <ul>
              {vm.insufficient.map((r) => (
                <li key={r.profile.publicMemberId}>
                  <a href={href.player(r.profile.publicMemberId)}>{r.profile.displayName}</a>：近期 {r.profile.currentWindow.matches} 場 / {r.profile.currentWindow.rounds} 回合
                  <Reasons reasons={r.profile.currentStrength.eligibility.reasons} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Explain k="current-strength" />
        <Explain k="community-score" />
      </section>
    </div>
  );
}
