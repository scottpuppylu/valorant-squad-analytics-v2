# Provider architecture

V2-PROVIDER-WAVE-01 (2026-10-09). Status: **AWAITING SDD REVIEW**. Local only, not pushed.

The availability evidence is in [PROVIDER_MATRIX.md](PROVIDER_MATRIX.md), and the policy in
[DATA_SOURCE_STRATEGY.md](DATA_SOURCE_STRATEGY.md).

```
provider API / archive ─► adapter (packages/source-adapters/src/<provider>) ─► canonical contracts ─► collector ─► local PG18
                         transport · limiter · budget · metrics                    (no provider types beyond this line)
```

## Versions

| Component | Version |
|---|---|
| Capability vocabulary | `provider-capabilities-v1` |
| Router | `provider-router-v1` |
| Error classification | `provider-errors-v1` |
| Logical-match identity | `logical-match-identity-v1` |
| Provenance | `ingestion-provenance-v1` (mapped onto canonical-schema-v2, no schema change) |
| Henrik | `henrik-adapter-v1`, `henrik-v4-normalizer-v1`; payload `henrik-v4` |
| Import | `import-file-adapter-v1`, archive `vsa-match-archive-v1` |
| Riot | `riot-adapter-v1-contract` (contract only) |
| Overwolf | `overwolf-adapter-v1-design` (declaration only) |

## Capability vocabulary

| Capability | Meaning | Method |
|---|---|---|
| `IDENTITY` | Riot-ID handle → provider-scoped account ref (private) | `resolveAccount` |
| `MATCH_HISTORY` | One bounded page (≤ 20) of provider-visible match refs, plus internal history-depth metadata | `listMatches` |
| `MATCH_DETAIL` | One match → `CanonicalMatch` | `getMatch` |
| `RANK` | `RankContext` rows: provider semantics; `providerElo` is never MMR | `getRankContext` |
| `FORWARD_LIVE` | Live / forward-only events from a running client; no history | push design only (`ForwardLiveSource`) |
| `STATIC_CONTENT` | Content catalogs; provenance separate from match evidence | none implemented |

**Renamed capability.** `FORWARD_EVENTS` (the earlier name) is now `FORWARD_LIVE`. `parseCapability` maps it, and unknown
names are rejected.

**What is not a capability.** Pagination and history depth are properties of `MATCH_HISTORY` results:
- `history.completeness`: `provider-visible`;
- `lifetimeComplete`: always `false`;
- `providerReportedTotal`: `null` unless documented.

This avoids capability explosion.

## Adapters

| Adapter | Runtime capabilities | Notes |
|---|---|---|
| `HenrikAdapter` (`/henrik`) | IDENTITY, MATCH_HISTORY, MATCH_DETAIL, RANK | Documented endpoints only. Key from config or env (`HENRIK_API_KEY`, `HENRIK_AFFINITY`, `HENRIK_PLATFORM`), sent only as the documented `Authorization` header and never as `api_key` in a URL. Henrik DTO schemas (`henrik/dto.ts`) are not exported. |
| `ImportFileAdapter` (`/import`) | MATCH_HISTORY, MATCH_DETAIL | See below |
| `RiotAdapter` (`/riot`) | none | Lists `documentedCapabilities`; every method throws `CAPABILITY_NOT_CONFIGURED`. `RIOT_ACCESS_STATUS` records no production key, no RSO, ticket #139243830 and no response. No fake implementation and no request. |
| `OverwolfAdapter` (`/overwolf`) | none | `documentedCapabilities = [FORWARD_LIVE]`. `ForwardLiveSource` is a design-only push interface: a future client app would hand a completed, consented match to the collector. No runtime, SDK or request. |
| `FakeProviderAdapter` (root, `/fake`) | IDENTITY, MATCH_HISTORY, MATCH_DETAIL, RANK | Synthetic demo provider |

**HenrikAdapter details:**
- **MATCH_DETAIL** uses the single shared v4 normalizer (`henrik/normalizeV4.ts`, moved from the legacy importer and
  unchanged).
- **Rejected detail responses:** a response for a different match record is `MALFORMED_RESPONSE`.
- **RANK** produces `current` / `peak` / `seasonal` rows:
  - effective at observation time, never match-time context;
  - tiers name-normalized with `valorant-tier-order-v1` (equal to analytics `normalizeTier`, tested);
  - an absent rank produces no rows.

