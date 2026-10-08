# Scoring and metric formulas (V2)

Every formula below is an accepted legacy algorithm, ported unchanged (see `docs/V2_PRODUCT_UI.md`). Versions are the
algorithm identifiers.

**Common rules.**
- Rank is never an input to any score.
- No score is MMR, Elo or an official rank.
- Strength analytics use **Competitive only** (`mode-eligibility-policy-v1`). Unrated feeds only same-match Shared-Match
  comparisons. Other modes are browse-only.

## Basic statistics (`basic-player-stats-v1`)

- **K/D** = kills ÷ deaths. It is null when deaths = 0.
- **ADR (V2 semantics)** = Σ damage ÷ Σ **team score rounds** (the member team's rounds won + lost), over matches with
  damage evidence. There is one denominator throughout.
  - Legacy divided each match's damage by its RECORDED rounds, but weighted by score rounds. The two agree except when a
    match records more rounds than its score (6 of 345 real Competitive matches).
  - Those differences are accepted and expected (V2-DATA-IMPORT-01). V2 is **not** changed to match legacy.
- **Per-match ACS / ADR inside the event projection (`match-view-v1`)** = score / damage ÷ recorded rounds. This is the
  accepted per-match projection that community-score-v2 consumes. The Profile's ACS is its round-weighted mean.

## Event metrics (`event-metrics-v2`, `round-topology-v1`)

**Counting rules.**
- Only **opponent kills** count as kills, openings and trades.
- Self / environmental kills and team kills are deaths only.
- Life state is three-valued (alive / dead / unknown):
  - a later death proves a revive;
  - a kill by a recorded-dead player is posthumous or after an unrecorded revive (undecidable).
- An untrusted round (invalid reference, exact duplicate event, missing participants) fails closed.

**Metrics.**
- **KAST** — rounds with an opponent-kill, an assist on an opponent kill, survival, or a final death traded within 5 s,
  ÷ rounds. If survival is undecidable, KAST is partial (no value).
- **Opening** — the round's earliest opponent kill: first kill (killer) and first death (victim).
- **Trade** — the killer of a teammate is killed by the victim's team within 5 000 ms. Counts trade kills, traded deaths
  and trade assists.
- **Clutch** — the player is the certain last survivor of their team, with 1–5 opponents alive. A clutch is counted only
  when every interpretation consistent with the feed agrees; otherwise it is partial, never 0.
- **Impact context** — man-disadvantage kills, clutch-state kills, multi-kill rounds and round-won kills. Alive-count
  parts follow the same bounds rule.

`event-metrics-v1` (the rollback engine) stays callable. `shared-match-evidence-v1` is pinned to it.

## Community Score (`community-score-v2`, `community-benchmarks-v1`, `overall-profile-v1`)

**Eight dimensions (0–100).** Each is a weighted mean of normalized components. Component weights are in
`strength/scoring/weights.ts`.

| Dimension | Components |
|---|---|
| Firepower | ACS .35, ADR .30, KPR .20, K/D .15 |
| Round Impact | disadvantage .25, trade kills .20, clutch state .20, multi-kill .20, won kills .15 |
| Entry | first kills/round .45, first deaths/round (lower is better) .35, KPR .20 |
| Teamplay | KAST .35, APR .25, trade assists .20, trade kills .20 |
| Clutch | shrunk conversion (wins + 1)/(attempts + 5) .80, difficult wins .20 |
| Economy | damage / 1000 spent .65, kills / 1000 spent .35 |
| Consistency | ACS CV .60, KAST SD .40 (≥ 5 valid matches) |
| Role Value | role-specific weights |

**Normalization.**
- Each component is mapped to 0–100 against a transparent, **role-aware** benchmark range: per-role ranges for ACS, ADR,
  K/D, KPR, APR, KAST and FK/round; global ranges for the rest.
- The benchmarks are product-design calibration, not population percentiles.
- A dimension needs ≥ 70 % of its configured component weight; otherwise it is unavailable.

**Overall.**
- Weights: Firepower .18, Round Impact .16, Entry .12, Teamplay .16, Clutch .10, Economy .10, Consistency .10,
  Role Value .08.
- Renormalized over the available dimensions. It needs ≥ 6 dimensions and ≥ 75 % weight; otherwise it is unavailable.

**Confidence** (separate from the value) = 100 · √(min(matches/30, 1) · min(rounds/600, 1)) · observed coverage.

**Role.** Each member's role is the most-played KNOWN role by rounds. With none, it is undefined: no fallback role is
guessed (`agent-catalog-v1`, stable agent id first).

## Current Strength and Recent Form (`adaptive-window-v1`, `feature-scope-policy-v3`)

**Current Strength** is the community-score-v2 Overall over the member's newest Competitive window.

- **Window walk.** Newest to oldest, within 120 days of the population's newest Competitive match.
- **Stops at the first of:**
  - target reached (≥ 600 rounds, ≥ 5 matches and ≥ 2 active days);
  - 50 matches;
  - an Act boundary;
  - a 60-day span once the minimum (5 matches, 100 rounds, 2 days) is met.
- **Unavailable window.** If the window is unavailable, no value is shown.
- **Window confidence** = √(sample · temporal) · (0.5 + 0.5 · evidence). It is shown separately.

**Recent Form** = Overall(recent window) − Overall(strictly older, comparable baseline). Above +2 is "up", below −2 is
"down", otherwise "flat". Either side insufficient gives "insufficient".

## Shared-Match (`shared-match-evidence-v1`, `shared-match-rating-v1`)

**Not MMR, not true skill, not a win probability.**

**Units.**
- Unordered pair-match units are formed from Competitive and Unrated matches with ≥ 10 rounds.
- Signal = the one-match community-score-v2 **Firepower**, using the frozen catalog v0 and event-metrics-v1.

**Scoring a unit.**
- Margin = s_A − s_B.
- σ = the pooled within-member SD.
- Neutral if |margin| < 0.2 σ.
- Means use margins winsorized at ±2 σ.

**Member rating.**
- Each shared match counts once: weight 1/(other members present).
- Outperform share p is shrunk toward ½ by n/(n + 8): rating = 100 · (½ + (p − ½) · n/(n + 8)).
- 50 = even shared-match evidence.
- Unavailable below 5 shared matches.
- Confidence = 100 · √(min(n/30, 1) · partner diversity) · valid share.

## Team Composition (`team-composition-v1.1`, `team-fit-hierarchy-v1`, `team-responsibility-v1`, `team-composition-v2`)

V2 emits `team-composition-v1.1` = the accepted `team-composition-v1` scoring / evidence / confidence / Team Fit model
plus explicit deterministic floating-tie semantics ([TEAM_COMPOSITION_TIES.md](TEAM_COMPOSITION_TIES.md)).
`team-composition-v1` names the legacy semantics (raw floating-point ordering); V2 does not claim to emit it.

**Input:** exactly 5 distinct members and a map.

**Individual fit.** The hierarchy member × agent → member × role → member, each level shrunk toward the level above by
n/(n + 8). It is computed on the one-match role-aware performance profile. Map levels are context only (map evidence did
not validate as predictive).

**Assignment score** = the mean fit of the five.

**Recommendation.**
- Assignments within 0.2 σ (σ = the pooled within-member SD of one-match performance) of the best are comparable.
- Among comparable assignments, the highest confidence wins; ties go to the higher score, then the assignment
  signature.
- v1.1: values within `TEAM_COMPOSITION_TIE_EPSILON` = 1e-9 (inclusive) are equal; the signature is
  `memberId=agentContentId/role` in canonical member order (see TEAM_COMPOSITION_TIES.md).
- **Two alternatives** are returned.

**Team Fit** (0–100) = the mean percentile of each member's assigned agent among their own evidence-backed agents.
It is a **relative historical lineup fit**, not a win probability or proof of an optimal lineup.

**Confidence.** Member confidence = 100 · √min(n(member × agent)/20, 1). Experimental agents are capped at 25.

**Responsibilities.**
- **V1** labels come from role-scoped behaviour rates shrunk by K = 8, above the group median, with ≥ 5 matches. The
  product displays only those whose deciding rate was holdout-validated.
- **V2** gives side-aware labels from explicit-side member rounds (≥ 5 matches per side). The emittable set is:
  - attack: primary entry, second entry / trade, plant support, post-plant;
  - defense: first contact, info support.
- **Site tendencies are withheld** (they did not reproduce in time).
- **V2 never changes** the V1 assignment, Team Fit or confidence.

## Rank context (`rank-context-v1`, `valorant-tier-order-v1`)

- **Match-time rank** = the exact in-match snapshot, else the latest point-in-time evidence strictly before the match.
  The match's own post-match history row is excluded.
- **Never used:** peak, seasonal, or later evidence.
- `providerElo` keeps the provider's own meaning and is never presented as MMR.
- Rank is context only.
