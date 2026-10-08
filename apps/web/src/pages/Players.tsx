import { HistoryNotice, StatusBadge } from '../components/ui.tsx';
import type { ReadySnapshot } from '../data/loadSnapshot.ts';
import { formatDate, formatScore } from '../format.ts';
import { ROLE_LABEL } from '../i18n.ts';
import { href } from '../router.ts';

export function Players({ state }: { state: ReadySnapshot }) {
  const profiles = new Map(state.profiles.profiles.map((p) => [p.publicMemberId, p]));
  const players = [...state.players.players].sort((a, b) => b.competitiveMatches - a.competitiveMatches || a.displayName.localeCompare(b.displayName));
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">成員</p>
        <h1>玩家</h1>
        <HistoryNotice from={state.group.coverage.firstMatchAt} to={state.group.coverage.lastMatchAt} />
      </header>
      <ul className="player-grid">
        {players.map((p) => {
          const profile = profiles.get(p.publicMemberId);
          return (
            <li key={p.publicMemberId} className="player-card" data-member={p.publicMemberId}>
              <a href={href.player(p.publicMemberId)} className="player-link">
                <span className="player-name">{p.displayName}</span>
                <span className="sub">{profile?.primaryRole ? ROLE_LABEL[profile.primaryRole] : '角色未知'}</span>
              </a>
              <dl className="mini">
                <div><dt>競技</dt><dd>{p.competitiveMatches} 場</dd></div>
                <div><dt>所有模式</dt><dd>{p.matchesObserved} 場</dd></div>
                <div><dt>目前實力</dt><dd>{profile && profile.currentStrength.value !== null && profile.currentStrength.status !== 'insufficient' ? formatScore(profile.currentStrength.value) : '—'}</dd></div>
                <div><dt>期間</dt><dd>{formatDate(p.firstObservedAt)} – {formatDate(p.lastObservedAt)}</dd></div>
              </dl>
              {profile ? <StatusBadge status={profile.currentStrength.status} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
