# V2-DATA-IMPORT-01 — legacy evidence → V2 canonical store

Status: **COMPLETE / AWAITING SDD REVIEW** (2026-10-08, local only, not pushed).

- Import start head: `1afe9c8` (`checkpoint-v2-bootstrap-01`).
- Accepted legacy private local evidence was imported into a fresh local PostgreSQL 18 V2 database through an explicit,
  one-way import adapter (`apps/legacy-importer`).
- No provider, Riot, Neon or Vercel access took place. Every legacy source stayed read-only.
- Real data is never committed, published or exported. This document contains aggregates only: no names, provider
  ids, match ids or coordinates.

## 1. Source audit

**Source A: legacy private rebuild staging.**
- Local PostgreSQL 18 on 127.0.0.1, database `valorant_rebuild_staging`.
- It is opened read-only, with a session `default_transaction_read_only=on` that the importer verifies before any read.

| Schema / table | Version | Rows | Used |
|---|---|---|---|
| `rebuild_staging.meta` | `rebuild-staging-v1` | — | version check |
| `rebuild_staging.accounts` | | 9 | identity (community name, primary flag, provider account ref) |
| `rebuild_staging.matches` | | 838 | match ref, start time (index) |
| `rebuild_staging.match_payloads` | | 838 (v4 history 835, v4 detail 3) | the evidence (one Henrik v4 match document each, plus its SHA-256) |
| `rebuild_staging.account_matches` | | 1 717 | cross-check only |
| `rebuild_staging.cursors`, `provider_requests`, `runs` | | 18 / 689 / 8 | not imported (acquisition bookkeeping) |
| `rank_staging.meta` | `rank-staging-v1` | — | version check |
| `rank_staging.rank_evidence` | `valorant-tier-order-v1` | 1 991 | rank evidence |
| `rank_staging.ingestion_state` | | 27 | not imported |

**Payload content (all 838 documents):**
- 8 375 players, 2 562 teams, 14 052 rounds, 133 505 round-player rows.
- 117 005 kills with 36 631 assists, and 722 049 raw kill-time player snapshots.
- 7 532 plants (all with a site label) and 2 103 defuses.

**Fields:**
- **Identity:** player provider ids (account refs only).
- **Match:** id, map, queue, season, start, length.
- **Teams:** won, rounds won and lost.
- **Players:** team, agent id and name, stats (incl. damage, head / body / leg shots), ability casts, economy.
- **Rounds:** winner, `winning_team_role`, result, plant (site, location, planter, time) and defuse, plus per-player
  round stats and economy.
- **Kills:** round, round and match time, killer, victim, assistants, weapon, location and `player_locations` (nested
  `player.puuid`, location, `view_radians`).
- **Rank:** kind, effective time, provider tier, RR, RR change, provider elo, season, queue, and the normalized tier
  (tier key and ordinal).

**Missing or partial fields (preserved as missing, never fabricated):**
- Official Performance Score is absent.
- Custom-game team ids can be empty; result can be `''` (stored as null).
- `winning_team_role` can be `FreeForAll`, `None` or null, so side stays null.
- Deathmatch team ids are player ids, so the importer derives opaque team keys.

**Source B: other legacy local databases.**
- `valorant_local_rebuild` has 20 tables and 0 matches.
- The two production-migration targets have 0 tables.
- So `OVERLAPPING_MATCHES = 0`, `IDENTICAL = 0`, `CONFLICTING = 0`.
- **Not read:** Neon, the backup dumps, and the legacy checkout's own data.

## 2. Match-set baseline

| Measure | Value |
|---|---|
| SOURCE_MATCH_ROWS | 838 |
| UNIQUE | 838 |
| DUPLICATES | 0 |
| EARLIEST | 2024-01-13T12:30:58Z |
| LATEST | 2026-10-06T14:33:46Z |

- Every match has its payload.
- Every payload's internal id equals its staging key; a mismatch would stop the import.

**Modes (preserved; analytics filters separately):**

| Mode | Matches |
|---|---|
| competitive | 345 |
| unrated | 203 |
| swiftplay | 124 |
| deathmatch | 76 |
| custom | 46 |
| other (Gauntlet: Glitched 21, Summit 2, skirmish 2v2 1) | 24 |
| team-deathmatch | 18 |
| escalation | 1 |
| spike-rush | 1 |

The raw queue id and name stay on the match.

## 3. Identity and consent

