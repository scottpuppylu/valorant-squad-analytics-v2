# Team Composition tie semantics (`team-composition-v1.1`)

V2-TEAM-COMPOSITION-TIE-SEMANTICS-01 (2026-10-09). Status: **AWAITING SDD REVIEW**. Local only.

## Versions

| Version | Meaning |
|---|---|
| `team-composition-v1` | The accepted legacy algorithm. Lineups are ordered by raw floating-point comparison, so mathematically equal values are ordered by summation noise (which depends on the order members are iterated). |
| `team-composition-v1.1` | The same scoring, evidence selection, confidence formula, Team Fit, band and thresholds, plus the explicit deterministic tie semantics below. **This is what V2 emits** (`TEAM_COMPOSITION_VERSION`, snapshot `team-builder.json` `algorithm.v1Version`). |

Legacy v1 never had this rule. V2 does not claim to emit bit-identical v1.

`team-composition-v2` (responsibility layer) is unchanged. It consumes the v1.1 recommended lineup.

## Rule (single source: `packages/analytics/src/team-composition/tieSemantics.ts`)

1. **Epsilon.** `TEAM_COMPOSITION_TIE_EPSILON = 1e-9`, defined once.
2. **Equality.** Two values are equal when `|a − b| <= EPSILON` (inclusive). This applies to both score and confidence.
3. **Enumeration order.** Score desc (semantic equality), then assignment signature asc.
4. **Comparable band.** `score >= best − band − EPSILON`. The band is unchanged (0.2 σ).
5. **Recommendation order.** Inside the band: confidence desc, then score desc, then signature asc. After the band: the
   remaining assignments in enumeration order (at most 10).
6. **No duplicates.** Each assignment appears at most once (keyed by signature). The recommended lineup can never also
   be an alternative.
7. **Assignment signature.** `memberId=agentContentId/role` for the five picks:
   - in canonical member order (internal V2 member ids sorted by code point);
   - joined by `|`;
   - code-point comparison (locale-independent).

**What the signature uses.** Only the V2 stable member identity, the public agent content id from `agent-catalog-v1`,
and the role.

**What the signature never uses:**
- provider account ids, PUUIDs or other Henrik / Riot fields;
- legacy keys;
- database row order;
- object iteration order.

HENRIK_FIELDS_IN_TIEBREAK = 0. RIOT_FIELDS_IN_TIEBREAK = 0. PROVIDER_IDS_IN_TIEBREAK = 0.

**Unchanged per-member pools.** A member's candidate pool is still ordered by that member's own fit values. This is
evidence selection, unchanged from v1.

## Real-data matrix (private, PostgreSQL 18; frozen legacy oracle, checkout `1a4c7906`)

The matrix covers all 126 five-member sets × 3 maps (the two most and the least played): **378 runs**.

| Class | Runs |
|---|---|
| EXACT_LEGACY_MATCH | 375 |
| SEMANTIC_TIE_DIFFERENCE | 3 (one member set on Ascent, Summit and Icebox) |
| UNEXPLAINED_DIFFERENCE | 0 |

**Proof for each semantic tie difference** (checked automatically):
- **Same candidate set.** The lineup sets are identical, as are feasible assignments, comparable band and status.
- **Same values.** Every matched lineup's values are equal: fit score, Team Fit, confidence, role distribution and every
  member's agent, fit, confidence and samples.
- **Ties only.** Every inverted pair has confidence equal within epsilon (max |Δ| = 1.42e-14), and V2's order follows
  score desc (the next key).
- **V2 layer unchanged.** The V2 responsibility layer, applied to the legacy-ordered result, reproduces legacy V2 exactly.

**Effect.** On Summit the recommended lineup is the higher-score member of the tie pair. On Ascent and Icebox only the
alternatives' order changes.

**Unchanged:**
- TEAM_FIT_NUMERIC_CHANGE = NO.
- Non-tied assignment changes = 0.
- Switching the final key from agent names to the signature changed no further run.

**Unchanged elsewhere** (same run):
- Competitive event fingerprints equal legacy (v1 and v2).
- Shared-Match, Community Score, Current Strength and Recent Form show 0 differences.
- FUTURE_RANK_LEAKAGE = 0.

## Tests (`tests/teamCompositionTies.test.ts`)

- **Equality boundaries:** exact equality, difference below epsilon, exactly epsilon, and above epsilon.
- **Comparator keys:** confidence ties pass to score, then signature; a real confidence difference decides alone.
- **Band edge.**
- **Ranking:** identical for every input order; no duplicates; the primary never reappears.
- **Signature:** canonical and provider-neutral.
- **Input order:** all 120 permutations of the five members give identical output on three maps, for two member sets.
- **Database / iteration order:** shuffled match, participant, round and event rows give identical output.
