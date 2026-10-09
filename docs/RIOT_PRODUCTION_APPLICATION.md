# Riot Production / RSO application package (DRAFT — NOT SUBMITTED)

V2-RSO-PRODUCTION-READINESS-01 (2026-10-09). Status: **prepared for manual / SDD review**.

| Item | State |
|---|---|
| `RIOT_APPLICATION_SUBMITTED` | NO |
| `RSO_APPLICATION_SUBMITTED` | NO |
| `RIOT_CREDENTIALS_USED` | NO |
| Riot support ticket | #139243830, open; `RIOT_SUPPORT_RESPONSE_RECEIVED = NO`; no new ticket or message |

Nothing in this package says or implies that Riot has approved anything. Approval is not predictable.

Companion documents:
- [RIOT_APPLICATION_CHECKLIST.md](RIOT_APPLICATION_CHECKLIST.md);
- [PRIVACY_POLICY.md](PRIVACY_POLICY.md) and [TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md) (both generated from the website source);
- [RSO_READINESS.md](RSO_READINESS.md);
- [CONTROL_PLANE_DESIGN.md](CONTROL_PLANE_DESIGN.md) and [CONTROL_PLANE_THREAT_MODEL.md](CONTROL_PLANE_THREAT_MODEL.md).

## SDD rulings (binding, accepted 2026-10-09; V2-RSO-READINESS-RULING-SYNC-01)

| Ruling | Value |
|---|---|
| `SYNTHETIC_PROTOTYPE_SUFFICIENT_TO_APPLY` | YES |
| `DURABLE_CONTROL_DB_REQUIRED_BEFORE_APPLICATION` | NO |
| `REAL_PRODUCT_SIGN_IN_REQUIRED_BEFORE_APPLICATION` | NO |
| `LIVE_RSO_REQUIRED_BEFORE_APPLICATION` | NO |
| `REAL_MEMBER_RECONSENT_REQUIRED_BEFORE_APPLICATION` | NO |
| `REAL_MEMBER_RECONSENT_REQUIRED_BEFORE_REAL_DATA_USE_OR_PUBLICATION` | YES |
| `APPLICATION_SUBMITTED` | NO |
| `DOMAIN_STRATEGY` | OWNED_CUSTOM_DOMAIN |
| `GITHUB_USER_SITE_WORKAROUND` | NOT_SELECTED |
| `CUSTOM_DOMAIN` | MANUAL_ACTION_REQUIRED (the domain name is not chosen yet) |
| `PRIVATE_CONTACT_STRATEGY` | DEDICATED_EMAIL_ALIAS (preferred shape `privacy@<owned-domain>`; optional `support@<owned-domain>`) |
| `PRIVATE_CONTACT_CHANNEL` | MANUAL_ACTION_REQUIRED (`CONTACT_METHOD_PENDING = YES`; no address is invented or published) |

**Domain reason.** Riot requires a root-verifiable website (`riot.txt` at the website root). The GitHub Pages project sub-path
cannot serve a root file. A `*.github.io` root-host workaround is not selected because Riot does not explicitly establish it
as an acceptable production verification domain.

**Real members.** The 9 imported members stay `REQUIRES_RECONSENT`. That blocks any use or publication of their real data;
it does not block submitting the synthetic Production application. No consent state was changed.

## 1. Current Riot policy (official sources only, retrieved 2026-10-09)

