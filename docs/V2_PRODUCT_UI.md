# V2-PRODUCT-UI-WAVE-01 — accepted analytics ported, product contracts, first product UI

Status: **COMPLETE / AWAITING SDD REVIEW** (2026-10-08). Local only: not pushed, not deployed.

- Start head: `efc58c3` (`checkpoint-v2-data-import-01`).
- Scope: PORT + CONSOLIDATE + INTEGRATE + PRESENT. No algorithm was redesigned.
- Real data was used only for private local parity and an operator report. No public snapshot contains real members.
- This document holds aggregates only.

## 1. What was ported (frozen legacy → `packages/analytics`)

**Port method.**
- Every algorithm body was transcribed mechanically, with a provenance line naming its legacy file.
- Only import headers changed, plus the adaptations listed below. Nothing else was edited by hand.
- The internal per-match view (`match-view-v1`, `event/matchViewTypes.ts`) mirrors the accepted legacy
  `MatchRecord` / `MatchPerformance` shape field for field, so the ported bodies stay unchanged.
- `playerId` is the internal V2 member id, `id` is the canonical match key, and `gameMode` keeps the accepted labels.

| Layout | Accepted algorithm (id unchanged) | Legacy source |
|---|---|---|
| `event/` | `event-metrics-v1` (rollback / frozen for Shared-Match), `event-metrics-v2`, `round-topology-v1`, advanced-metric aggregation, `match-view-v1` projection | `server/metrics/*`, `src/analytics/advancedMetrics.ts`, `server/dataset/matchAssembly.ts` (projection half), `server/sharedMatch/stagingMatches.ts` (topology half) |
| `agents/` | `agent-catalog-v1` + frozen `AGENT_ROLES_CATALOG_V0` | `src/utils/agentRoles.ts` |
| `rank/` | `valorant-tier-order-v1`, `rank-context-v1` | `src/analytics/rank/*` |
| `strength/` | `community-score-v2` / `community-benchmarks-v1` / `overall-profile-v1`, `adaptive-window-v1`, `feature-scope-policy-v3`, `mode-eligibility-policy-v1`, Current Strength, Recent Form | `src/scoring/*`, `src/analytics/scope/*`, `src/analytics/modeEligibility.ts`, `analysis.ts` (`analyticsFromEntries`, `recentFormFromWindow`) |
| `shared-match/` | `shared-match-evidence-v1`, `shared-match-rating-v1`, direct coverage | `src/analytics/sharedMatch/{pairEvidence,rating,coverage}.ts`, `candidates.ts` (the pooled SD only) |
| `team-composition/` | `team-observation-v1`, `team-fit-hierarchy-v1`, `team-responsibility-v1`, `team-composition-v1`, `site-reference-v1`, `side-evidence-v1`, `team-composition-v2` | `src/analytics/teamComposition/*` |
| `product/` | `product-builder-v1`: read models only (no formula) | new |

**Adaptations (all documented in the file headers).**
- **Normalization gate.** The engine's "accepted normalization" gate is `EVENT_INPUT_NORMALIZATION_VERSION`
  (`canonical-schema-v2`). It replaces legacy `durable-evidence-v2`.
- **Parameter properties expanded.** TypeScript `erasableSyntaxOnly` forbids parameter properties, so they are written
  out in `EventMetricEngine`, `TeamCompositionModel` and `SiteReference`.
- **`TIE_EPSILON = 1e-9`** in `recommend.ts`:
  - Legacy sums the five picks in member-id order. V2 ids sort differently.
  - Mathematically equal confidences or scores can therefore differ in the last bits.
  - Values within 1e-9 are treated as equal, so the accepted tie-break (confidence → score → agent key) decides.
  - No value or threshold changed.
- **Pair synergy.** `duo-synergy-v1` (pair synergy) is not ported in this wave. Team Composition scores none of it, so
  assignment, Team Fit and confidence are unaffected. `pairSynergy` is reported as "no evidence".
- **Not ported (research only, legacy):**
  - candidate audits;
  - holdout tooling;
  - the internal-strength candidates (`community-internal-strength-v1` stays not implemented);
  - `weapon-analytics-v2`.

## 2. Real-data parity (private, PostgreSQL 18, V2 canonical store vs frozen legacy)

**Method.**
- **Legacy oracle.** It ran read-only in the clean legacy checkout `1a4c7906`, over the private staging DB (session
  `default_transaction_read_only=on`). It used the accepted pipelines of the legacy audit scripts:
  - `event-metrics-rollout.ts`;
  - `team-composition.ts`;
  - the shared-match ratings.
- **V2 harness.** It ran the ported code over the imported V2 store.
- **Matching.** Records are matched by V2 match key and community name. No raw ids left either side.
- **Tolerance.** Floats are compared with relative tolerance 1e-9.
- **Checkout untouched.** HEAD and clean state are identical before and after the oracle run.

