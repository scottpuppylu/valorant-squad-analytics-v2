# Architecture V2

## Planes

| Plane | Components | Owns | Never does |
|---|---|---|---|
| **Data** | source adapters → collector ingest → `@vsa/canonical-data` (local PostgreSQL 18) | Canonical evidence, provenance, consent and ingest state | Publish anything; run in a browser |
| **Analytics** | `@vsa/analytics` | Accepted algorithms over canonical contracts (pure functions) | SQL, provider payload types, I/O |
| **Publication** | `@vsa/exporter` → `@vsa/privacy` → `@vsa/distribution` | Allowlisted public documents; immutable snapshots; manifest activation | Serialize database rows; emit private fields |
| **Web** | `apps/web` | Rendering `manifest.json` + snapshot files | Database, provider or server API calls |
| **Control** (`control-plane-v1`, local only) | `apps/control-api` | Users, groups, memberships, invites, identity connections, consent, sync-job / lease metadata, revocation outbox, audit ([CONTROL_PLANE_DESIGN.md](CONTROL_PLANE_DESIGN.md)) | Store rounds, events, positions or analytics evidence; call providers; accept inbound connections to the home machine |
| **Legacy import (one-way)** | `apps/legacy-importer` | Read-only legacy staging → explicit normalization → canonical store | Be imported by any other workspace; write to a legacy source; infer consent |

## Provider abstraction

- `DataProviderAdapter` (`providerId`, `providerVersion`, optional `recordNamespace`, `capabilities()`, plus optional
  `resolveAccount`, `listMatches`, `getMatch`, `getRankContext`) returns **canonical** contracts only.
- Capabilities (`provider-capabilities-v1`): IDENTITY, MATCH_HISTORY, MATCH_DETAIL, RANK, FORWARD_LIVE (formerly
  FORWARD_EVENTS), STATIC_CONTENT. `requireCapability` fails with a typed error otherwise.
- `ProviderRouter` (`provider-router-v1`):
  - deterministic capability routing;
  - fallback only on network / temporary unavailability or an unsupported capability, inside one record namespace;
  - never on PROVIDER_CONFLICT;
  - never merges.
- **Implemented:**
  - `HenrikAdapter`: documented endpoints, bounded transport, limiter ≤ 6 RPM / ≤ 2 lanes, request budget;
  - `ImportFileAdapter`: `vsa-match-archive-v1`;
  - `FakeProviderAdapter`: synthetic.
- **Contract or design only:** `RiotAdapter` (no capability, no request) and `OverwolfAdapter` (FORWARD_LIVE declaration).
- Provider-specific code lives behind `@vsa/source-adapters/{henrik,riot,overwolf,import}`, enforced by
  `PROVIDER_TYPES_OUTSIDE_ADAPTERS`. See [PROVIDER_ARCHITECTURE.md](PROVIDER_ARCHITECTURE.md) and
  [PROVIDER_MATRIX.md](PROVIDER_MATRIX.md).

## Canonical model (`canonical-schema-v2`)

- **`CanonicalMatch`** carries:
  - a provider-neutral derived `matchKey` (`cm_…`);
  - `source`: provider, adapter version, normalizer version, private provider record ref, observed time, and
    `acquisition` (`provider-adapter` | `legacy-import`) with its `acquisitionSource`;
  - `evidence`: `historyCompleteness` (`unknown` | `provider-visible`), quality, rounds / kills evidence status
    (`observed` | `missing` | `unavailable`), damage and position flags;
  - map, mode (every mode is preserved), queue, season, start, duration, teams, participants, rounds, kill events.
- **Participants** carry stats with an evidence status (never zero-filled), ability casts and economy. **Rounds** carry
  winner, result, side (only from explicit evidence), plant (status, planter, time, site) and defuse, plus per-round
  participant economy, weapon and armor. **Kill events** carry sequence, round / match time, actor, target, assistants
  and weapon.
