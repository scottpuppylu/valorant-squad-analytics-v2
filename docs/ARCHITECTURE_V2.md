# Architecture V2

## Planes

| Plane | Components | Owns | Never does |
|---|---|---|---|
| **Data** | source adapters → collector ingest → `@vsa/canonical-data` (local PostgreSQL 18) | Canonical evidence, provenance, consent and ingest state | Publish anything; run in a browser |
| **Analytics** | `@vsa/analytics` | Accepted algorithms over canonical contracts (pure functions) | SQL, provider payload types, I/O |
| **Publication** | `@vsa/exporter` → `@vsa/privacy` → `@vsa/distribution` | Allowlisted public documents; immutable snapshots; manifest activation | Serialize database rows; emit private fields |
| **Web** | `apps/web` | Rendering `manifest.json` + snapshot files | Database, provider or server API calls |
| **Control (future)** | `apps/control-api` | Group / member / invite / consent / sync-job **metadata** | Store rounds, events, positions or analytics evidence |

## Provider abstraction

- `DataProviderAdapter` (`providerId`, `providerVersion`, `capabilities()`, plus optional `resolveAccount`,
  `listMatches`, `getMatch`, `getRankContext`) returns **canonical** contracts only.
- Each adapter declares what it actually supports: IDENTITY, MATCH_HISTORY, MATCH_DETAIL, RANK, FORWARD_EVENTS or
  STATIC_CONTENT. `requireCapability` fails with a typed error otherwise.
- `ProviderRouter` orders primary → fallback providers. It falls back only on `ProviderUnavailableError` and never
  merges evidence from several providers; each match keeps its own `source` provenance.
- Implemented: `FakeProviderAdapter` (deterministic synthetic fixtures; its own payload shape is converted by its
  normalizer).
- Skeletons only: `HenrikAdapter`, `RiotAdapter`, `OverwolfAdapter`. They declare no capabilities and have no network
  code or keys.

## Canonical model (`canonical-schema-v1`)

- **`CanonicalMatch`** carries:
  - a provider-neutral derived `matchKey` (`cm_…`);
  - `source`: provider, adapter version, normalizer version, private provider record ref and observed time;
  - `evidence`: `historyCompleteness` (`unknown` | `provider-visible`), quality, and has-rounds / events / damage flags;
  - map, mode, start, duration, teams, participants, rounds, kill events and rank-context references.
- **Identity.** A participant carries an internal `memberId` and `accountId` (or null if untracked). Provider account
  refs live only in `source_accounts`. Public ids are derived (`m_…`, `g_…`), never a PUUID.
- **Spatial evidence.** Event `spatial` (locationX/Y, viewRadians) is **private canonical evidence** and has no public
  representation.
- **Consent.** Consent is four independent grants: identity connected, data collection, group visibility and public
  derived analytics.

## Versions

- Contracts: `canonical-schema-v1`, `analytics-contract-v1`, `public-snapshot-v1`, `manifest-v1`.
- Adapter versions are independent (e.g. `fake-provider-v1`, `fake-normalizer-v1`).
- Algorithms keep their identities. Bootstrap: `basic-player-stats-v1`. Future ports keep `event-metrics-v2`,
  `shared-match-rating-v1`, `team-composition-v1/-v2`.

## Storage

- Fresh V2 migrations start at `0001` (`packages/canonical-data/migrations`).
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
