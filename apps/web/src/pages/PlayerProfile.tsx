import type { ReactNode } from 'react';
import { Empty, Explain, HistoryNotice, Metric, Reasons, ScoreBar, Section, Stat, StatusBadge } from '../components/ui.tsx';
import type { ReadySnapshot } from '../data/loadSnapshot.ts';
import { formatAdr, formatDate, formatInt, formatPer, formatPercent, formatRatio, formatScore, formatSigned } from '../format.ts';
import { DIMENSION_LABEL, RECENT_FORM_LABEL, ROLE_LABEL } from '../i18n.ts';
import { href } from '../router.ts';
import { profileViewModel } from '../viewModels.ts';

const pct = (wins: number, matches: number) => (matches > 0 ? `${Math.round((100 * wins) / matches)}%` : '—');

function Table({ head, children, empty }: { head: string[]; children: ReactNode[]; empty: string }) {
  if (children.length === 0) return <Empty title={empty} />;
  return <table className="table responsive"><thead><tr>{head.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>;
}

export function PlayerProfile({ state, memberId }: { state: ReadySnapshot; memberId: string }) {
  const vm = profileViewModel(state, memberId);
  if (!vm) {
    return (
      <div className="page">
        <header className="page-header"><p className="eyebrow"><a href="#/players">玩家</a> / 個人頁面</p><h1>找不到這位成員</h1></header>
        <Empty title="此成員不在目前公開的快照中">可能尚未同意公開，或連結已過期。<a href="#/players">回到玩家列表</a></Empty>
      </div>
    );
  }
  const { profile: p, basic, shared } = vm;
  const adv = p.advanced;
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow"><a href="#/players">玩家</a> / 個人頁面</p>
        <h1>{p.displayName}</h1>
        <dl className="meta">
          <div><dt>主要角色</dt><dd>{p.primaryRole ? ROLE_LABEL[p.primaryRole] : '未知（不猜測）'}</dd></div>
          <div><dt>競技對戰</dt><dd>{p.competitiveMatches} 場 / {p.competitiveRounds} 回合</dd></div>
          <div><dt>紀錄期間</dt><dd>{formatDate(vm.player?.firstObservedAt)} – {formatDate(vm.player?.lastObservedAt)}</dd></div>
        </dl>
        <HistoryNotice from={vm.player?.firstObservedAt} to={vm.player?.lastObservedAt} />
        <p className="actions"><a className="button" href={href.compare(p.publicMemberId)}>與其他成員比較</a></p>
      </header>

      <Section title="總覽">
        <div className="metric-grid">
          <Metric metric={p.currentStrength} label="目前實力（近期區間）" />
          <Metric metric={p.communityScore} label="社群分數（全部競技紀錄）" />
          <div className="metric" data-metric="recent-form">
            <div className="metric-label">近期狀態</div>
            <div className="metric-value"><span className="num">{RECENT_FORM_LABEL[p.recentForm.status]}</span>{p.recentForm.delta !== null ? <span className="muted"> {formatSigned(p.recentForm.delta)}</span> : null}</div>
            <div className="metric-meta"><span className="sample">近期 {p.recentForm.recentMatches} 場 · 基準 {p.recentForm.baselineMatches} 場</span></div>
          </div>
        </div>
        <p className="muted small">近期區間：{p.currentWindow.matches} 場 / {p.currentWindow.rounds} 回合 / {p.currentWindow.activeDays} 個活躍日（{formatDate(p.currentWindow.from)} – {formatDate(p.currentWindow.to)}）
          {p.currentWindow.confidence !== null ? `；區間信心 ${formatInt(p.currentWindow.confidence)}/100` : ''}</p>
        <Explain k="current-strength" /><Explain k="community-score" /><Explain k="recent-form" />
      </Section>

      <Section title="基本數據（競技）">
        {basic && basic.eligible ? (
          <dl className="stats">
            <Stat label="場次" value={basic.matchesPlayed} />
            <Stat label="勝 / 敗" value={`${basic.wins} / ${basic.losses}`} />
            <Stat label="K/D" value={formatRatio(basic.kd)} />
            <Stat label="ADR" value={formatAdr(basic.adr)} hint="總傷害 ÷ 隊伍實際回合" />
            <Stat label="ACS" value={formatScore(p.basic.acs)} />
            <Stat label="爆頭率" value={formatPercent(p.basic.headshotPercentage)} />
            <Stat label="每回合擊殺" value={p.basic.kpr === null ? '—' : p.basic.kpr.toFixed(2)} />
            <Stat label="每回合助攻" value={p.basic.apr === null ? '—' : p.basic.apr.toFixed(2)} />
          </dl>
        ) : <Empty title="沒有可用的競技基本數據">{basic ? basic.eligibilityReasons.join('；') : null}</Empty>}
        <Explain k="basic-stats" />
      </Section>

      <Section title="進階數據">
        <dl className="stats">
          <Stat label="KAST" value={adv.kast.rate === null ? '—' : formatPercent(adv.kast.rate)} hint={`${adv.kast.rounds} 回合可重建`} />
          <Stat label="首殺 / 首死" value={adv.opening.firstKills === null ? '—' : `${adv.opening.firstKills} / ${adv.opening.firstDeaths}`} hint={`每回合首殺 ${formatPer(adv.opening.firstKills, adv.opening.rounds)}`} />
          <Stat label="補槍擊殺 / 被補槍" value={adv.trade.tradeKills === null ? '—' : `${adv.trade.tradeKills} / ${adv.trade.tradedDeaths}`} hint={`補槍助攻 ${formatInt(adv.trade.tradeAssists)}`} />
          <Stat label="殘局 勝 / 次" value={adv.clutch.attempts === null ? '—' : `${adv.clutch.wins ?? '—'} / ${adv.clutch.attempts}`} />
        </dl>
        <div className="badges">
          <span>KAST <StatusBadge status={adv.kast.status} /></span><span>開局 <StatusBadge status={adv.opening.status} /></span>
          <span>補槍 <StatusBadge status={adv.trade.status} /></span><span>殘局 <StatusBadge status={adv.clutch.status} /></span>
        </div>
        <div className="metric-grid"><Metric metric={adv.roundImpact} label="回合影響（0–100）" /></div>
        <Explain k="kast" /><Explain k="opening" /><Explain k="trade" /><Explain k="clutch" /><Explain k="round-impact" />
      </Section>

      <Section title="八個面向（社群分數組成）">
        <ul className="dims">
          {p.dimensions.map((d) => (
            <li key={d.dimension} data-dimension={d.dimension}>
              <span className="dim-name">{DIMENSION_LABEL[d.dimension]}</span>
              {d.value !== null && d.status !== 'unavailable' ? <><span className="num">{formatScore(d.value)}</span><ScoreBar value={d.value} label={DIMENSION_LABEL[d.dimension]!} /></> : <span className="muted">證據不足</span>}
              <StatusBadge status={d.status} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="脈絡：牌位、特務、角色、地圖">
        <div className="context-grid">
          <div>
            <h3>牌位（對戰當時）</h3>
            {p.rank.status === 'known' ? <p><strong>{p.rank.tierLabel}</strong><span className="sub">最近一次競技對戰時（{formatDate(p.rank.asOf)}）</span></p>
              : <p className="muted">沒有牌位證據（不推測）</p>}
            <Explain k="rank-context" />
          </div>
          <div>
            <h3>特務</h3>
            <Table head={['特務', '角色', '場次', '勝率']} empty="沒有競技特務紀錄">
              {p.agents.slice(0, 8).map((a) => <tr key={a.agentName}><th scope="row" data-label="特務">{a.agentName}</th><td data-label="角色">{a.role ? ROLE_LABEL[a.role] : '未知角色'}</td><td data-label="場次">{a.matches}</td><td data-label="勝率">{pct(a.wins, a.matches)}</td></tr>)}
            </Table>
          </div>
          <div>
            <h3>角色</h3>
            <Table head={['角色', '場次']} empty="沒有已知角色">{p.roles.map((r) => <tr key={r.role}><th scope="row" data-label="角色">{ROLE_LABEL[r.role]}</th><td data-label="場次">{r.matches}</td></tr>)}</Table>
          </div>
          <div>
            <h3>地圖</h3>
            <Table head={['地圖', '場次', '勝率']} empty="沒有競技地圖紀錄">{p.maps.map((m) => <tr key={m.mapName}><th scope="row" data-label="地圖">{m.mapName}</th><td data-label="場次">{m.matches}</td><td data-label="勝率">{pct(m.wins, m.matches)}</td></tr>)}</Table>
          </div>
        </div>
      </Section>

      <Section title="同場比較（Shared-Match）">
        {shared && shared.combined.rating !== null ? (
          <p><span className="num strong">{formatScore(shared.combined.rating)}</span> / 100（共同對戰 {shared.combined.sharedMatches} 場，{shared.combined.evidencedPartners} 位有足夠證據的搭檔）
            <StatusBadge status={shared.combined.status} /></p>
        ) : <Empty title="共同對戰不足">需要至少 5 場可比較的共同對戰才會顯示。</Empty>}
        <ul className="partner-list">
          {vm.partners.map(({ pair, partnerId, partnerName }) => (
            <li key={partnerId}><a href={href.compare(p.publicMemberId, partnerId)}>{partnerName}</a>：共同 {pair.sharedMatches} 場{pair.eligibility.eligible ? '' : '（不足以比較）'}<Reasons reasons={pair.eligibility.reasons} /></li>
          ))}
        </ul>
        <Explain k="shared-match" />
      </Section>

      <Section title="證據與限制">
        <ul className="plain">
          <li>本頁所有分數只使用<strong>競技模式</strong>；所有模式的對戰只用於瀏覽與場次統計。</li>
          <li>紀錄範圍為目前可追蹤紀錄（{formatDate(vm.player?.firstObservedAt)} – {formatDate(vm.player?.lastObservedAt)}），並非全部歷史。</li>
          <li>信心度描述證據多寡，不是機率或勝率。<Explain k="sample-confidence" /></li>
        </ul>
      </Section>
    </div>
  );
}