- **Identity.** A participant carries an internal `memberId` and `accountId` (or null if untracked). Provider account
  refs live only in `source_accounts`; one account per member is primary. Public ids are derived (`m_…`, `g_…`), never
  a PUUID.
- **Spatial evidence.** Event / plant / defuse locations and per-event `playerSnapshots` (location, view) are
  **private canonical evidence**, erasable per member (`erasePositionTelemetryForMember`), with no public
  representation.
- **Consent.** Four independent grants (identity connected, data collection, group visibility, public derived
  analytics) plus a `status`: `explicit` or `requires-reconciliation`. An unreconciled consent grants nothing (schema and
  database CHECK).
- **Rank context.** Kinds `match-snapshot`, `history`, `current`, `peak`, `seasonal`, with provider tier, RR and
  `providerElo` (provider semantics, never MMR). As-of-match lookup: the match's own snapshot, else the latest strictly
  earlier history row of another match; current / peak / seasonal are never match-time context.

## Versions

- Contracts: `canonical-schema-v2`, `control-contract-v2` (+ additive `control-plane-v1`), `analytics-contract-v1`, `product-contract-v1`, `public-snapshot-v2`, `manifest-v1`.
- Adapter versions are independent (e.g. `fake-provider-v2`, `fake-normalizer-v3`, `henrik-adapter-v1`, `henrik-v4-normalizer-v1`,
  `legacy-henrik-v4-import-v1`, `import-file-adapter-v1`).
- Algorithms keep their identities. V2-PRODUCT-UI-WAVE-01 ported the accepted ones (`event-metrics-v1/-v2`,
  `community-score-v2`, `adaptive-window-v1`, `shared-match-rating-v1`, `team-composition-v1` (emitted as `team-composition-v1.1`, docs/TEAM_COMPOSITION_TIES.md) / `-v2`, `rank-context-v1`,
  `agent-catalog-v1`) into `packages/analytics` (basic/, agents/, event/, rank/, strength/, shared-match/,
  team-composition/, product/). See docs/V2_PRODUCT_UI.md and docs/SCORING.md.

## Storage

- Fresh V2 migrations start at `0001` (`packages/canonical-data/migrations`); `0002` = canonical-schema-v2.
- Driver: `pg` for PostgreSQL 18, or PGlite (embedded, for tests and the zero-setup demo) behind one `SqlClient`
  interface.
- `DATABASE_URL` configures local PostgreSQL only; no cloud database exists or is needed.
- Verified on PostgreSQL 18.6: the same snapshot id as PGlite.

## Privacy boundary

- **Compile time.** Public contracts have no field for private data.
- **Runtime.** The `@vsa/privacy` allowlist serializer denies unknown fields and rejects private key names (any depth)
  and secret-shaped values. Strict schemas run as a second gate.
- **Re-validation.** The publisher re-validates every file and the content-derived id. The web loader re-checks hashes
  (when Web Crypto is available) and documents.
- **Gates.** `check:privacy` scans the public data and the built bundle. `check:architecture` enforces the import
  boundaries.

## Failure isolation

| Failure | Effect on the published site |
|---|---|
| Provider outage | None: the site reads static snapshots; ingest simply has nothing new |
| Local PostgreSQL down | None for already published snapshots |
| Analytics / export failure | No new snapshot; the active manifest is untouched |
| Publish crash (any step) | The manifest is replaced only by an atomic rename after the snapshot is complete (tested with injected crashes) |
| Corrupt active manifest | The next valid publication repairs it (reported as `replacedInvalidManifest`) |
| Control-plane outage | None: it carries metadata only; static analytics keep serving |

There is no inbound access to the home machine. The collector only makes outbound calls (providers, a future
control-plane poll, a future publisher). See [CONTROL_PLANE_DESIGN.md](CONTROL_PLANE_DESIGN.md),
[PUBLICATION_MODEL.md](PUBLICATION_MODEL.md) and [DATA_SOURCE_STRATEGY.md](DATA_SOURCE_STRATEGY.md).