**ImportFileAdapter details:**
- **Input:** JSON only, with no code execution.
- **Path:** a relative `.json` path inside one operator root. Absolute paths, `..`, NUL, symlinks and root escape (realpath)
  are rejected.
- **Size:** ≤ 32 MiB by default, 64 MiB ceiling, ≤ 5 000 records.
- **Envelope:** strict `vsa-match-archive-v1`, with a registered `payloadFormat` (`henrik-v4-match`). Unknown formats and
  duplicate or missing record refs are rejected.
- **Namespace:** the record namespace is the payload's own (`henrik`), so archive and live records of one match share one
  `matchKey`.
- **Privacy:** private by default.

## Transport (`ProviderHttpClient`)

Each call is one GET, parsed as JSON. The transport has no pagination, no account loop and no analytics semantics.

**Request shape:**
- **Timeouts:** `AbortSignal.timeout` (≤ 30 s) combined with the caller's `AbortSignal`.
- **Retries:** bounded, `maxRetries` ≤ 2:
  - retried: network errors, timeouts and 5xx, with exponential backoff;
  - 429 retried only with a documented `Retry-After` / `X-RateLimit-Reset` of at most 30 s;
  - never retried: other 4xx.
- **Response size:** ≤ 8 MiB.
- **Base URL:** https only (http only for loopback).

**Error classification** (`provider-errors-v1`):

| Category | Kinds |
|---|---|
| Network | `NETWORK_UNAVAILABLE`, `TIMEOUT`, `ABORTED` |
| Provider status | `PROVIDER_UNAVAILABLE` (5xx), `RATE_LIMITED` (429), `AUTH_FAILED` (401/403), `NOT_FOUND`, `BAD_REQUEST` |
| Response | `MALFORMED_RESPONSE` |
| Capability | `CAPABILITY_UNSUPPORTED`, `CAPABILITY_NOT_CONFIGURED` |
| Local guards | `MISCONFIGURED`, `REQUEST_BUDGET_EXHAUSTED` |
| Cross-source | `PROVIDER_CONFLICT` |

Messages are code-defined. They never contain URLs, headers, keys, refs or bodies, and response bodies of failed requests
are discarded.

**Guards and observability:**
- **`RequestBudget`:** consumed before every attempt, retries included. It fails closed and sends nothing at the ceiling.
  `HENRIK_MAX_LIVE_REQUESTS = 6`.
- **`RateLimiter`:**
  - sliding 60 s window and FIFO lanes;
  - `MAX_CONFIGURED_RPM = 6`, `MAX_CONCURRENCY = 2`;
  - configuration above either is `MISCONFIGURED`, never clamped.
- **`ProviderMetrics`:** per (provider, capability): requests, 2xx / 4xx / 5xx / 429, network errors, timeouts, retries, and
  total / max latency.
- **Safe logging:** `safeLogLine` keeps allowlisted fields only (provider, capability, attempt, status, class, latency,
  budget). Other values are redacted.

**Provider health** (`ProviderHealthTracker`):
- States: AVAILABLE / RATE_LIMITED / AUTH_FAILED / TEMPORARY_ERROR / CAPABILITY_UNAVAILABLE / MISCONFIGURED.
- It is updated by the router.
- Request-level outcomes (not found, malformed, conflict) do not change health.

## Routing (`ProviderRouter`)

**Selection is deterministic:**
- explicit `routes[capability]`, else registration order filtered by declared support;
- duplicate provider ids and unknown route entries are `MISCONFIGURED`;
- `providerId` pins one provider with no fallback.

**Fallback.** Allowed only on `NETWORK_UNAVAILABLE`, `TIMEOUT`, `PROVIDER_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED` or
`CAPABILITY_NOT_CONFIGURED`. Never on:
- `PROVIDER_CONFLICT`, `RATE_LIMITED`, `AUTH_FAILED`;
- `NOT_FOUND`, `BAD_REQUEST`, `MALFORMED_RESPONSE`;
- `REQUEST_BUDGET_EXHAUSTED`, `MISCONFIGURED`.

**Record namespaces.** Account and match refs are provider-scoped, so ref-bearing operations (history, detail, rank) fall
back only inside one record namespace. For example, a Henrik live outage can fall back to a henrik-v4 archive, never to
another provider's ids.

**One result, never merged.** The router returns exactly one provider's result, `servedBy`, and the attempt list.

