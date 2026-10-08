import { z } from 'zod';
import { GameMode, HistoryCompleteness, IsoInstant, NonNegativeInt, PublicGroupId, PublicMemberId } from './common.ts';
import { CONFIDENCE_MODELS, DIMENSION_KEYS, EXPLANATION_KEYS, PRODUCT_CONTRACT_VERSION, PRODUCT_STATUSES, REASON_CODES, ROLE_KEYS } from './product.ts';
import { ANALYTICS_CONTRACT_VERSION, MANIFEST_VERSION, PUBLIC_SNAPSHOT_VERSION } from './versions.ts';

/**
 * PUBLIC contracts (`public-snapshot-v2`): everything a static snapshot may contain. Every object is `.strict()`
 * (unknown fields rejected). These shapes have NO field for provider account ids, raw match ids, participant ids,
 * coordinates, view direction, rank source rows, tokens, keys or database URLs — such data cannot be represented here.
 * Only objects, arrays, nullables and scalars are used, so the explicit serializer allowlist (@vsa/privacy) can be
 * proven equal to these shapes (tests/privacy.test.ts).
 */
const Label = z.string().min(1).max(40);
const Code = z.enum(REASON_CODES);
const Status = z.enum(PRODUCT_STATUSES);
const Role = z.enum(ROLE_KEYS);
const Percent = z.number().min(0).max(100);
const ResponsibilityLabel = z.string().regex(/^[A-Z][A-Z_]{2,40}$/u, 'UPPER_SNAKE responsibility label');

export const PublicProvenance = z.object({
  historyCompleteness: HistoryCompleteness,
  /** Always false: no source proves a complete career history. */
  lifetimeComplete: z.literal(false),
  summary: z.string().min(1).max(200),
}).strict();

export const PublicMember = z.object({ publicMemberId: PublicMemberId, displayName: Label }).strict();

export const PublicGroupSnapshot = z.object({
  snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
  group: z.object({ publicGroupId: PublicGroupId, name: z.string().min(1).max(80) }).strict(),
  members: z.array(PublicMember),
  provenance: PublicProvenance,
  /** Provider-visible coverage of the published population (never a lifetime claim). */
  coverage: z.object({ firstMatchAt: IsoInstant.nullable(), lastMatchAt: IsoInstant.nullable(), matchesObserved: NonNegativeInt, competitiveMatches: NonNegativeInt }).strict(),
  /** Latest match start time represented in this snapshot (data-derived, deterministic). */
  dataAsOf: IsoInstant.nullable(),
}).strict();
export type PublicGroupSnapshot = z.infer<typeof PublicGroupSnapshot>;

export const PublicPlayer = z.object({
  publicMemberId: PublicMemberId,
  displayName: Label,
  matchesObserved: NonNegativeInt,
  competitiveMatches: NonNegativeInt,
  firstObservedAt: IsoInstant.nullable(),
  lastObservedAt: IsoInstant.nullable(),
}).strict();

export const PublicPlayerSnapshot = z.object({ snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION), players: z.array(PublicPlayer) }).strict();
export type PublicPlayerSnapshot = z.infer<typeof PublicPlayerSnapshot>;

export const PublicPlayerAnalysis = z.object({
  publicMemberId: PublicMemberId,
  algorithmId: z.string().min(1).max(60),
  sampleSize: z.object({ matches: NonNegativeInt, rounds: NonNegativeInt }).strict(),
  matchesPlayed: NonNegativeInt,
  wins: NonNegativeInt,
  losses: NonNegativeInt,
  kills: NonNegativeInt,
  deaths: NonNegativeInt,
  assists: NonNegativeInt,
  kd: z.number().nonnegative().nullable(),
  adr: z.number().nonnegative().nullable(),
  eligible: z.boolean(),
  eligibilityReasons: z.array(z.string().min(1).max(120)),
}).strict();

