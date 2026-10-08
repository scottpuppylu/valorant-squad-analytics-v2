import type { ReactNode } from 'react';
import { Empty, Explain, HistoryNotice, Reasons, StatusBadge } from '../components/ui.tsx';
import type { ReadySnapshot } from '../data/loadSnapshot.ts';
import { formatAdr, formatInt, formatPercent, formatRatio, formatScore, formatSigned } from '../format.ts';
import { RECENT_FORM_LABEL, ROLE_LABEL } from '../i18n.ts';
import { href } from '../router.ts';
import { compareViewModel, selectCompare, type PlayerProfileViewModel } from '../viewModels.ts';

function MemberPicker({ id, label, value, members, onPick }: { id: string; label: string; value: string | null; members: ReadySnapshot['group']['members']; onPick: (v: string | null) => void }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value ?? ''} onChange={(e) => onPick(e.target.value || null)}>
        <option value="">— 選擇成員 —</option>
        {members.map((m) => <option key={m.publicMemberId} value={m.publicMemberId}>{m.displayName}</option>)}
      </select>
    </label>
  );
}

function Line({ label, a, b }: { label: string; a: ReactNode; b: ReactNode }) {
  return <tr><td data-label="A" className="num-cell">{a}</td><th scope="row" data-label="項目">{label}</th><td data-label="B" className="num-cell">{b}</td></tr>;
}

const metric = (vm: PlayerProfileViewModel, key: 'currentStrength' | 'communityScore') => {
  const m = vm.profile[key];
  return m.value !== null && m.status !== 'insufficient' && m.status !== 'unavailable' ? <>{formatScore(m.value)} <StatusBadge status={m.status} /></> : <span className="muted">證據不足</span>;
};

