import { OPT_IN_DISCLAIMER, PRODUCT_NAME_EN, RIOT_LEGAL_BOILERPLATE } from '../legal.ts';

/** Riot use-case alignment (Riot VALORANT Developer API Policy → Game Policy → Use Cases, retrieved 2026-10-09). */
export const FEATURE_ALIGNMENT = [
  { feature: 'Player stats (own)', category: 'Approved: showing player stats', optIn: 'Yes', status: 'Demo (synthetic)', notes: 'Shown only after the player links and grants permissions.' },
  { feature: 'Group member stats', category: 'Approved: community stats for members (opt-in)', optIn: 'Yes', status: 'Demo (synthetic)', notes: 'Invite-only groups; each member grants Group Visibility separately.' },
  { feature: 'Diff Check (teammate comparison)', category: 'Approved: player stats (historical, opt-in)', optIn: 'Yes (both members)', status: 'Demo (synthetic)', notes: 'Friendly within-squad comparison of two consenting members of the same group: all-history statistics and same-match views kept separate. Not scouting, not MMR / Elo, no lookup outside the group.' },
  { feature: 'Shared-Match comparison', category: 'Approved: player stats (opt-in), historical', optIn: 'Yes (both members)', status: 'Demo (synthetic)', notes: 'Compares two consenting members in matches they played together on the same team. Not MMR.' },
  { feature: 'Team Builder', category: 'Approved: training / retrospective analytics', optIn: 'Yes (all five)', status: 'Demo (synthetic)', notes: 'Historical agent/role fit for pre- or post-match planning. No live data, no positions, no in-match instructions.' },
  { feature: 'Aggregate group analytics', category: 'Approved: aggregate stats', optIn: 'Members shown individually: yes', status: 'Demo (synthetic)', notes: 'Group totals over consenting members only.' },
  { feature: 'Opponent scouting', category: 'Prohibited: scouting', optIn: '—', status: 'NOT OFFERED', notes: 'No opponent lookup, no arbitrary Riot-ID search, no global player database.' },
  { feature: 'MMR / Elo alternative', category: 'Prohibited: alternatives to official skill ranking', optIn: '—', status: 'NOT OFFERED', notes: 'Scores are group-internal community statistics with explanations; never a rank, ladder, hidden rating or MMR.' },
  { feature: 'Real-time tactical guidance', category: 'Prohibited: real-time advantage', optIn: '—', status: 'NOT OFFERED', notes: 'No in-game overlay, no live match data, no "go here now" instructions.' },
] as const;