**Members and accounts:**
- 9 members, each with 1 primary account (multi-account members in the source: 0).
- Multi-account import, with exactly one primary account, is covered by tests.
- V2 ids are `member-<16 hex>` and `account-<16 hex>`. They are derived by SHA-256 from a V2 namespace plus the legacy
  *public* ids, never from a provider id.
- Provider account refs live only in `source_accounts` (`providerId = henrik`).
- Display names are the approved community names (sanitized; Riot `Name#Tag` is never stored as a name).

**Consent:**
- `CONSENT_INFERRED_FROM_EVIDENCE = NO`. Every imported member gets `status = requires-reconciliation`,
  `source = legacy-import`, and all four grants false.
- Schema refinement and a database CHECK make an unreconciled consent grant nothing.
- An existing explicit consent is never downgraded.
- **Result:** the exporter withholds all 9 members.
- `CANONICAL_CONSENT_RECONCILED = NO`, `CANONICAL_HISTORY_RECONCILED = NO`.

## 4. Normalization (`legacy-henrik-v4-import-v1`)

**Port and provenance:**
- A port of the accepted legacy rules: `normalizeHenrikEvidence`, the nested `player_locations` contract,
  explicit-evidence side, season and mode.
- Every match records `source.acquisition = legacy-import`, the acquisition source (`legacy-rebuild-staging:rebuild-staging-v1`),
  the normalizer version and the payload SHA-256 in `import_state`.
- `historyCompleteness = provider-visible`; `LIFETIME_COMPLETE = NO`.

**Rules:**
- **Agents:** stable content id first. `7c8a4701-…` (Miks) is **Controller**: 321 participations, 109 of them tracked.
  The provider placeholder `773f0c78-…` ("Unknown") is kept as raw id and resolves **UNKNOWN**: 336 participations,
  29 tracked, 0 tracked Competitive. 3 kill-only participants have no agent. Unknown never falls back to a role.
- **Teams:** short labels are kept lowercased (`blue`, `red`, `team_3`). Any uuid-shaped or unusual team id (deathmatch
  player ids) becomes a match-scoped `tm_<12 hex>` key; it is never truncated.
- **Side:** from `winning_team_role`, the planter or the defuser only. It is never derived from the winner alone or from
  half rules. Conflicts: 0.
- **Kills:** a kill that references a round absent from its payload makes the match's kill evidence `unavailable`
  (accepted legacy rule). The kill is not stored. Affected: 54 kills in 22 matches, all non-Competitive.
- **Snapshots:**
  - First occurrence per participant per kill wins.
  - Non-roster and invalid rows are dropped and counted (0 in real data).
  - Coordinates and view are raw provider values (`PROVIDER_RAW_UNKNOWN` space).
- **Economy:** a negative credit value is out of domain; it occurred only in Custom Game (17 player rows). It is withheld
  as null, the economy block is marked `unavailable`, and the value is counted (34 values). It is never clamped.
- **Kill-only participants:** players referenced by kills but missing from the roster become stat-less participants
  (3), never zero-filled.
- **Not imported as truth:** Community Score, Current Strength, Shared-Match scores and Team Composition outputs.
  Only evidence is imported.

## 5. Rank evidence

| Kind | Rows | Match-time context? |
|---|---|---|
| match-snapshot (in-match pre-match tier) | 1 717 | yes: the exact match |
| history (with `providerElo`) | 187 (180 linked to a staged match, 7 unlinked → `matchKey = null`) | yes: strictly earlier rows only |
| current / peak / seasonal | 9 / 9 / 69 (effective at ingestion, 2026-10-07) | **never** |

- `providerElo` keeps the provider meaning: (tier − 3) × 100 + RR. It is **not MMR**.
- A history row records the outcome of its own match, and its effective time can precede that match's start by ≈ 1 s.
  The as-of-match lookup therefore excludes the row of the same match explicitly.
- **Real data:** every one of the 1 717 tracked participations resolves to its own match snapshot.
- `FUTURE_RANK_LEAKAGE = 0`. Chronological tests cover snapshot, own-history exclusion, prior history and
  current / peak exclusion.

## 6. Count reconciliation (source → canonical)