## Provenance (`ingestion-provenance-v1`)

There is no canonical schema change: `provenanceOf(match)` maps the existing `source` block. `publicProvenance` drops the
private ref.

| Field | Source | Henrik live | Import archive | Legacy import |
|---|---|---|---|---|
| providerId | `source.providerId` | henrik | henrik | henrik |
| providerVersion | `source.providerVersion` | henrik-v4 | henrik-v4 | henrik-v4 |
| adapterVersion | `source.acquisitionSource` | henrik-adapter-v1 | import-file-adapter-v1:henrik-v4-match | legacy-rebuild-staging:rebuild-staging-v1 |
| normalizerVersion | `source.normalizerVersion` | henrik-v4-normalizer-v1 | henrik-v4-match-archive-v1 | legacy-henrik-v4-import-v1 |
| acquisition | `source.acquisition` | provider-adapter | provider-adapter | legacy-import |
| observedAt | `source.observedAt` | fetch time | caller time | staging fetch time |
| providerEvidenceRef | `source.providerRecordRef` | PRIVATE | PRIVATE | PRIVATE |

- **Rank rows:** carry `providerId`, a `sourceEndpoint` code label (e.g. `henrik:v3:mmr:current`) and `tierModelVersion`.
- **STATIC_CONTENT:** never shares a match `source` block. Catalogs carry their own catalog versions
  (e.g. `agent-catalog-v1`).
- **Public output:** never exposes raw provider ids (public contracts have no field for them; the privacy guard rejects
  `providerAccountRef` / `puuid` keys).

## Logical-match identity (`logical-match-identity-v1`)

| Relation | Evidence | Effect |
|---|---|---|
| `SAME_RECORD` | Same namespace and record ref, therefore the same derived `matchKey` | One record; facts compared |
| `EXACT_LINKED` | An explicit recorded `CrossProviderLink`, evidenced by a provider-documented id equivalence or operator verification | Grouped (evidence never combined); facts compared |
| `CANDIDATE` | Same map and mode, start within 120 s, same participant count | Review hint only, **never merged** |
| `DISTINCT` | Anything else | Separate |

**Fact comparison:**
- **Compared:** map id, mode, start second, participant count, team scores, and round / kill counts when both are
  observed.
- **On a difference:** `PROVIDER_CONFLICT`, carrying field names only. There is no winner, no merge and no fallback.

**What is never assumed:**
- A Henrik match id is never assumed to be a Riot match id.
- An Overwolf `pseudo_match_id` equals nothing.
- No link is created automatically.
- Map plus approximate time never merges.

## Architecture gate

`PROVIDER_TYPES_OUTSIDE_ADAPTERS` (in `npm run check:architecture`) counts two things outside `packages/source-adapters`:
- imports of `@vsa/source-adapters/{henrik,riot,overwolf,import}`;
- provider endpoint literals.

The single exception is the one-way legacy importer, which uses `@vsa/source-adapters/henrik` for the shared normalizer.
The package root exports only provider-neutral code (plus the existing synthetic fake). The analytics, web and control
rules are unchanged.

## Verification (V2-PROVIDER-WAVE-01)

**Offline:**
- **Fixture contract tests** (`tests/providerWave.test.ts`, audited v4 shape from `tests/legacyFixture.ts`):
  - every error class;
  - retry, budget and limiter bounds;
  - logging, routing, import, identity and provenance;
  - ingestion into a temporary store.
- **Normalizer-move proof** (read-only, 0 requests): 838/838 staged payloads give byte-identical output from the moved
  normalizer and the pre-move `HEAD` file, and 838/838 equal the stored V2 canonical matches (order-insensitive). The
  accepted fingerprint is unchanged.

**Live canary** (one authorized account; 4 requests: IDENTITY, MATCH_HISTORY size 1, MATCH_DETAIL, RANK; all 2xx; 0 retries):
- **Identity:** the resolved account ref equals the stored ref.
- **Canonical parity** with the accepted stored record of the same match, all PASS, including the full canonical document
  apart from `source`: map, mode, timestamp, participants, teams, rounds, kills, assists, plant / defuse, agent and
  evidence.
- **Rank:** 15 schema-valid rows; the current tier equals the stored current tier.
- **Temp store:** round-trip PASS in an in-memory PGlite, discarded afterwards.
- **Accepted 838-match dataset:** not modified; fingerprint unchanged before and after.
