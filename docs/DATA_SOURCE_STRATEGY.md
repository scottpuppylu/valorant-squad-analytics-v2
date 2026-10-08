# Data source strategy

Sources plug in as `DataProviderAdapter`s and declare their actual capabilities at runtime. The table below is planning
information, **not** a runtime fact. Every source converts its payloads to canonical contracts inside its adapter, and
analytics never sees provider types (enforced by `npm run check:architecture`).

Evidence and per-provider details: [PROVIDER_MATRIX.md](PROVIDER_MATRIX.md). Design: [PROVIDER_ARCHITECTURE.md](PROVIDER_ARCHITECTURE.md)
(V2-PROVIDER-WAVE-01). The states below stay distinct:
- **IMPLEMENTED** = runtime-declared by an adapter in this repository.
- **DOCUMENTED** = publicly documented by the provider, not implemented here.
- **UNKNOWN** = unproven.
- **FUTURE** = planned, with no code path.
- **PARTNER_ONLY** = needs a business agreement.

| Source | IDENTITY | MATCH_HISTORY | MATCH_DETAIL | RANK | FORWARD_LIVE | STATIC_CONTENT | Status |
|---|---|---|---|---|---|---|---|
| Fake (fixtures) | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | — | — | Synthetic demo provider |
| Henrik (third-party API) | IMPLEMENTED | IMPLEMENTED (provider-visible subset) | IMPLEMENTED | IMPLEMENTED | — | DOCUMENTED, unused | **IMPLEMENT_NOW** (adapter): local, bounded, consented use; operator key server-side only; ≤ 6 RPM / ≤ 2 lanes; `HENRIK_PUBLIC_SCALE_BACKBONE = NO` |
| Riot (official API + RSO) | DOCUMENTED (RSO) | DOCUMENTED (depth UNKNOWN) | DOCUMENTED | — (leaderboards only) | — | DOCUMENTED | **PREPARE**: long-term primary candidate (official match APIs exist; invite-group stats = candidate approved use case); contract-only adapter, 0 requests; needs production key + RSO + player opt-in; ticket #139243830 open, no response |
| Overwolf (client app) | live only | — | live only | UNKNOWN | DOCUMENTED | — | **RESEARCH_ONLY**: FORWARD_LIVE feasible, no historical replacement established; needs Riot + Overwolf approval; FUTURE design interface only |
| Tracker Network | — | — | — | — | — | — | **NOT_AVAILABLE** for VALORANT (staff: not permitted by Riot policy) |
| Blitz | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | **NOT_AVAILABLE** (no public API found); partner UNKNOWN |
| Manual / import archive | — | IMPLEMENTED | IMPLEMENTED | — | — | — | **IMPLEMENT_NOW**: `vsa-match-archive-v1`, private by default |
| Future partner API | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | **PARTNER_ONLY** |

## Rules (non-negotiable)

- No scraping.
- No reverse engineering of private endpoints.
- No browser credential extraction.
- No anti-bot bypass.
- No dependency on undocumented internal APIs (never as production architecture).
- No hidden Tracker / Blitz APIs.
- No Riot client-token extraction.
- Provider keys live server-side in the local collector; players never provide provider credentials.
- Every acquisition step is bounded: page size ≤ 20 and pages per account, request budgets and rate limits per
  adapter.

## Multiple sources

- **Routing.** `ProviderRouter` (`provider-router-v1`) routes by explicit capability, with a deterministic order.
- **Fallback** happens only on network unavailable / timeout, provider temporarily unavailable or capability
  unsupported, and only inside one record namespace.
- **Conflicts** are `PROVIDER_CONFLICT`: the router never falls back or merges on one.
- **One source per match.** Each canonical match keeps one `source` (ingestion-provenance-v1).
- **Identity** (`logical-match-identity-v1`):
  - exact evidence only: the same record, or an explicit recorded link;
  - map plus approximate time is a CANDIDATE and is never merged;
  - a Henrik id is never assumed to be a Riot id.
- **Reconciliation.** Combining evidence from several sources for one real match still needs an explicit, versioned
  reconciliation policy (a future task). Until then, records stay separate by `(provider namespace, record ref)`.

## History completeness

- `historyCompleteness` is `unknown` or `provider-visible`. No value means "complete career".
- `lifetimeComplete` is always `false` in public output, unless future authoritative evidence proves otherwise.