| Entity | Source | Canonical | Difference explained |
|---|---|---|---|
| matches | 838 | 838 | — |
| teams | 2 562 | 2 562 | — |
| participants | 8 375 players | 8 378 | +3 kill-only participants (stat-less) |
| participants with observed stats | 8 375 | 8 375 | — |
| rounds | 14 052 | 14 052 | — |
| round participants | 133 505 | 133 505 | — |
| plants / with site | 7 532 / 7 532 | 7 532 / 7 532 | — |
| defuses | 2 103 | 2 103 | — |
| kill events | 117 005 | 116 951 | −54 kills in rounds absent from their payload (SOURCE_GAP; 22 matches) |
| assists (on stored kills) | 36 631 | 36 621 | −10 assists on those 54 kills |
| kill-time player snapshots | 722 049 | 721 914 | −135 on those 54 kills; 0 duplicate / non-roster / invalid. 721 914 equals the accepted legacy figure |
| rank evidence | 1 991 | 1 991 | — (7 history rows without a staged match keep `matchKey = null`) |
| members / accounts / consent | 9 / 9 / 9 | 9 / 9 / 9 | — |

**Source unchanged** (`LEGACY_SOURCE_MODIFIED = NO`):
- Content fingerprints of accounts, matches, payloads, account_matches and rank_evidence are identical before and after
  the import.
- The database write counter (`tup_inserted + tup_updated + tup_deleted`) is unchanged.
- The legacy checkout HEAD is unchanged and clean.

## 7. Idempotency, restart and determinism

**Mechanics:**
- **Atomic per match:** `saveMatch` writes the match, all children and its `import_state` row in one transaction.
- **Restartable:** `--resume` skips matches whose checkpoint has the same payload SHA-256 and normalizer version. A
  changed payload under a known checkpoint is a source conflict and stops the run.
- **`CANONICAL_DATASET_FINGERPRINT`** (`cdfp-v1`) is group-scoped. It covers members, accounts, consent, the full JSON
  of every match of the group's members (ordered by key) and their rank evidence. Import times and checkpoints are
  excluded. Another group in the same store never changes it (tested).

**Real-data runs:**

| Run | Result | Fingerprint |
|---|---|---|
| interrupted run (WSL VM stopped mid-run) → `--resume` | 111 resumed, 727 inserted, 0 conflicts | `cdfp-v1:318701e0…3ab9734` |
| fresh database, run 1 | 838 inserted | `cdfp-v1:318701e0…3ab9734` |
| run 2 | 0 inserted, 838 rewritten, 0 conflicts | identical |
| run 3 (after the fingerprint scoping fix) | 0 inserted | identical |
| `--resume` over a complete store | 838 resumed skips, 0 writes | identical |

- **Interrupted-run consistency:** 111 matches with 111 checkpoints, 0 orphans either way.
- **After the reruns:** every canonical count is unchanged. `NEW_MATCHES = 0`, `NEW_RANK = 0`, `NEW_MEMBERS = 0`, so
  `IMPORT_IDEMPOTENT = YES`.
- **PGlite parity:** the PostgreSQL 18 integration test imports the synthetic fixture and reproduces the PGlite
  fingerprint exactly.

## 8. Parity

**Basic stats** (`basic-player-stats-v1`, Competitive):
- V2 is compared with an independent SQL oracle over the raw payloads. Competitive there means
  `queue.id = 'competitive'`, which shares no code with either normalizer.
- 345 matches, 9 members, all of matches, rounds, wins, losses, kills, deaths, assists, K/D and ADR.
- **`BASIC_STATS_PARITY_VIOLATIONS = 0`.**

**Legacy basic parity:**
- The legacy `aggregatePlayerStats` ran over the legacy projection (`projectStagedMatch`, event-metrics-v2) in the clean
  legacy checkout, read-only.
- Legacy Competitive population: 345.
- Matches, rounds, wins, kills, deaths, assists and K/D are identical for all 9 members.
- ADR differs for all 9 members, by +0.05 to +0.86 (V2 higher).
- **Classification: EXPECTED** (a definition difference, not a defect).
  - Legacy computes each match's ADR as damage ÷ *recorded* rounds, then weights it by *score* rounds.
  - V2 uses score rounds for both.
  - They differ only in matches that record more rounds than their score: 6 of 345 Competitive matches (21 rounds,
    16 member-matches).
  - An independent SQL reproduction of both formulas matches legacy and V2 to 9 decimals for every member.
- BUG = 0, SOURCE_GAP = 0 for basic parity.

## 9. Readiness of the imported inputs (no metric computed here)

