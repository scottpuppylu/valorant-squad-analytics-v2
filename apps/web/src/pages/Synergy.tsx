import { Empty, Explain, HistoryNotice, Reasons, ScoreBar, StatusBadge } from '../components/ui.tsx';
import type { ReadySnapshot } from '../data/loadSnapshot.ts';
import { formatInt, formatScore, formatSigned } from '../format.ts';
import { href } from '../router.ts';
import { synergyViewModel } from '../viewModels.ts';

/** Pair-based group view built ONLY from accepted Shared-Match v1 evidence (no new "synergy" formula). */
export function Synergy({ state }: { state: ReadySnapshot }) {
  const vm = synergyViewModel(state);
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">同場比較</p>
        <h1>同場比較（Shared-Match）</h1>
        <p className="lede">只看兩位成員「同一場」對戰裡的單場表現。這是同場相對比較，不是默契指數、不是 MMR，也不是勝率。</p>
        <HistoryNotice from={state.group.coverage.firstMatchAt} to={state.group.coverage.lastMatchAt} />
        <dl className="meta">
          <div><dt>有共同對戰的組合</dt><dd>{vm.coverage.pairsWithShared} / {vm.coverage.possiblePairs}</dd></div>
          <div><dt>可比較的兩兩場次</dt><dd>{vm.coverage.scoredUnits} / {vm.coverage.pairUnits}</dd></div>
          <div><dt>演算法</dt><dd>{vm.algorithm.version}</dd></div>
        </dl>
      </header>

      <section className="panel" aria-labelledby="sm-members">
        <header className="panel-head"><h2 id="sm-members">成員同場評分</h2><span className="muted small">50＝在共同對戰中旗鼓相當；少於 {vm.algorithm.minMatches} 場不顯示</span></header>
        <table className="table responsive">
          <thead><tr><th scope="col">成員</th><th scope="col">同場評分</th><th scope="col">共同對戰</th><th scope="col">有證據的搭檔</th><th scope="col">證據信心</th></tr></thead>
          <tbody>
            {vm.members.map((m) => (
              <tr key={m.publicMemberId}>
                <th scope="row" data-label="成員"><a href={href.player(m.publicMemberId)}>{m.name}</a></th>
                <td data-label="同場評分">{m.combined.rating !== null ? <><span className="num">{formatScore(m.combined.rating)}</span><ScoreBar value={m.combined.rating} label="同場評分" /></> : <span className="muted">證據不足</span>} <StatusBadge status={m.combined.status} /></td>
                <td data-label="共同對戰">{m.combined.sharedMatches} 場</td>
                <td data-label="搭檔">{m.combined.evidencedPartners} / {m.combined.partners}</td>
                <td data-label="信心">{formatInt(m.combined.confidence)}/100</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel" aria-labelledby="sm-pairs">
        <header className="panel-head"><h2 id="sm-pairs">兩兩組合</h2><span className="muted small">依共同對戰數排序</span></header>
        {vm.pairs.length === 0 ? <Empty title="沒有任何組合" /> : (
          <table className="table responsive">
            <thead><tr><th scope="col">組合</th><th scope="col">共同對戰</th><th scope="col">同隊</th><th scope="col">A 較佳 / B 較佳 / 雜訊內</th><th scope="col">平均差（A − B）</th><th scope="col">狀態</th></tr></thead>
            <tbody>
              {vm.pairs.map((p) => (
                <tr key={`${p.memberA}|${p.memberB}`}>
                  <th scope="row" data-label="組合"><a href={href.compare(p.memberA, p.memberB)}>{p.nameA} × {p.nameB}</a></th>
                  <td data-label="共同對戰">{p.sharedMatches}</td>
                  <td data-label="同隊">{p.sameTeamMatches}</td>
                  <td data-label="比較">{p.scoredMatches > 0 ? `${p.aOutperformed} / ${p.bOutperformed} / ${p.neutral}` : '—'}</td>
                  <td data-label="平均差">{formatSigned(p.relativeDifference)}</td>
                  <td data-label="狀態">{p.eligibility.eligible ? '可比較' : <Reasons reasons={p.eligibility.reasons} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Explain k="shared-match" />
      </section>
    </div>
  );
}
