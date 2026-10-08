# Data source strategy

Sources plug in as `DataProviderAdapter`s and declare their actual capabilities at runtime. The table below is planning
information, **not** a runtime fact. Every source converts its payloads to canonical contracts inside its adapter, and
analytics never sees provider types (enforced by `npm run check:architecture`).

| Candidate | IDENTITY | HISTORICAL_MATCH | MATCH_DETAIL | FORWARD_LIVE | RANK | STATIC_CONTENT | Status / constraints |
|---|---|---|---|---|---|---|---|
| Fake (fixtures) | ✓ | ✓ | ✓ | — | ✓ | — | **Implemented.** Offline, deterministic, synthetic |
| Henrik (third-party API) | planned | planned (provider-visible subset) | planned | — | planned | — | Skeleton. The server-side key lives in the local collector only, never a browser; the provider's rate budget applies; history is not complete |
| Riot (official API + RSO) | planned (RSO) | planned (depth unknown) | planned | — | unknown | possible | Skeleton. Requires Riot production approval and RSO; ticket handling stays separate |
| Overwolf (client app) | — | — | — | planned | — | — | Skeleton. Forward-only from a user-installed client; no back-fill |
| Tracker / Blitz | — | — | — | — | — | — | Only as a future **partner / business** data agreement; no API assumed |
| Manual / import archive | — | planned | planned | — | — | — | Owner-provided exports with explicit provenance (e.g. V2-DATA-IMPORT-01) |

## Rules (non-negotiable)

- No scraping.
- No reverse engineering of private endpoints.
- No browser credential extraction.
- No anti-bot bypass.
- No dependency on undocumented internal APIs.
- Provider keys live server-side in the local collector; players never provide provider credentials.
- Every acquisition step is bounded: page size ≤ 20 and pages per account, request budgets and rate limits per
  adapter.

## Multiple sources

- `ProviderRouter` picks a primary and falls back only when the provider is **unavailable**.
- It never merges conflicting evidence: each canonical match keeps one `source` (provider, adapter version, normalizer
  version, private record ref, observed time).
- Combining sources for the same real match needs an explicit, versioned **reconciliation policy** (a future task).
  Until then, duplicates are kept apart by `(provider, provider_record_ref)`.

## History completeness

- `historyCompleteness` is `unknown` or `provider-visible`. No value means "complete career".
- `lifetimeComplete` is always `false` in public output, unless future authoritative evidence proves otherwise.
