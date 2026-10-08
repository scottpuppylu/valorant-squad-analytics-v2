# Legacy port audit

- **Source:** frozen legacy repository `valorant-squad-analytics`, release `release/pre-public-clean-01@1a4c790`.
- **Method:** read-only. Files were read through `git show 1a4c790:<path>`; the legacy worktree was never modified.
- **Evidence per file:** lines of code, imports and coupling markers (database driver, `process.env`, network,
  filesystem, Vercel/Neon, Henrik, cross-layer server imports, SQL).

## Classes

| Class | Meaning |
|---|---|
| PURE_REUSABLE | No I/O and no legacy-runtime imports; can be copied with only its contract adapted |
| REQUIRES_ADAPTATION | Accepted logic, but bound to legacy types or contracts; port onto canonical contracts |
| LEGACY_RUNTIME_COUPLED | Bound to the legacy DB schema, Vercel/Neon, `fs`/`git` runtime or legacy API contracts |
| RESEARCH_ONLY | Evaluation or holdout tooling that informed accepted decisions; not product runtime |
| DO_NOT_PORT | Superseded architecture or private tooling |

## Inventory

| # | Legacy path | Class | Why | Port plan |
|---|---|---|---|---|
| 1 | `src/utils/number.ts` (`safeDivide`) | PURE_REUSABLE | No imports | **Ported verbatim** → `packages/analytics/src/basic/number.ts` |
| 2 | `server/staticExport/renameWithRetry.ts` | PURE_REUSABLE | Only `node:fs` rename with bounded Windows retry | **Ported verbatim** → `packages/distribution/src/renameWithRetry.ts` |
| 3 | `server/metrics/roundTopology.ts` | PURE_REUSABLE | Only local types | **Ported** (V2-PRODUCT-UI-WAVE-01) → `packages/analytics/src/event/roundTopology.ts` |
| 4 | `src/analytics/rank/tiers.ts`, `rankContext.ts` | PURE_REUSABLE | No external imports | **Ported** (V2-PRODUCT-UI-WAVE-01) → `packages/analytics/src/rank/`; canonical adapter `rank/canonicalRank.ts`; rank stays context |
| 5 | `src/analytics/teamComposition/siteReference.ts` | PURE_REUSABLE | No imports | **Ported** (V2-PRODUCT-UI-WAVE-01) → `packages/analytics/src/team-composition/siteReference.ts` (private, raw space) |
| 6 | `src/utils/aggregateStats.ts` | REQUIRES_ADAPTATION | Accepted basic aggregation on legacy `MatchRecord` | **Formula ported** (K/D null at 0 deaths; ADR = Σ damage ÷ Σ team rounds) as `basic-player-stats-v1` on `CanonicalMatch`. Legacy divided by recorded rounds per match; differs in 6 of 345 Competitive matches (EXPECTED, see `docs/V2_DATA_IMPORT.md`) |
| 7 | `server/db/migrations.ts` | REQUIRES_ADAPTATION | Generic runner, legacy `SqlDatabase` type | **Ported and adapted** → `packages/canonical-data/src/migrations.ts` |
| 8 | `server/metrics/eventMetricEngine.ts`, `eventMetricsV2.ts` | REQUIRES_ADAPTATION | Accepted `event-metrics-v2`; inputs are legacy evidence types | **Ported** (V2-PRODUCT-UI-WAVE-01) → `packages/analytics/src/event/` + canonical projection `event/matchView.ts`; real Competitive fingerprints equal legacy (v1 and v2) |
| 9 | `src/analytics/analysisCore.ts` | REQUIRES_ADAPTATION | Shared analysis core, tied to legacy contracts and the scope engine | **Partly ported**: the adaptive window, policies and population (`strength/scope/`) power Current Strength / Recent Form; the multi-scope analysis core itself is not needed (the web reads precomputed snapshots) |
| 10 | `src/utils/agentRoles.ts` | REQUIRES_ADAPTATION | `agent-catalog-v1` data is pure; imports legacy types | **`agent-catalog-v1` ported** (V2-DATA-IMPORT-01) → `packages/analytics/src/agents/agentCatalog.ts`; id first, unknown fails closed. `AGENT_ROLES_CATALOG_V0` is ported later with shared-match-rating-v1 |
| 11 | `src/analytics/sharedMatch/rating.ts`, `pairEvidence.ts` | REQUIRES_ADAPTATION | `shared-match-rating-v1` depends on legacy scoring, catalog V0 and event-metrics-v1 | **Ported** (V2-PRODUCT-UI-WAVE-01) → `packages/analytics/src/shared-match/` with its frozen inputs (event-metrics-v1, catalog v0); real ratings equal legacy |
| 12 | `src/analytics/teamComposition/{recommend,fit,responsibility,v2,sideEvidence}.ts` | REQUIRES_ADAPTATION | `team-composition-v1/-v2` over legacy observation types | **Ported** (V2-PRODUCT-UI-WAVE-01) → `packages/analytics/src/team-composition/`; V1 + V2 parity on 378 real runs (3 documented float ties) |
| 13 | `src/analytics/weapons/weaponQuery.ts` (+ engine) | REQUIRES_ADAPTATION | Pure query over legacy facts | Not ported in this wave (weapon views are not part of the first product UI) |
| 14 | `src/scoring/calculateScores.ts` (community-score-v2) | REQUIRES_ADAPTATION | Accepted scoring; legacy types | **Ported** (V2-PRODUCT-UI-WAVE-01) → `packages/analytics/src/strength/scoring/` (+ Current Strength / Recent Form in `strength/strength.ts`); real parity 0 differences |
| 15 | `server/staticExport/publicAllowlist.ts` | REQUIRES_ADAPTATION | The allowlist concept is accepted; paths are legacy | **Concept re-implemented** as `@vsa/privacy` (explicit field-tree allowlist; nothing copied) |
| 16 | `server/staticExport/publisher.ts` | REQUIRES_ADAPTATION | Manifest-last publication concept | **Concept re-implemented** as `LocalFilesystemPublisher` (`manifest-v1`, content-derived ids; nothing copied except #2) |
| 17 | `server/normalizeHenrik.ts`, `server/evidence/positionEvidence.ts` | REQUIRES_ADAPTATION | Henrik-specific normalization (incl. the nested `player_locations` fix) | **Ported for import only** (V2-DATA-IMPORT-01) → `apps/legacy-importer/src/henrikV4.ts` (`legacy-henrik-v4-import-v1`). The live `HenrikAdapter` stays future; core packages never import the importer |
| 18 | `server/dataset/weaponAnalytics.ts` | LEGACY_RUNTIME_COUPLED | SQL plus legacy services | Do not copy; rebuild on the canonical read repository |
| 19 | `src/dataSources/static/StaticQueryEngine.ts` | LEGACY_RUNTIME_COUPLED | Imports server contracts and the legacy public-facts model | Not ported; the V2 web reads precomputed snapshots |
| 20 | `server/staticExport/exporter.ts` | LEGACY_RUNTIME_COUPLED | DB snapshot plus `fs`, legacy contracts | Replaced by `@vsa/exporter` |
| 21 | `server/staticExport/privacy.ts` | LEGACY_RUNTIME_COUPLED | SQL cross-check against the legacy schema | Replaced by `@vsa/privacy` (no DB coupling) |
| 22 | `server/staticPublish/gitDataRepositoryPublisher.ts` | LEGACY_RUNTIME_COUPLED | `child_process` git and `gh` credentials | Future `GitHubRepositoryPublisher` (placeholder only) |
| 23 | `server/db/runtime.ts`, `server/db/postgres.ts` | LEGACY_RUNTIME_COUPLED | Legacy env/pool wiring | Replaced by `packages/canonical-data/src/sql.ts` |
| 24 | `server/repositories/postgres.ts` | LEGACY_RUNTIME_COUPLED | Legacy schema, Henrik evidence and consent policy | Replaced by `PostgresCanonicalRepository` |
| 25 | Internal-strength candidates / holdout, shared-match v2 candidate audit, team-composition holdout / observations evaluation, `scripts/*` research tools | RESEARCH_ONLY | Produced the accepted decisions | Keep in legacy; re-run there if evidence must be reproduced |
| 26 | `api/**` (Vercel handlers), `vercel.json`, `scripts/migrate-vercel.ts`, `scripts/hydrate-analysis-facts-vercel.ts` | DO_NOT_PORT | Vercel database-backed runtime (retired direction) | — |
| 27 | `server/rebuildStaging/**`, `scripts/rebuild-collect.ts`, `scripts/bulk-history.ts` | DO_NOT_PORT | Private staging and acquisition tooling | — (data is imported read-only by `apps/legacy-importer`, V2-DATA-IMPORT-01) |
| 28 | Legacy migrations `0001`–`0012` | DO_NOT_PORT | Different schema; V2 starts a fresh `0001` | — |
| 29 | `infra/` (VPS compose, Caddy, backup scripts) | DO_NOT_PORT | Superseded topology | V2 `infra/local` only |
| 30 | Anything from commit `31d0210` (the vendored third-party Neon skill) | DO_NOT_PORT | Third-party tooling, not product code | — |

## Totals

| Class | Rows |
|---|---|
| PURE_REUSABLE | 5 (#1–#5) |
| REQUIRES_ADAPTATION | 12 (#6–#17) |
| LEGACY_RUNTIME_COUPLED | 7 (#18–#24) |
| RESEARCH_ONLY | 1 (#25, grouped) |
| DO_NOT_PORT | 5 (#26–#30) |

**Copied code in this bootstrap:**
- #1 `safeDivide`, verbatim;
- #2 `renameWithRetry`, verbatim;
- #7 the migration runner, adapted;
- #6 the basic-stats formula, re-expressed.

Each copied file names its legacy path and release. No other legacy code, no third-party bundled skill, and no data
(staged matches, Production data, rank staging, PUUIDs or member names) entered V2.