| Check | Result |
|---|---|
| Matches / Competitive | 838 / 345 (both sides) |
| Event records (tracked member-matches) | 1 717 per engine; Competitive 841 |
| `event-metrics-v1` Competitive fingerprint | V2 `evfp-v1:bfb496b99b8eeba6` = legacy `evfp-v1:bfb496b99b8eeba6` |
| `event-metrics-v2` Competitive fingerprint | V2 `evfp-v1:2e22a2e7bb023834` = legacy `evfp-v1:2e22a2e7bb023834` |
| KAST reconstructed (Competitive member-matches) | v1 42, v2 841 (the accepted robustness gain) |
| Non-Competitive event differences | 67 per engine, all EXPECTED (below) |
| Community Score / Current Strength / Recent Form | 0 differences, 9 / 9 members, every dimension, status, value, confidence and window |
| Shared-Match v1 | 0 differences: 1 341 pair units, 1 069 scorable, 36 / 36 pairs (min 14), σ 35.23, every member rating (combined / Competitive / Unrated / recent) and every pair aggregate |
| Team Composition V1 + V2 | 378 runs (all 126 five-member sets × 3 maps: the two most and the least played). 375 exact. 3 EXPECTED_FLOAT_TIE. 0 unexplained |
| Rank context | 1 717 / 1 717 tracked participations resolve to their own match snapshot; FUTURE_RANK_LEAKAGE = 0 |
| Agent catalog | Competitive 841 / 841 known |

**Classified differences.**
- **Deathmatch, `rounds` / `teamGroup` (39 records). EXPECTED.**
  - Legacy reads team rounds from the first tracked row in provider roster order, and orders raw team ids (player ids
    in free-for-all).
  - V2 has opaque team keys and canonical participant order.
  - Browse-only modes; no strength algorithm reads them.
- **Custom, economy (28 records). EXPECTED.**
  - V2-DATA-IMPORT-01 withholds negative (out-of-domain) credit values as unavailable. Legacy kept the raw negatives.
  - Browse-only mode.
- **Team Composition, one five-member set on 3 maps. EXPECTED_FLOAT_TIE**, classified automatically:
  - the set of lineups is identical, and every matched lineup's values are equal;
  - only lineups whose confidences differ by ≤ 1e-9 swapped order;
  - the V2 layer over the legacy-ordered V1 result reproduces legacy V2 exactly.
  - In legacy's own summation order, the two alternatives differed by ~2e-14 and were ordered by that noise. V2 treats
    them as tied and applies the accepted next key (higher fit score).

**Verdicts.**
- EVENT_METRICS_V2_PARITY = **PASS**
- SHARED_MATCH_V1_PARITY = **PASS**
- COMMUNITY_SCORE_PARITY = **PASS**
- CURRENT_STRENGTH_PARITY = **PASS**
- TEAM_COMPOSITION_V1_PARITY = **PASS**
- TEAM_COMPOSITION_V2_PARITY = **PASS**

**Real-data availability** (unchanged accepted figures):
- Community Score 6 / 9.
- Current Strength 7 / 9.
- Recent Form 4 / 9.

## 3. Product contract (`product-contract-v1`, `packages/contracts/src/product.ts`)

**Shared metric shape.** Every product-visible analytic carries, where it applies:

```
version · status (available | partial | unavailable | insufficient) · value · confidence + confidenceModel · sampleSize · eligibility (eligible, reason codes) · evidenceSummary (codes) · explanationKey
```

**Confidence models.**
- Exact accepted semantics: `sample-coverage` (community-score), `adaptive-window`, `shared-match`, `team-fit`,
  `side-evidence`.
- `none` where a metric has no confidence model. The UI then shows the sample size only.
- No fake percentages.

**Reason codes.** Reasons are stable codes. The UI translates them; no algorithm text leaks.

**Public documents.**
- Public snapshot `public-snapshot-v2` adds three strict documents:
  - `profiles.json`;
  - `shared-match.json` (memberA / memberB, shared, ratingA / ratingB, relativeDifference, sample, confidence,
    eligibility);
  - `team-builder.json` (every 5-member set × map precomputed; the web only looks results up).
- `group.json` gains provider-visible coverage.
- The `@vsa/privacy` allowlist is extended field for field. A test proves it equals the schemas.
- No field can hold:
  - a PUUID or provider id;
  - a raw match id, canonical match key or internal id;
  - a coordinate or view direction;
  - a rank source row id.

**Responsibilities.**
- **Displayed:** V1 general labels only where the deciding rate reproduced in the TEAM-COMPOSITION-02 holdout
  (`PRIMARY_ENTRY`, `SECOND_ENTRY_TRADE`).