export const PublicAnalysisSnapshot = z.object({
  snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
  analyticsContractVersion: z.literal(ANALYTICS_CONTRACT_VERSION),
  scope: z.object({ mode: GameMode, historyCompleteness: HistoryCompleteness }).strict(),
  algorithms: z.array(z.object({ algorithmId: z.string().min(1).max(60), description: z.string().min(1).max(200) }).strict()),
  players: z.array(PublicPlayerAnalysis),
}).strict();
export type PublicAnalysisSnapshot = z.infer<typeof PublicAnalysisSnapshot>;

// ---------------------------------------------------------------- product read models (product-contract-v1)
const Sample = z.object({ matches: NonNegativeInt, rounds: NonNegativeInt }).strict();
const Eligibility = z.object({ eligible: z.boolean(), reasons: z.array(Code) }).strict();
export const PublicProductMetric = z.object({
  version: z.string().min(1).max(60),
  status: Status,
  value: z.number().nullable(),
  confidence: Percent.nullable(),
  confidenceModel: z.enum(CONFIDENCE_MODELS),
  sampleSize: Sample.nullable(),
  eligibility: Eligibility,
  evidenceSummary: z.array(Code),
  explanationKey: z.enum(EXPLANATION_KEYS),
}).strict();
export type PublicProductMetric = z.infer<typeof PublicProductMetric>;

export const PublicProfile = z.object({
  publicMemberId: PublicMemberId,
  displayName: Label,
  primaryRole: Role.nullable(),
  competitiveMatches: NonNegativeInt,
  competitiveRounds: NonNegativeInt,
  communityScore: PublicProductMetric,
  dimensions: z.array(z.object({ dimension: z.enum(DIMENSION_KEYS), status: Status, value: z.number().nullable(), confidence: Percent }).strict()),
  currentStrength: PublicProductMetric,
  currentWindow: z.object({ status: Status, matches: NonNegativeInt, rounds: NonNegativeInt, activeDays: NonNegativeInt, from: IsoInstant.nullable(), to: IsoInstant.nullable(), confidence: Percent.nullable() }).strict(),
  recentForm: z.object({ status: z.enum(['up', 'flat', 'down', 'insufficient']), delta: z.number().nullable(), recentMatches: NonNegativeInt, baselineMatches: NonNegativeInt }).strict(),
  basic: z.object({ acs: z.number().nonnegative().nullable(), headshotPercentage: z.number().min(0).max(1).nullable(), kpr: z.number().nonnegative().nullable(), apr: z.number().nonnegative().nullable() }).strict(),
  advanced: z.object({
    kast: z.object({ status: Status, rate: z.number().min(0).max(1).nullable(), rounds: NonNegativeInt }).strict(),
    opening: z.object({ status: Status, firstKills: NonNegativeInt.nullable(), firstDeaths: NonNegativeInt.nullable(), rounds: NonNegativeInt }).strict(),
    trade: z.object({ status: Status, tradeKills: NonNegativeInt.nullable(), tradedDeaths: NonNegativeInt.nullable(), tradeAssists: NonNegativeInt.nullable(), rounds: NonNegativeInt }).strict(),
    clutch: z.object({ status: Status, attempts: NonNegativeInt.nullable(), wins: NonNegativeInt.nullable() }).strict(),
    roundImpact: PublicProductMetric,
  }).strict(),
  rank: z.object({ status: z.enum(['known', 'unknown']), tierLabel: Label.nullable(), tierOrdinal: NonNegativeInt.nullable(), asOf: IsoInstant.nullable(), source: z.enum(['match-snapshot', 'history', 'none']) }).strict(),
  agents: z.array(z.object({ agentName: Label, role: Role.nullable(), matches: NonNegativeInt, wins: NonNegativeInt }).strict()),
  roles: z.array(z.object({ role: Role, matches: NonNegativeInt }).strict()),
  maps: z.array(z.object({ mapName: Label, matches: NonNegativeInt, wins: NonNegativeInt }).strict()),
}).strict();
export type PublicProfile = z.infer<typeof PublicProfile>;