| Consumer | Input check | Result |
|---|---|---|
| event-metrics-v2 (KAST / Opening / Trade / Clutch / Impact) | rounds and kills observed; every kill actor / target is a match participant; timing present; round winners present; plants and defuses with planter / defuser and time | Competitive 345 / 345 ready; all modes 816 / 838 (22 = unknown-round kills); 0 unresolved event participants; 0 events without match time → **EVENT_METRICS_V2_INPUT_READY = YES** |
| shared-match-rating-v1 | same-team pairs of tracked members with observed stats, Competitive + Unrated | 1 341 units, 36 / 36 pairs, minimum 14 per pair, 333 matches. Equal to the accepted legacy evidence → **SHARED_MATCH_V1_INPUT_READY = YES** |
| team-composition-v1 | tracked Competitive participations with a known agent role | 841 / 841 (unknown 0); side evidence on 6 325 / 7 298 Competitive rounds → **TEAM_COMPOSITION_INPUT_READY = YES** |

`AGENT_ROLES_CATALOG_V0` (frozen for shared-match-evidence-v1) is ported together with shared-match-rating-v1, not here.

## 10. Positions and privacy

**Storage and erasure:**
- Private canonical evidence: 721 914 snapshots on all 838 matches, 116 951 kill locations and 7 532 plant locations.
- `erasePositionTelemetryForMember(memberId)` deletes the member's snapshots. It also clears event locations where the
  member is actor or target, and plant / defuse locations where the member planted or defused.
- Erasure is idempotent and keeps all non-spatial evidence; it is tested on PGlite and PostgreSQL 18.
- `RAW_COORDINATES_PUBLIC = NO`.

**Private real-data snapshot dry-run:**
- Built with the normal exporter into a temporary private directory, then deleted. It was never recorded as a
  publication.
- The scanner found 0 findings. A deep scan found 0 uuid-shaped values, 0 coordinate keys, 0 Riot handles and 0 internal
  ids.
- `PUBLIC_MEMBERS_ELIGIBLE = 0`, `WITHHELD = 9`. **`REAL_SNAPSHOT_PRIVACY = PASS`.**
- The checked-in demo snapshot stays synthetic.

**Safe logs:**
- The importer logger is allowlist-only. Field names must be code identifiers; values must be short labels, versions,
  instants, numbers or community names.
- Ids, URLs, handles and long tokens become `[redacted]`.
- Validation failures report issue paths and codes only, never input values.

## 11. Performance (Windows host → WSL Docker PostgreSQL 18.6, localhost)

| Measure | Value |
|---|---|
| dry run (normalize + validate 838 matches, no writes) | 6.0 s |
| full import into an empty database | 105.6 s (wall 109.5 s) |
| full re-run (838 rewrites) | 107.9 s / 116.0 s |
| `--resume` over a complete store | 7.6 s wall |
| database size after import (compacted) | 230.3 MB |
| position snapshots table (compacted) | 140.4 MB |

## 12. How to run

```bash
npm run import:legacy -- --dry-run
```

```bash
npm run import:legacy -- --resume
```

**Configuration:**
- `LEGACY_SOURCE_URL` (or `--source-url`) must name a `valorant_rebuild_staging*` database. It is opened read-only.
- `DATABASE_URL` (or `--database-url`) must name a `valorant_analytics_v2*` database, different from the source.
  Migrations are applied to the target only.
- Connection strings are never printed.
- The V2 target used here is a dedicated local container (`postgres:18-bookworm`, 127.0.0.1:55920, no published
  non-local port). Its password is generated into a mode-600 file outside the repository.

## 13. Architecture

- `apps/legacy-importer` may depend on canonical-data, analytics, contracts and source-adapters (key derivation).
- **No workspace may import `@vsa/legacy-importer`**: rule `LEGACY_IMPORTER_IN_CORE_IMPORTS`, count 0.
- `WEB_DB_IMPORTS = WEB_PROVIDER_IMPORTS = ANALYTICS_PROVIDER_SPECIFIC_IMPORTS = CONTROL_PLANE_CANONICAL_TELEMETRY_IMPORTS = 0`.

## 14. Known limitations

- History is provider-visible only; it is not lifetime-complete.
- Consent and history reconciliation are separate future tasks.
- Rank `current` / `peak` / `seasonal` are ingestion-time facts.
- Metrics (event-metrics-v2, shared-match-rating-v1, team composition) are not computed in this task.