- **Withheld:** every other V1 label is flagged as withheld (not displayed).
- **V2 emits only:**
  - `ATTACK_PRIMARY_ENTRY`, `ATTACK_SECOND_ENTRY_TRADE`, `ATTACK_PLANT_SUPPORT`, `ATTACK_POST_PLANT`;
  - `DEFENSE_FIRST_CONTACT`, `DEFENSE_INFO_SUPPORT`.
- **Never published:** `INFO_SETUP`, `SPACE_CONTROL`, `UTILITY_SUPPORT`, `SITE_HOLD`, `CLUTCH`, `FLEX`,
  `ROTATION_SUPPORT`. SITE_TENDENCY_PUBLISHED = NO.
- **Abstention** (`insufficient_side_evidence` / `no_distinct_responsibility`) is an explicit, displayed result.

**Alternatives.** The accepted V1 recommender returns two alternatives. They are shown, with the V2 layer only on the
recommended lineup.

## 4. Privacy and consent

**Public population.**
- Only members with active membership AND group-visibility AND public-derived-analytics consent.
- A withheld member is an UNTRACKED participant for all public analytics: they never appear in a pair, profile or
  lineup, and their evidence cannot leak through group-relative results.
- `buildPublicSnapshot` refuses product analytics computed over any other population (`ExportPopulationError`).

**Real data.**
- 9 members, all `requires-reconciliation`.
- REAL_PUBLIC_SNAPSHOT_CREATED = NO. CONSENT_MODIFIED = NO.

**Operator view.**
- `npm run report:private -- --group <id>` with a local `DATABASE_URL`, opened READ ONLY.
- Writes a report (JSON + Markdown), not a snapshot. It is accepted only under the git-ignored `.private/`.
- It contains community names and aggregates only.
- It is scanned (internal ids, provider ids, match keys, coordinates, connection strings) before it is kept; a failed
  scan deletes it.
- The web app cannot request it.
- A browser operator mode was **not** built: it could not be made structurally impossible to enable or publish
  without new infrastructure. The report covers the inspection need.

**Demo snapshot.** It stays synthetic (`fake-fixture-v2`, 7 fictional members, one withholding public analytics).

## 5. UI (`apps/web`, static, hash routes)

| Route | Content |
|---|---|
| `#/` Dashboard | Group title, provider-visible coverage, ranking by Current Strength (accepted comparator; members below the window minimum listed separately), Community Score, recent form, sample, confidence, quick links |
| `#/players` | Player list |
| `#/players/:id` | Overview (Current Strength, Community Score, Recent Form), basic (matches, W/L, K/D, ADR, ACS, HS%), advanced (KAST, Opening, Trade, Clutch, Round Impact), eight dimensions, context (match-time rank, agents, roles, maps), Shared-Match, evidence notes |
| `#/compare?a=&b=` | Two distinct members: "each member's whole record" and "the same matches" shown as separate sections, never one more "true" |
| `#/synergy` | Shared-Match comparison only (no invented synergy formula): member ratings, pair table, eligibility |
| `#/team-builder` | Exactly five members (a sixth pick is ignored) + map → recommended lineup (agent, role, validated attack / defense responsibility or explicit abstention, confidence, samples), Team Fit with its meaning (not a win probability, not proof of optimality), alternatives |
| `#/about` | Data, provider-visible limitation, `lifetimeComplete = false`, metric meanings, confidence / sample, privacy, group scope |

**UI rules.**
- **No scoring in React.** Presentation models (`apps/web/src/viewModels.ts`) only select, order and look up.
- **History wording.** Every data page says 目前可追蹤紀錄. The UI never uses 完整生涯, 生涯總場次 or "lifetime
  complete".
- **States.** Every data page has loading / empty / invalid / unsupported / missing / privacy-failure /
  insufficient-evidence states.
- **Accessibility:**
  - one h1 per page;
  - labelled navigation and selectors;
  - a skip link;
  - text + shape status badges (never colour alone);
  - visible focus.
- **Responsive.** Under 640 px, data tables become labelled stacked rows. There is no horizontal scrolling at 375 /
  768 / 1280 px (measured in the browser).

## 6. Performance

| Measure | Value |
|---|---|
| Demo product analytics (6 public members, 30 Team Builder results) | ≈ 0.7 s |
| Real product analytics, operator report (9 members, 1 512 Team Builder results = 126 sets × 12 maps) | 22.6 s (load 4.6 s) |
| Team Composition model build (real) | 1.3–2.6 s |
| One recommendation (real, V1 + V2) | mean 7–13 ms |
| Team Builder in the browser | precomputed lookup (no calculation) |
| Demo snapshot (all six documents loaded at start) | 277 KB (`team-builder.json` 240 KB, `profiles.json` 19 KB, `shared-match.json` 12 KB) |
| Web bundle | JS 371.5 kB (112 kB gzip), CSS 10.6 kB |

A 9-member public Team Builder table would be ≈ 10 MB. When real data is published (future, after consent),
`team-builder.json` should be split per map. That is not done now: no real snapshot exists.