export const PublicProfileSnapshot = z.object({
  snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
  productContractVersion: z.literal(PRODUCT_CONTRACT_VERSION),
  profiles: z.array(PublicProfile),
}).strict();
export type PublicProfileSnapshot = z.infer<typeof PublicProfileSnapshot>;

const SharedRating = z.object({ status: Status, rating: Percent.nullable(), outperformShare: z.number().min(0).max(1).nullable(), sharedMatches: NonNegativeInt,
  partners: NonNegativeInt, evidencedPartners: NonNegativeInt, confidence: Percent }).strict();
export const PublicSharedPair = z.object({
  memberA: PublicMemberId, memberB: PublicMemberId,
  sharedMatches: NonNegativeInt, competitiveMatches: NonNegativeInt, unratedMatches: NonNegativeInt, sameTeamMatches: NonNegativeInt, scoredMatches: NonNegativeInt,
  ratingA: Percent.nullable(), ratingB: Percent.nullable(), relativeDifference: z.number().nullable(), medianDifference: z.number().nullable(),
  aOutperformed: NonNegativeInt, bOutperformed: NonNegativeInt, neutral: NonNegativeInt,
  recent: z.object({ matches: NonNegativeInt, aOutperformed: NonNegativeInt, bOutperformed: NonNegativeInt, neutral: NonNegativeInt }).strict(),
  confidence: Percent,
  eligibility: Eligibility,
}).strict();
export const PublicSharedMatchSnapshot = z.object({
  snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
  productContractVersion: z.literal(PRODUCT_CONTRACT_VERSION),
  algorithm: z.object({ version: z.string().min(1).max(60), evidenceVersion: z.string().min(1).max(60), neutralSigma: z.number(), shrinkK: z.number(), minMatches: NonNegativeInt }).strict(),
  members: z.array(z.object({ publicMemberId: PublicMemberId, combined: SharedRating, competitive: SharedRating, unrated: SharedRating, recent: SharedRating }).strict()),
  pairs: z.array(PublicSharedPair),
  coverage: z.object({ possiblePairs: NonNegativeInt, pairsWithShared: NonNegativeInt, pairUnits: NonNegativeInt, scoredUnits: NonNegativeInt,
    minShared: NonNegativeInt.nullable(), medianShared: z.number().nullable(), maxShared: NonNegativeInt.nullable() }).strict(),
}).strict();
export type PublicSharedMatchSnapshot = z.infer<typeof PublicSharedMatchSnapshot>;

const TeamMember = z.object({
  publicMemberId: PublicMemberId, agentName: Label, role: Role,
  generalResponsibility: ResponsibilityLabel.nullable(), withheldResponsibility: ResponsibilityLabel.nullable(),
  attackResponsibility: ResponsibilityLabel.nullable(), defenseResponsibility: ResponsibilityLabel.nullable(),
  attackConfidence: Percent.nullable(), defenseConfidence: Percent.nullable(), attackReasons: z.array(Code), defenseReasons: z.array(Code),
  fit: z.number(), confidence: Percent, experimental: z.boolean(), evidenceLevel: z.string().min(1).max(20),
  samples: z.object({ member: NonNegativeInt, role: NonNegativeInt, agent: NonNegativeInt, agentMap: NonNegativeInt, map: NonNegativeInt }).strict(),
}).strict();
const Lineup = z.object({
  label: z.enum(['RECOMMENDED_HISTORICAL_FIT', 'ALTERNATIVE']),
  teamFit: Percent, fitScore: z.number(), confidence: Percent, comparableToBest: z.boolean(), v2Applied: z.boolean(),
  roleDistribution: z.object({ Duelist: NonNegativeInt, Initiator: NonNegativeInt, Controller: NonNegativeInt, Sentinel: NonNegativeInt }).strict(),
  members: z.array(TeamMember).length(5),
}).strict();
export const PublicTeamBuilderSnapshot = z.object({
  snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
  productContractVersion: z.literal(PRODUCT_CONTRACT_VERSION),
  algorithm: z.object({ v1Version: z.string().min(1).max(60), v2Version: z.string().min(1).max(60), fitVersion: z.string().min(1).max(60),
    teamFitSemantics: z.literal('historical-relative-lineup-fit'), isWinProbability: z.literal(false), isProvenOptimalLineup: z.literal(false) }).strict(),
  maps: z.array(Label),
  emittableAttack: z.array(ResponsibilityLabel), emittableDefense: z.array(ResponsibilityLabel), withheldLabels: z.array(ResponsibilityLabel),
  results: z.array(z.object({
    memberIds: z.array(PublicMemberId).length(5), map: Label, status: z.enum(['ok', 'insufficient_evidence']), reason: Code.nullable(),
    comparableBand: z.number().nullable(), lineups: z.array(Lineup),
  }).strict()),
}).strict();
export type PublicTeamBuilderSnapshot = z.infer<typeof PublicTeamBuilderSnapshot>;

