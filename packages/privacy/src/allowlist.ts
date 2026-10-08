import type { PublicFileKind } from '@vsa/contracts/public';

/**
 * The AUTHORITATIVE public field allowlist. A field not listed here can never be published: the serializer rejects
 * it (it does not silently drop it, so an accidentally attached private field is surfaced as an error).
 * tests/privacy.test.ts proves this tree equals the strict public Zod schemas in @vsa/contracts/public.
 */
export type FieldSpec =
  | { kind: 'scalar' }
  | { kind: 'object'; fields: Record<string, FieldSpec> }
  | { kind: 'array'; of: FieldSpec }
  | { kind: 'nullable'; of: FieldSpec };

const scalar: FieldSpec = { kind: 'scalar' };
const obj = (fields: Record<string, FieldSpec>): FieldSpec => ({ kind: 'object', fields });
const arr = (of: FieldSpec): FieldSpec => ({ kind: 'array', of });
const nullable = (of: FieldSpec): FieldSpec => ({ kind: 'nullable', of });
const n = nullable(scalar);
const scalars = (...names: string[]) => Object.fromEntries(names.map((name) => [name, scalar]));
const nullables = (...names: string[]) => Object.fromEntries(names.map((name) => [name, n]));

const provenance = obj({ historyCompleteness: scalar, lifetimeComplete: scalar, summary: scalar });
const scope = obj({ mode: scalar, historyCompleteness: scalar });
const sample = obj({ matches: scalar, rounds: scalar });
const eligibility = obj({ eligible: scalar, reasons: arr(scalar) });
const productMetric = obj({
  version: scalar, status: scalar, value: n, confidence: n, confidenceModel: scalar, sampleSize: nullable(sample),
  eligibility, evidenceSummary: arr(scalar), explanationKey: scalar,
});
const sharedRating = obj({ ...scalars('status'), ...nullables('rating', 'outperformShare'), ...scalars('sharedMatches', 'partners', 'evidencedPartners', 'confidence') });
const teamMember = obj({
  ...scalars('publicMemberId', 'agentName', 'role'),
  ...nullables('generalResponsibility', 'withheldResponsibility', 'attackResponsibility', 'defenseResponsibility', 'attackConfidence', 'defenseConfidence'),
  attackReasons: arr(scalar), defenseReasons: arr(scalar),
  ...scalars('fit', 'confidence', 'experimental', 'evidenceLevel'),
  samples: obj(scalars('member', 'role', 'agent', 'agentMap', 'map')),
});

export const PUBLIC_ALLOWLIST: Record<PublicFileKind, FieldSpec> = {
  group: obj({
    snapshotVersion: scalar,
    group: obj({ publicGroupId: scalar, name: scalar }),
    members: arr(obj({ publicMemberId: scalar, displayName: scalar })),
    provenance,
    coverage: obj({ ...nullables('firstMatchAt', 'lastMatchAt'), ...scalars('matchesObserved', 'competitiveMatches') }),
    dataAsOf: n,
  }),
  players: obj({
    snapshotVersion: scalar,
    players: arr(obj({ ...scalars('publicMemberId', 'displayName', 'matchesObserved', 'competitiveMatches'), ...nullables('firstObservedAt', 'lastObservedAt') })),
  }),
  analytics: obj({
    snapshotVersion: scalar,
    analyticsContractVersion: scalar,
    scope,
    algorithms: arr(obj({ algorithmId: scalar, description: scalar })),
    players: arr(obj({
      publicMemberId: scalar, algorithmId: scalar, sampleSize: sample,
      ...scalars('matchesPlayed', 'wins', 'losses', 'kills', 'deaths', 'assists'),
      kd: n, adr: n, eligible: scalar, eligibilityReasons: arr(scalar),
    })),
  }),
  profiles: obj({
    snapshotVersion: scalar,
    productContractVersion: scalar,
    profiles: arr(obj({
      ...scalars('publicMemberId', 'displayName'), primaryRole: n, ...scalars('competitiveMatches', 'competitiveRounds'),
      communityScore: productMetric,
      dimensions: arr(obj({ dimension: scalar, status: scalar, value: n, confidence: scalar })),
      currentStrength: productMetric,
      currentWindow: obj({ ...scalars('status', 'matches', 'rounds', 'activeDays'), ...nullables('from', 'to', 'confidence') }),
      recentForm: obj({ status: scalar, delta: n, recentMatches: scalar, baselineMatches: scalar }),
      basic: obj(nullables('acs', 'headshotPercentage', 'kpr', 'apr')),
      advanced: obj({
        kast: obj({ status: scalar, rate: n, rounds: scalar }),
        opening: obj({ status: scalar, ...nullables('firstKills', 'firstDeaths'), rounds: scalar }),
        trade: obj({ status: scalar, ...nullables('tradeKills', 'tradedDeaths', 'tradeAssists'), rounds: scalar }),
        clutch: obj({ status: scalar, ...nullables('attempts', 'wins') }),
        roundImpact: productMetric,
      }),
      rank: obj({ status: scalar, ...nullables('tierLabel', 'tierOrdinal', 'asOf'), source: scalar }),
      agents: arr(obj({ agentName: scalar, role: n, matches: scalar, wins: scalar })),
      roles: arr(obj(scalars('role', 'matches'))),
      maps: arr(obj(scalars('mapName', 'matches', 'wins'))),
    })),
  }),
  'shared-match': obj({
    snapshotVersion: scalar,
    productContractVersion: scalar,
    algorithm: obj(scalars('version', 'evidenceVersion', 'neutralSigma', 'shrinkK', 'minMatches')),
    members: arr(obj({ publicMemberId: scalar, combined: sharedRating, competitive: sharedRating, unrated: sharedRating, recent: sharedRating })),
    pairs: arr(obj({
      ...scalars('memberA', 'memberB', 'sharedMatches', 'competitiveMatches', 'unratedMatches', 'sameTeamMatches', 'scoredMatches'),
      ...nullables('ratingA', 'ratingB', 'relativeDifference', 'medianDifference'),
      ...scalars('aOutperformed', 'bOutperformed', 'neutral'),
      recent: obj(scalars('matches', 'aOutperformed', 'bOutperformed', 'neutral')),
      confidence: scalar,
      eligibility,
    })),
    coverage: obj({ ...scalars('possiblePairs', 'pairsWithShared', 'pairUnits', 'scoredUnits'), ...nullables('minShared', 'medianShared', 'maxShared') }),
  }),
  'team-builder': obj({
    snapshotVersion: scalar,
    productContractVersion: scalar,
    algorithm: obj(scalars('v1Version', 'v2Version', 'fitVersion', 'teamFitSemantics', 'isWinProbability', 'isProvenOptimalLineup')),
    maps: arr(scalar),
    emittableAttack: arr(scalar), emittableDefense: arr(scalar), withheldLabels: arr(scalar),
    results: arr(obj({
      memberIds: arr(scalar), map: scalar, status: scalar, reason: n, comparableBand: n,
      lineups: arr(obj({
        ...scalars('label', 'teamFit', 'fitScore', 'confidence', 'comparableToBest', 'v2Applied'),
        roleDistribution: obj(scalars('Duelist', 'Initiator', 'Controller', 'Sentinel')),
        members: arr(teamMember),
      })),
    })),
  }),
};