export function Product() {
  return (
    <div className="page prose" lang="en">
      <header className="page-header">
        <p className="eyebrow">產品說明（Riot 申請審查用）</p>
        <h1>{PRODUCT_NAME_EN}: product overview</h1>
        <p className="lede" lang="zh-Hant">給私人、邀請制朋友群組的 VALORANT 社群表現分析。每位成員各自決定是否連結帳號、是否收集資料、是否讓群組看到、是否公開衍生統計。目前網站全部是合成示範資料。</p>
        <p className="callout" role="note"><strong>Today:</strong> synthetic demo only — no sign-in, no Riot account linking, no Riot API calls, no real player data. <strong>Requires Riot approval:</strong> Production API key, Riot Sign On (RSO) client, and therefore every real-data feature.</p>
      </header>

      <section className="panel">
        <h2>What it does</h2>
        <ul className="plain">
          <li>Private / invite-only friend groups review their own VALORANT matches together.</li>
          <li>Each opted-in member sees their own statistics and the statistics of members who allowed group visibility.</li>
          <li>Historical derived analytics: transparent community scores with explanations and sample sizes, Diff Check (friendly comparison of two consenting teammates, including their shared matches), and historical team-composition suggestions.</li>
          <li>Live demo with fictional data: <a href="#/">Dashboard</a> · <a href="#/players">Players</a> · <a href="#/compare">Diff Check</a> · <a href="#/synergy">Shared-Match</a> · <a href="#/team-builder">Team Builder</a>.</li>
        </ul>
      </section>

      <section className="panel">
        <h2>Intended users and group model</h2>
        <ul className="plain">
          <li>Small friend groups (for example a regular five-stack). Groups are PRIVATE or INVITE_ONLY; there are no public groups and no global search.</li>
          <li>Roles: owner, admin, member. Invites are one-time, expiring links; joining a group grants no data access.</li>
        </ul>
      </section>

      <section className="panel">
        <h2>Player opt-in flow</h2>
        <ol className="plain">
          <li>Join a group by invite (no data access yet).</li>
          <li>Choose to link a Riot account via Riot Sign On (user-initiated, optional).</li>
          <li>Review three separate permissions, all OFF by default: Data Collection, Group Visibility, Public Derived Analytics.</li>
          <li>Request a sync: only with a verified account and Data Collection.</li>
          <li>Revoke any permission or unlink at any time: future sync and publication eligibility stop and a data-revocation request is processed.</li>
        </ol>
        <p>Try the interactive synthetic walkthrough: <a href="#/demo-flow">Opt-in flow demo</a>.</p>
        <div className="disclaimer"><p className="demo-chip">{OPT_IN_DISCLAIMER.label}</p><ul className="plain">{OPT_IN_DISCLAIMER.en.map((p) => <li key={p}>{p}</li>)}</ul></div>
      </section>

      <section className="panel">
        <h2>Data flow</h2>
        <pre className="diagram" aria-label="Data flow diagram">{`Player ─► Riot Sign On (future) ─► verified identity (private reference)
       ─► explicit consent (default deny) ─► sync request (job metadata)
CONTROL PLANE  (groups · invites · consent · job metadata — never match data)
       ▲ status            │ pending jobs (polled OUTBOUND)
LOCAL WORKER ─► official Riot API (future) ─► local PostgreSQL canonical store
       ─► analytics ─► privacy allowlist ─► sanitized static snapshot ─► this website`}</pre>
        <p>The control plane is not a match database. The website only reads static, privacy-validated snapshots and never calls a game-data API; no API key is ever in the browser.</p>
      </section>

      <section className="panel">
        <h2>Riot policy alignment</h2>
        <table className="table responsive">
          <thead><tr><th scope="col">Feature</th><th scope="col">Riot policy category</th><th scope="col">Opt-in</th><th scope="col">Status</th><th scope="col">Notes</th></tr></thead>
          <tbody>{FEATURE_ALIGNMENT.map((r) => (
            <tr key={r.feature} data-feature={r.feature}>
              <th scope="row">{r.feature}</th><td data-label="Riot policy category">{r.category}</td><td data-label="Opt-in">{r.optIn}</td>
              <td data-label="Status">{r.status}</td><td data-label="Notes">{r.notes}</td>
            </tr>
          ))}</tbody>
        </table>
        <p><strong>Team Builder</strong> is pre-/post-match planning from historical evidence: which agents and roles each member has historically played best. It shows no live information, no positions or routes, and gives no in-match instructions.</p>
        <p><strong>Scores</strong> (Community Score, Recent Performance, Shared-Match, Team Fit) are group-internal community statistics. They are not Riot MMR, a hidden rank, an Elo replacement or an official skill ladder, and they are explained on the <a href="#/about">methodology page</a>.</p>
      </section>

      <section className="panel">
        <h2>Privacy model</h2>
        <ul className="plain">
          <li>Default deny; four independent states (verified connection fact + three permissions); ordered grants with cascading revocation.</li>
          <li>Public pages come from an allowlist: no account identifiers, raw match ids, positions or view directions are ever published.</li>
          <li>Members who have not opted in never appear in anyone else's comparisons.</li>
          <li><a href="#/privacy">Privacy Policy</a> · <a href="#/terms">Terms of Service</a></li>
        </ul>
      </section>

      <section className="panel">
        <h2>What is synthetic today, what requires approval</h2>
        <ul className="plain">
          <li>Synthetic today: all members, matches and statistics on this website; the opt-in walkthrough (in-browser only).</li>
          <li>Implemented but not deployed: the group / invite / consent / sync-job domain (prototype persistence only).</li>
          <li>Requires Riot approval: Production API key, RSO client, real account linking and any real player data.</li>
        </ul>
        <p className="muted small">{RIOT_LEGAL_BOILERPLATE}</p>
      </section>
    </div>
  );
}