/** File names a snapshot may contain: plain names only — no directories, no traversal. */
export const PublicFileKind = z.enum(['group', 'players', 'analytics', 'profiles', 'shared-match', 'team-builder']);
export type PublicFileKind = z.infer<typeof PublicFileKind>;
export const PUBLIC_FILE_NAMES: Record<PublicFileKind, string> = {
  group: 'group.json', players: 'players.json', analytics: 'analytics.json', profiles: 'profiles.json', 'shared-match': 'shared-match.json', 'team-builder': 'team-builder.json',
};

export const SnapshotId = z.string().regex(/^ps1-[0-9a-f]{16}$/u, 'content-derived snapshot id');

export const SnapshotFileEntry = z.object({
  kind: PublicFileKind,
  name: z.string().regex(/^[a-z][a-z0-9-]{0,40}\.json$/u, 'plain file name'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  bytes: z.number().int().positive(),
}).strict();

export const SnapshotManifest = z.object({
  manifestVersion: z.literal(MANIFEST_VERSION),
  active: z.object({
    snapshotId: SnapshotId,
    snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
    /** Always `snapshots/<snapshotId>` — validated, never free-form. */
    path: z.string().regex(/^snapshots\/ps1-[0-9a-f]{16}$/u),
    files: z.array(SnapshotFileEntry).min(1),
    /** Wall-clock activation time: metadata only, never part of the snapshot identity. */
    activatedAt: IsoInstant,
  }).strict(),
  /** Previously active snapshot ids, most recent first (rollback candidates). */
  history: z.array(SnapshotId).max(50),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.active.path !== `snapshots/${manifest.active.snapshotId}`) ctx.addIssue({ code: 'custom', message: 'path must equal snapshots/<snapshotId>' });
  const names = manifest.active.files.map((f) => f.name);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', message: 'duplicate file names' });
  for (const f of manifest.active.files) if (PUBLIC_FILE_NAMES[f.kind] !== f.name) ctx.addIssue({ code: 'custom', message: `file ${f.name} does not match kind ${f.kind}` });
});
export type SnapshotManifest = z.infer<typeof SnapshotManifest>;

/** Exporter → publisher hand-off (internal; the files are the public part). */
export interface BuiltSnapshotFile { kind: PublicFileKind; name: string; content: string; sha256: string; bytes: number }
export interface BuiltSnapshot { snapshotId: string; snapshotVersion: typeof PUBLIC_SNAPSHOT_VERSION; files: BuiltSnapshotFile[] }

export const PUBLIC_DOCUMENT_SCHEMAS = {
  group: PublicGroupSnapshot,
  players: PublicPlayerSnapshot,
  analytics: PublicAnalysisSnapshot,
  profiles: PublicProfileSnapshot,
  'shared-match': PublicSharedMatchSnapshot,
  'team-builder': PublicTeamBuilderSnapshot,
} as const;