export function Compare({ state, a, b }: { state: ReadySnapshot; a: string | null; b: string | null }) {
  const members = state.group.members;
  const go = (next: { a: string | null; b: string | null }) => { window.location.hash = href.compare(next.a, next.b).slice(1); };
  const vm = compareViewModel(state, a, b);
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">比較</p>
        <h1>比較兩位成員</h1>
        <HistoryNotice from={state.group.coverage.firstMatchAt} to={state.group.coverage.lastMatchAt} />
      </header>
      <form className="pickers" onSubmit={(e) => e.preventDefault()} aria-label="選擇要比較的兩位成員">
        <MemberPicker id="compare-a" label="成員 A" value={a} members={members} onPick={(v) => go(selectCompare({ a, b }, 'a', v))} />
        <MemberPicker id="compare-b" label="成員 B" value={b} members={members} onPick={(v) => go(selectCompare({ a, b }, 'b', v))} />
      </form>
      {!vm ? <Empty title="請選擇兩位不同的成員">選好 A 與 B 後會顯示兩種比較：各自的全部競技紀錄，以及兩人同場對戰。</Empty> : (
        <>
          <section className="panel" aria-labelledby="all-history">
            <header className="panel-head"><h2 id="all-history">各自的全部競技紀錄</h2><span className="muted small">各自與群組基準比較（不一定同場）</span></header>
            <table className="table compare-table">
              <thead><tr><th scope="col">{vm.a.profile.displayName}</th><th scope="col">項目</th><th scope="col">{vm.b.profile.displayName}</th></tr></thead>
              <tbody>
                <Line label="目前實力" a={metric(vm.a, 'currentStrength')} b={metric(vm.b, 'currentStrength')} />
                <Line label="社群分數（全部）" a={metric(vm.a, 'communityScore')} b={metric(vm.b, 'communityScore')} />
                <Line label="近期狀態" a={RECENT_FORM_LABEL[vm.a.profile.recentForm.status]} b={RECENT_FORM_LABEL[vm.b.profile.recentForm.status]} />
                <Line label="競技場次" a={vm.a.profile.competitiveMatches} b={vm.b.profile.competitiveMatches} />
                <Line label="K/D" a={formatRatio(vm.a.basic?.kd ?? null)} b={formatRatio(vm.b.basic?.kd ?? null)} />
                <Line label="ADR" a={formatAdr(vm.a.basic?.adr ?? null)} b={formatAdr(vm.b.basic?.adr ?? null)} />
                <Line label="ACS" a={formatScore(vm.a.profile.basic.acs)} b={formatScore(vm.b.profile.basic.acs)} />
                <Line label="KAST" a={formatPercent(vm.a.profile.advanced.kast.rate)} b={formatPercent(vm.b.profile.advanced.kast.rate)} />
                <Line label="首殺 / 首死" a={`${formatInt(vm.a.profile.advanced.opening.firstKills)} / ${formatInt(vm.a.profile.advanced.opening.firstDeaths)}`} b={`${formatInt(vm.b.profile.advanced.opening.firstKills)} / ${formatInt(vm.b.profile.advanced.opening.firstDeaths)}`} />
                <Line label="補槍擊殺" a={formatInt(vm.a.profile.advanced.trade.tradeKills)} b={formatInt(vm.b.profile.advanced.trade.tradeKills)} />
                <Line label="殘局 勝 / 次" a={`${formatInt(vm.a.profile.advanced.clutch.wins)} / ${formatInt(vm.a.profile.advanced.clutch.attempts)}`} b={`${formatInt(vm.b.profile.advanced.clutch.wins)} / ${formatInt(vm.b.profile.advanced.clutch.attempts)}`} />
                <Line label="回合影響" a={formatScore(vm.a.profile.advanced.roundImpact.value)} b={formatScore(vm.b.profile.advanced.roundImpact.value)} />
                <Line label="牌位（對戰當時）" a={vm.a.profile.rank.tierLabel ?? '未知'} b={vm.b.profile.rank.tierLabel ?? '未知'} />
                <Line label="主要角色" a={vm.a.profile.primaryRole ? ROLE_LABEL[vm.a.profile.primaryRole] : '未知'} b={vm.b.profile.primaryRole ? ROLE_LABEL[vm.b.profile.primaryRole] : '未知'} />
                <Line label="最常用特務" a={vm.a.profile.agents.slice(0, 2).map((x) => x.agentName).join('、') || '—'} b={vm.b.profile.agents.slice(0, 2).map((x) => x.agentName).join('、') || '—'} />
              </tbody>
            </table>
          </section>

          <section className="panel shared-panel" aria-labelledby="direct-shared">
            <header className="panel-head"><h2 id="direct-shared">兩人同場對戰（Shared-Match）</h2><span className="muted small">只看兩人都在場的對戰</span></header>
            {!vm.pair || vm.pair.sharedMatches === 0 ? <Empty title="兩人沒有共同對戰">無法做同場比較。</Empty> : (
              <>
                <dl className="stats">
                  <div className="stat"><dt>共同對戰</dt><dd>{vm.pair.sharedMatches} 場</dd><span className="stat-hint">競技 {vm.pair.competitiveMatches} · 一般 {vm.pair.unratedMatches} · 同隊 {vm.pair.sameTeamMatches}</span></div>
                  <div className="stat"><dt>{vm.a.profile.displayName} 較佳</dt><dd>{vm.pair.aAhead} 場</dd></div>
                  <div className="stat"><dt>{vm.b.profile.displayName} 較佳</dt><dd>{vm.pair.bAhead} 場</dd></div>
                  <div className="stat"><dt>差距在雜訊內</dt><dd>{vm.pair.neutral} 場</dd></div>
                  <div className="stat"><dt>平均單場火力差（A − B）</dt><dd>{formatSigned(vm.pair.difference)}</dd><span className="stat-hint">可比較 {vm.pair.scoredMatches} 場</span></div>
                  <div className="stat"><dt>證據信心</dt><dd>{formatInt(vm.pair.confidence)}/100</dd></div>
                </dl>
                {!vm.pair.eligible ? <Reasons reasons={vm.pair.reasons} /> : null}
                <p className="muted small">兩人各自的同場評分：{vm.a.profile.displayName} {formatScore(vm.pair.ratingA)} · {vm.b.profile.displayName} {formatScore(vm.pair.ratingB)}（與所有同場搭檔相比，50＝旗鼓相當）。</p>
              </>
            )}
            <p className="callout">兩種比較回答不同問題：上方是「各自的整體紀錄」，這裡是「同一場裡誰表現較好」。兩者都不是真實技術排名，也沒有哪一個比較「真」。</p>
            <Explain k="shared-match" />
          </section>
        </>
      )}
    </div>
  );
}
