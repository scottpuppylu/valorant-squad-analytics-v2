import { useState } from 'react';
import type { PublicTeamBuilderSnapshot } from '@vsa/contracts/public';
import { Empty, Explain, HistoryNotice, Reasons, ScoreBar } from '../components/ui.tsx';
import type { ReadySnapshot } from '../data/loadSnapshot.ts';
import { formatInt, formatScore, formatSigned } from '../format.ts';
import { RESPONSIBILITY_LABEL, ROLE_LABEL } from '../i18n.ts';
import { canCalculate, findTeamResult, TEAM_SIZE, toggleMember, type TeamResult, type TeamSelection } from '../viewModels.ts';

type Lineup = TeamResult['lineups'][number];
type Member = Lineup['members'][number];
const LEVEL: Record<string, string> = { agent: '特務層級', agent_map: '特務×地圖', role: '角色層級', role_map: '角色×地圖', map: '地圖', member: '成員整體', group: '群組平均' };

function SideDuty({ label, value, confidence, reasons, applied }: { label: string; value: string | null; confidence: number | null; reasons: Member['attackReasons']; applied: boolean }) {
  if (!applied) return <div className="duty"><span className="duty-side">{label}</span><span className="muted">只對建議陣容提供</span></div>;
  return (
    <div className="duty" data-duty={value ?? 'abstain'}>
      <span className="duty-side">{label}</span>
      {value ? <strong>{(RESPONSIBILITY_LABEL[value] ?? value).replace(/^(進攻|防守)：/u, '')}</strong> : <span className="abstain">{reasons.includes('insufficient_side_evidence') ? '證據不足' : '無明顯分工'}</span>}
      {confidence !== null && confidence > 0 ? <span className="sub">證據信心 {formatInt(confidence)}/100</span> : null}
      {!value ? <Reasons reasons={reasons} /> : null}
    </div>
  );
}

function MemberCard({ m, name, applied }: { m: Member; name: string; applied: boolean }) {
  return (
    <li className="tb-member" data-member={m.publicMemberId}>
      <div className="tb-head">
        <span className="player-name">{name}</span>
        <span className="agent">{m.agentName}</span>
        <span className="role">{ROLE_LABEL[m.role]}</span>
        {m.experimental ? <span className="badge badge-insufficient">實驗性（沒玩過）</span> : null}
      </div>
      <div className="duty">
        <span className="duty-side">整體分工</span>
        {m.generalResponsibility ? <strong>{RESPONSIBILITY_LABEL[m.generalResponsibility]}</strong>
          : <span className="abstain">{m.withheldResponsibility ? '此類分工未通過驗證，不顯示' : '證據不足或無明顯分工'}</span>}
      </div>
      <SideDuty label="進攻" value={m.attackResponsibility} confidence={m.attackConfidence} reasons={m.attackReasons} applied={applied} />
      <SideDuty label="防守" value={m.defenseResponsibility} confidence={m.defenseConfidence} reasons={m.defenseReasons} applied={applied} />
      <p className="sub">證據：此特務 {m.samples.agent} 場 · 此角色 {m.samples.role} 場 · 此地圖此特務 {m.samples.agentMap} 場（{LEVEL[m.evidenceLevel] ?? m.evidenceLevel}）· 個人信心 {formatInt(m.confidence)}/100</p>
    </li>
  );
}

function LineupView({ lineup, names, best }: { lineup: Lineup; names: Map<string, string>; best: Lineup }) {
  const recommended = lineup.label === 'RECOMMENDED_HISTORICAL_FIT';
  return (
    <section className={`panel lineup${recommended ? ' lineup-recommended' : ''}`} aria-label={recommended ? '建議陣容' : '替代陣容'}>
      <header className="panel-head">
        <h2>{recommended ? '建議陣容（歷史契合度）' : '替代陣容'}</h2>
        <div className="teamfit">
          <span className="metric-label">Team Fit</span>
          <span className="num strong">{formatScore(lineup.teamFit)}</span><ScoreBar value={lineup.teamFit} label="Team Fit" />
          <span className="sub">信心 {formatInt(lineup.confidence)}/100{!recommended ? ` · 平均適配 ${formatSigned(lineup.fitScore - best.fitScore)}` : ''}{lineup.comparableToBest && !recommended ? ' · 差距在比賽雜訊內' : ''}</span>
        </div>
      </header>
      <ul className="tb-members">{lineup.members.map((m) => <MemberCard key={m.publicMemberId} m={m} name={names.get(m.publicMemberId) ?? '?'} applied={lineup.v2Applied} />)}</ul>
    </section>
  );
}

