# Product UI direction

## Product model

- **Groups.** Users create private, invite-only comparison groups. Each member opts in individually, and analytics are
  group-scoped. The current 哥布林 group becomes the first (demo) group later.
- **Out of scope:**
  - global player lookup;
  - a global Riot-ID database;
  - opponent scouting;
  - any MMR / Elo / official-rank replacement.

## Pages

| Route | Page | Bootstrap status | Future content |
|---|---|---|---|
| `#/` | Dashboard | **Implemented**: group name, snapshot id and version, data-as-of and published time, member cards (matches, W/L, K/D, ADR when present), evidence note | Accepted scores (community-score-v2), current strength, form; sample-size confidence beside every value |
| `#/players` | Players | List (matches observed, first / last) | Player Profile: per-map / agent / role, event metrics (event-metrics-v2), progress |
| `#/compare` | Compare | Placeholder | Side-by-side accepted metrics with confidence |
| `#/synergy` | Synergy | Placeholder | Pair-level association (duo-synergy-v1), clearly not causal |
| `#/team-builder` | Team Builder | Placeholder plus semantics | **Core feature.** Five members plus a map → `TeamCompositionResult` (agent, role, attack / defense responsibilities, Team Fit, separate confidence, sample size, evidence, alternatives) |
| `#/about` | Data / About | Implemented | Provenance, history completeness, consent and privacy explanation |

## Language rules

- **Team Fit** is "historical relative lineup fit". It is never a win probability and never a proven optimal lineup.
  The contract encodes this as literals.
- **Confidence** is always shown separately from any score.
- **History** is "provider-visible", never "full career".
- **No callouts or positions.** No named callouts, exact positions, paths or real-time instructions.

## Status states

Every data state renders explicitly: loading, ready, empty, invalid manifest, unsupported snapshot version, missing
snapshot and privacy validation failure.

## Visual direction

- The bootstrap uses a clean, responsive layout (no horizontal scroll at phone width; light and dark).
- A visual redesign is a later wave (V2-PRODUCT-UI-WAVE-01).
- No Riot, VALORANT or third-party assets or page designs are copied.