| Requirement | Finding (paraphrased) | Official source |
|---|---|---|
| VALORANT personal key | **Not available**: personal keys are not offered for VALORANT, and personal-key applications asking for VALORANT are not approved | [Developer Portal FAQ](https://developer.riotgames.com/docs/faqs); [VALORANT docs](https://developer.riotgames.com/docs/valorant) |
| Production key for a public VALORANT product | **Required**. A public product may not run on a development or personal key. Production keys are for fully functioning products whose user flows can be demonstrated | [Portal docs](https://developer.riotgames.com/docs/portal); FAQ |
| RSO | **Only after approval**: RSO clients are issued only to applications with an approved production application; RSO access requires a production-level key | FAQ; VALORANT docs |
| Player opt-in | **Required**: every VALORANT app must ask players to opt in to sharing their data; players who did not opt in must not have their data shown to others | VALORANT docs |
| Opt-in disclaimer | **Required**: an in-app disclaimer that account linking makes player data public | VALORANT docs (Use Cases) |
| Scouting | **Prohibited** (looking at opponents' stats before a match) | VALORANT docs |
| MMR / Elo / ranking alternatives | **Prohibited**: no alternatives to official skill-ranking systems such as the ranked ladder | VALORANT docs |
| Real-time advantage | **Prohibited**: in-game real-time data that immediately changes player behaviour | VALORANT docs |
| De-anonymization | **Prohibited** | VALORANT docs; [General Policies](https://developer.riotgames.com/policies/general) |
| Not-public / personal-use apps | **Not approved** | VALORANT docs |
| Working site / prototype | **Required**: a link to a working site, mockup, prototype or rendering that makes the user flows clear; a GitHub repository is not accepted in place of a site | VALORANT docs; FAQ |
| Privacy policy | **Required**: Riot reviews the site's Privacy Policy | FAQ |
| Terms of Service | **Required** (same FAQ answer) | FAQ |
| Verified website | **Required**: no production key without a verified website; verification = a `riot.txt` text file uploaded to the root directory of the website (example `https://www.yourdomain.com/riot.txt`), to be removed after verification | FAQ; [How to verify site](https://developer.riotgames.com/how-to-verify-site.html) |
| Legal boilerplate | **Required**, in a place readily visible to players (the exact Riot wording is displayed in the site footer, see `RIOT_LEGAL_BOILERPLATE`) | General Policies |
| Registration | Products that serve players must be registered, with description and metadata kept current | VALORANT docs (Developer API Policy) |
| Monetization | A free tier is required; monetization must be fair | General Policies |
| Key security | Use HTTPS; never put the key in code or distributed binaries | General Policies |

**Domain (`DOMAIN_REQUIREMENT = OWN_DOMAIN_RECOMMENDED`).**
- Riot verifies ownership of the domain where the application is hosted, through `riot.txt` at the root of the website.
- The current demo is a GitHub Pages **project** site under a sub-path (`scottpuppylu.github.io/valorant-squad-analytics-v2/`). This repository cannot place a file at that host's root.
- Whether a `*.github.io` host is acceptable at all is **not stated** by Riot.
- A product-owned domain is therefore recommended before applying.
- SDD decision: `DOMAIN_STRATEGY = OWNED_CUSTOM_DOMAIN`, `GITHUB_USER_SITE_WORKAROUND = NOT_SELECTED`, `CUSTOM_DOMAIN = MANUAL_ACTION_REQUIRED`. Nothing was purchased or configured.

**Questions the ticket asked that the docs now answer.** The current official docs answer these independently of ticket #139243830:
- VALORANT has no personal keys;
- RSO needs an approved production application;
- review is typically weekly, sometimes up to three weeks.

The ticket stays open, with no response recorded.

## 2. Portal answers (ready to copy; do NOT submit)

**SHORT_DESCRIPTION**

> 哥布林大調查 (Goblin Survey) is an opt-in VALORANT stats site for private, invite-only friend groups: members who link
> their Riot account and give permission can review their own and their group's historical performance together.

**LONG_DESCRIPTION**

> 哥布林大調查 helps small friend groups that play VALORANT together understand their own matches.
>
> **Groups and opt-in.** A group owner creates a private or invite-only group and invites friends with one-time links.
> Joining a group grants no data access. Each member can optionally link their Riot account through Riot Sign On, and
> then decides separately whether we may:
> - collect their match data;
> - show their statistics to their group;
> - show derived statistics on a public group page.
>
> All three permissions are off by default and can be revoked at any time.
>
> **What members see:**
> - their own statistics, and those of members who allowed group visibility;
> - transparent community statistics, each with an explanation and its sample size;
> - a shared-match comparison of two consenting members in matches they played together;
> - historical team-composition suggestions (which agents and roles each member has historically played best), for
>   planning before or after games.
>
> **What it does not do.** No opponent scouting, no Riot-ID lookup of strangers, no global player database, no real-time
> in-game information, and no rank, MMR or Elo replacement.
>
> **Data.** Match data is fetched server-side from the official API by our worker. Public pages are static, sanitized
> snapshots without account identifiers.

**USER_VALUE.** Friend groups get a shared, honest view of how they play together:
- strengths per member and role;
- which teammates they perform well alongside in the same matches;
- historically well-suited agent and role assignments for their usual five.

Every number has an explanation, a sample size and an "insufficient evidence" state instead of a guess.

**WHY_RIOT_API_IS_REQUIRED.** The product needs each opted-in member's VALORANT match history and match details
(VAL-MATCH-V1), from an authoritative, policy-governed source, to compute their statistics. The current prototype uses
synthetic data only. A third-party API was used solely for private local evaluation and is not intended as the public
data source.

**WHY_RSO_IS_REQUIRED.**
- Opt-in must be proven by the player: RSO verifies that the person linking an account owns it, and gives us the account
  reference to fetch only that player's data.
- Without RSO a user could claim someone else's Riot ID, which would enable scouting.
- We never offer lookups by arbitrary Riot ID.

**DATA_USED.**
- Riot account reference of opted-in players (private);
- match history and match details of their matches: map, mode, rounds, kills / assists / damage, plant / defuse events,
  agents, team results;
- per-match rank context where available, used only as context, never to compute a rank;
- product metadata: groups, invites, consent states, sync jobs, audit records.

**DATA_NOT_USED.**
- Data of players who did not opt in (shown to no one, and excluded from other members' comparisons);
- opponent profiles;
- real-time or live game data;
- chat, voice, payments;
- any data for advertising or sale;
- raw account identifiers, match ids, positions or view directions on public pages.

**PLAYER_OPT_IN_FLOW.** Invite → join (no access) → optional Riot Sign On (user-initiated) → in-app opt-in disclaimer →
three separate permissions (default off) → sync request → statistics.
- Interactive synthetic walkthrough: `#/demo-flow`.
- Disclaimer draft: §5.

**REVOCATION_FLOW.**

| Action | Effect |
|---|---|
| Revoke public analytics | Excluded from future public snapshots |
| Revoke group visibility | Hidden from the group; public eligibility ends |
| Revoke data collection or unlink | Future sync stops; publication eligibility ends; a data-revocation request removes the player-attributable precise spatial evidence (shared non-attributable match records are not instantly deleted) |
| Leave a group | Eligibility for that group ends |

**SECURITY_MODEL.** See §6.

**PUBLICATION_MODEL.**
- Public pages are static snapshots built from a privacy allowlist (unknown fields rejected) and validated again on
  publish and on read.
- A member appears only if their membership is active and they granted group visibility and public derived analytics.

**CURRENT_PROTOTYPE_STATUS.**
- **Public:** a synthetic demo at https://scottpuppylu.github.io/valorant-squad-analytics-v2/ (product page `#/product`,
  opt-in walkthrough `#/demo-flow`, privacy `#/privacy`, terms `#/terms`).
- **Implemented, not deployed:** the group / invite / consent / sync domain (prototype persistence only).
- **Not live:** authentication and RSO.

**FUTURE_PRODUCTION_ARCHITECTURE.**
- Product sign-in plus RSO.
- Control plane with durable storage: groups, invites, consent and job metadata, never match data.
- Local worker: polls jobs outbound, fetches from the official API over HTTPS with the server-side key, stores canonical
  data in PostgreSQL.
- Analytics, then a sanitized static snapshot, then the website.

## 3. Use-case alignment

| FEATURE | RIOT_POLICY_CATEGORY | OPT_IN_REQUIRED | STATUS | NOTES |
|---|---|---|---|---|
| Player stats (own) | Approved: showing player stats | YES | DEMO (synthetic) | Only after linking + permissions |
| Group member stats | Approved: community stats for members (opt-in) | YES | DEMO (synthetic) | Invite-only; Group Visibility per member |
| Shared-Match comparison | Approved: player stats (historical, opt-in) | YES (both members) | DEMO (synthetic) | Same-team shared matches of two consenting members; not MMR |
| Team Builder | Approved: training / retrospective analytics | YES (all five) | DEMO (synthetic) | Historical fit; pre- / post-match planning |
| Aggregate group analytics | Approved: aggregate stats | Per-member display: YES | DEMO (synthetic) | Over consenting members only |
| Opponent scouting | Prohibited: scouting | — | **NOT OFFERED** | No opponent or arbitrary Riot-ID lookup |
| MMR / Elo alternative | Prohibited: official ranking alternative | — | **NOT OFFERED** | Community statistics, explicitly not rank / MMR / Elo |
| Real-time tactical guidance | Prohibited: real-time advantage | — | **NOT OFFERED** | No live data, overlay or in-match instructions |

**Team Builder review.**
- **It is:** a historical, retrospective planning aid. It shows which agent and role each of five chosen members has the
  best historical evidence for on a map, plus validated attack / defense responsibilities.
- **It is not:**
  - live (no match data during play, no overlay);
  - spatial (no positions, routes, sites or callouts; "go here now" guidance does not exist);
  - predictive (Team Fit is labelled "relative historical lineup fit, not a win probability").

**Score wording audit.** Community Score, Recent Performance, Shared-Match and Team Fit are group-internal community
statistics with on-page explanations.
- The Dashboard ranking heading "目前實力排名" read like a skill ladder. It was relabelled "近期表現排序", with an explicit
  "not an official rank, MMR, Elo or hidden rating" note.
- Every score explanation states it is not a rank or MMR.
- Algorithms were not changed.

## 4. Data flow

```
User ─► Riot Sign On (future) ─► identity verification (private account reference)
     ─► explicit consent (default deny, 3 permissions) ─► sync request (job metadata)
          │
CONTROL PLANE: groups · invites · consent · job metadata          ≠  canonical match storage
          │ pending jobs, polled OUTBOUND (no inbound port)
LOCAL WORKER ─► official Riot API (future, HTTPS, server-side key) ─► local PostgreSQL canonical store
     ─► analytics ─► privacy allowlist ─► sanitized static snapshot ─► website (static, no API key)
```

## 5. VALORANT opt-in disclaimer (DRAFT FOR RIOT REVIEW)

Riot has not reviewed or approved this text. It is shown in-app before the (mock) account-linking step. The source is
`apps/web/src/legal.ts` (`OPT_IN_DISCLAIMER`):

1. Linking your Riot account is optional and only happens when you start it.
2. Linking authorizes this service to access your VALORANT player data, but only within the permissions you turn on.
   Data collection, group visibility and public derived analytics are separate switches, all OFF by default.
3. If you allow group visibility, members of your invite-only group can see your player statistics. If you also allow
   public derived analytics, derived statistics (never raw identifiers, match ids or positions) can appear on the public
   group page. Linking with those permissions therefore makes that player data public.
4. Other people cannot see your player-specific information unless you have granted the matching permission. You can
   revoke any permission or unlink at any time; this stops future collection and publication eligibility and requests
   removal processing.

## 6. Security summary

- **Keys and credentials:**
  - no provider or API key in the browser or the public repository (CI uses zero secrets);
  - future production API access over HTTPS with a server-side key;
  - no Riot credentials in GitHub.
- **Private references:**
  - provider subjects (account references) are private;
  - public contracts have no field for them, and a privacy guard rejects them.
- **Invites:** 256-bit invite tokens, stored only as SHA-256 hashes, compared in constant time; one-time and expiring.
- **Consent:** default deny; four independent states; self-only grants; cascading revocation.
- **Audit:** append-only, redacted (no tokens or subjects).
- **Sync jobs:** fencing leases with expiry and heartbeat; a consent re-check before any provider request; idempotent
  completion.
- **Public read model:** a static allowlist, re-validated on publish and on read, plus bundle and snapshot privacy scans in
  CI.
- **Revocation:** a revocation event enforced by the local data plane.

## 7. Production architecture gap list (not hidden)

Only the rows marked **pre-application blocker** stop the application from being submitted. Everything else is a
production / runtime gap to close after approval.

| Gap | Status |
|---|---|
| Approved Riot Production key | BLOCKED_ON_RIOT_APPROVAL |
| Approved RSO client | BLOCKED_ON_RIOT_APPROVAL |
| Owned custom domain (root-verifiable, `riot.txt`) | MANUAL_ACTION_REQUIRED, **pre-application blocker** |
| Real product authentication (sign-in, sessions) | NOT_IMPLEMENTED |
| Secure token / session storage (RSO tokens used only server-side) | NOT_IMPLEMENTED |
| OAuth callback infrastructure (redirect URI, PKCE, server exchange) | NOT_IMPLEMENTED |
| Durable control-plane persistence | NOT_IMPLEMENTED (in-memory reference only) |
| Backend deployment (control plane) | NOT_IMPLEMENTED (`CONTROL_PLANE_DEPLOYED = NO`) |
| Retention / deletion worker (scheduled, deletion requests) | PARTIAL (revocation contract only) |
| Monitoring / incident handling | NOT_IMPLEMENTED |
| Private contact channel (dedicated email alias) | MANUAL_ACTION_REQUIRED, **pre-application blocker** (`CONTACT_METHOD_PENDING = YES`) |
| Re-consent of the private evaluation group | Pending (9 × REQUIRES_RECONSENT); blocks real-data use / publication, not the application |

**Control-plane status:**
- `CONTROL_PLANE_DOMAIN = IMPLEMENTED`
- `CONTROL_PLANE_PERSISTENCE = PROTOTYPE_ONLY`
- `CONTROL_PLANE_DEPLOYED = NO`
- `LIVE_AUTHENTICATION = NO`
- `LIVE_RSO = NO`

## 8. Retention and deletion model

Retention by data class (no legal periods invented):

| Data class | Retention |
|---|---|
| Control-plane metadata | OPERATIONAL_NECESSITY |
| Consent audit / history | OPERATIONAL_NECESSITY; period TBD_WITH_POLICY_REVIEW |
| Provider identity reference | UNTIL_USER_REVOCATION (cleared on unlink) |
| Canonical match evidence | UNTIL_USER_REVOCATION of collection, plus the deletion rules; period TBD_WITH_POLICY_REVIEW |
| Derived analytics | Recomputed; removed from future publications on ineligibility |
| Public snapshots | Immutable; replaced by a snapshot without the member; old files TBD_WITH_POLICY_REVIEW |
| Revocation records | OPERATIONAL_NECESSITY |

Operations are distinct:

| Operation | Sync | Group visibility | Publication | Data effect |
|---|---|---|---|---|
| Revoke public analytics | continues | unchanged | ends | none |
| Revoke group visibility | continues | ends | ends | none |
| Revoke data collection | stops | ends | ends | revocation request: attributable precise spatial evidence erased; shared topology kept |
| Disconnect account | stops | ends | ends | account reference cleared + as above |
| Leave group / removed | stops for that group | ends | ends | none by itself |
| Request deletion | — | — | — | planned process, TBD_WITH_POLICY_REVIEW (via the private contact, pending) |

## 9. Screenshots

All synthetic. See [assets/riot-application/](assets/riot-application/) and the index in
[RIOT_APPLICATION_CHECKLIST.md](RIOT_APPLICATION_CHECKLIST.md).