export function TeamBuilderResult({ result, doc, names }: { result: TeamResult; doc: PublicTeamBuilderSnapshot; names: Map<string, string> }) {
  if (result.status !== 'ok' || result.lineups.length === 0) {
    return <Empty title="證據不足，無法建議陣容"><Reasons reasons={result.reason ? [result.reason] : ['no_agent_evidence']} /></Empty>;
  }
  const best = result.lineups[0]!;
  return (
    <div className="tb-result" data-state="result">
      <p className="callout" role="note"><strong>Team Fit 是「歷史相對陣容契合度」</strong>：五人被分配的特務，在各自歷史證據中的平均排名（100＝每個人都在用自己歷史上最適合的特務）。它<strong>不是勝率</strong>、不是對未來比賽的預測，也不證明這是最佳陣容。</p>
      <LineupView lineup={best} names={names} best={best} />
      {result.lineups.length > 1 ? (
        <details className="alternatives">
          <summary>其他接近的陣容（{result.lineups.length - 1}）</summary>
          {result.lineups.slice(1).map((l, i) => <LineupView key={i} lineup={l} names={names} best={best} />)}
        </details>
      ) : null}
      <p className="muted small">可驗證並顯示的分工：{[...doc.emittableAttack, ...doc.emittableDefense].map((l) => RESPONSIBILITY_LABEL[l] ?? l).join('、')}。其他分工類型（例如定點防守、殘局、自由人、轉點）未通過時間序驗證，不顯示；也不提供站位、路線或點位建議。</p>
    </div>
  );
}

export function TeamBuilder({ state, initial }: { state: ReadySnapshot; initial?: { selection: TeamSelection; submitted: boolean } }) {
  const [selection, setSelection] = useState<TeamSelection>(initial?.selection ?? { members: [], map: state.teamBuilder.maps[0] ?? null });
  const [submitted, setSubmitted] = useState<TeamSelection | null>(initial?.submitted ? initial.selection : null);
  const doc = state.teamBuilder;
  const names = new Map(state.group.members.map((m) => [m.publicMemberId, m.displayName]));
  const ready = canCalculate(selection, doc.maps);
  const result = submitted ? findTeamResult(doc, submitted) : null;
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">組隊建議</p>
        <h1>組隊建議</h1>
        <p className="lede">選 5 位成員與一張地圖，依目前可追蹤的競技紀錄，建議每人的特務、角色與已驗證的攻守分工。</p>
        <HistoryNotice from={state.group.coverage.firstMatchAt} to={state.group.coverage.lastMatchAt} />
      </header>
      {state.group.members.length < TEAM_SIZE ? <Empty title="公開成員少於 5 人">需要至少 5 位同意公開的成員。</Empty> : (
        <form className="panel tb-form" onSubmit={(e) => { e.preventDefault(); if (ready) setSubmitted(selection); }} aria-describedby="tb-help">
          <fieldset>
            <legend>選擇 5 位成員（已選 {selection.members.length}/{TEAM_SIZE}）</legend>
            <div className="chips">
              {state.group.members.map((m) => {
                const checked = selection.members.includes(m.publicMemberId);
                const disabled = !checked && selection.members.length >= TEAM_SIZE;
                return (
                  <label key={m.publicMemberId} className={`chip${checked ? ' chip-on' : ''}${disabled ? ' chip-disabled' : ''}`}>
                    <input type="checkbox" checked={checked} disabled={disabled} onChange={() => { setSelection((s) => toggleMember(s, m.publicMemberId)); setSubmitted(null); }} />
                    <span>{m.displayName}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="field" htmlFor="tb-map">
            <span>地圖</span>
            <select id="tb-map" value={selection.map ?? ''} onChange={(e) => { setSelection((s) => ({ ...s, map: e.target.value || null })); setSubmitted(null); }}>
              {doc.maps.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <button type="submit" className="button primary" disabled={!ready}>計算建議</button>
          <p id="tb-help" className="muted small">{ready ? '已可計算。' : `還需要選 ${Math.max(0, TEAM_SIZE - selection.members.length)} 位成員${selection.map ? '' : '與一張地圖'}。`}</p>
        </form>
      )}
      {submitted ? (result ? <TeamBuilderResult result={result} doc={doc} names={names} /> : <Empty title="找不到這個組合的結果">這個組合或地圖不在已發布的快照中。</Empty>) : null}
      <Explain k="team-fit" />
      <Explain k="responsibility" />
    </div>
  );
}
