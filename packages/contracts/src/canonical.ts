import { z } from 'zod';
import { EvidenceStatus, GameMode, HistoryCompleteness, InternalId, IsoInstant, NonNegativeInt } from './common.ts';
import { CANONICAL_SCHEMA_VERSION } from './versions.ts';

/**
 * Canonical, provider-neutral match evidence (canonical-schema-v2). Adapters and importers convert source payloads INTO
 * these shapes; analytics consumes ONLY these shapes. Field names describe game semantics, not a provider's payload.
 *
 * PRIVATE by design (never published): `source.providerRecordRef`, `season.ref`, participant `accountId`, every
 * coordinate (`location`, `playerSnapshots`, plant / defuse locations) and view direction.
 * Statistics stay null when the source has no such evidence — never zero-filled.
 */
export const SourceReference = z.object({
  providerId: z.string().min(1).max(40),
  /** Source payload / adapter version — independent of the canonical schema version. */
  providerVersion: z.string().min(1).max(40),
  normalizerVersion: z.string().min(1).max(40),
  /** The provider's own record reference (e.g. its match id). PRIVATE. */
  providerRecordRef: z.string().min(1).max(200),
  observedAt: IsoInstant,
  /** How the evidence reached the canonical store. */
  acquisition: z.enum(['provider-adapter', 'legacy-import']),
  /** e.g. `fake-provider` or `legacy-rebuild-staging:rebuild-staging-v1`. */
  acquisitionSource: z.string().min(1).max(80),
}).strict();
export type SourceReference = z.infer<typeof SourceReference>;

export const EvidenceMetadata = z.object({
  /** Never "lifetime": a provider only exposes part of a career. */
  historyCompleteness: HistoryCompleteness,
  evidenceQuality: z.enum(['complete', 'partial', 'basic']),
  rounds: EvidenceStatus,
  kills: EvidenceStatus,
  hasDamage: z.boolean(),
  hasPositions: z.boolean(),
}).strict();
export type EvidenceMetadata = z.infer<typeof EvidenceMetadata>;

export const CanonicalTeam = z.object({
  teamKey: z.string().min(1).max(20),
  roundsWon: NonNegativeInt.nullable(),
  roundsLost: NonNegativeInt.nullable(),
  /** null = draw or unknown. */
  won: z.boolean().nullable(),
}).strict();
export type CanonicalTeam = z.infer<typeof CanonicalTeam>;

const NullableCount = NonNegativeInt.nullable();

export const CanonicalParticipant = z.object({
  /** Match-scoped participant key (internal, derived; not linkable across matches). */
  participantKey: z.string().min(1).max(40),
  teamKey: z.string().min(1).max(20),
  /** Internal stable member identity when the participant is a tracked group member; null otherwise. */
  memberId: InternalId.nullable(),
  /** Internal source-account id (PRIVATE linkage); null for untracked participants. */
  accountId: InternalId.nullable(),
  /** Stable agent content id as provided (resolution to a role is an analytics concern; unknown stays unknown). */
  agentId: z.string().min(1).max(64).nullable(),
  agentName: z.string().min(1).max(40).nullable(),
  stats: z.object({
    status: EvidenceStatus,
    kills: NullableCount,
    deaths: NullableCount,
    assists: NullableCount,
    score: NullableCount,
    damageDealt: NullableCount,
    damageReceived: NullableCount,
    headshots: NullableCount,
    bodyshots: NullableCount,
    legshots: NullableCount,
  }).strict(),
  abilityCasts: z.object({ status: EvidenceStatus, ability1: NullableCount, ability2: NullableCount, grenade: NullableCount, ultimate: NullableCount }).strict(),
  economy: z.object({ status: EvidenceStatus, loadoutValueTotal: NullableCount, loadoutValueAverage: z.number().nonnegative().nullable(), spentTotal: NullableCount, spentAverage: z.number().nonnegative().nullable() }).strict(),
}).strict();
export type CanonicalParticipant = z.infer<typeof CanonicalParticipant>;

/** Raw coordinate in the source's own (undocumented) coordinate system. PRIVATE. Never transformed. */
export const CanonicalPoint = z.object({ x: z.number(), y: z.number() }).strict();

/** One player's position at one event. PRIVATE, player-attributable (erasable per member). */
export const CanonicalPlayerSnapshot = z.object({
  participantKey: z.string().min(1).max(40),
  location: CanonicalPoint,
  viewRadians: z.number().nullable(),
}).strict();
export type CanonicalPlayerSnapshot = z.infer<typeof CanonicalPlayerSnapshot>;

export const CanonicalAsset = z.object({ id: z.string().min(1).max(64).nullable(), name: z.string().min(1).max(60).nullable() }).strict();

export const CanonicalEvent = z.object({
  eventKey: z.string().min(1).max(40),
  roundNumber: z.number().int().nonnegative(),
  /** Order of the event inside its round as given by the source. */
  sequence: NonNegativeInt,
  timeInRoundMs: NonNegativeInt,
  timeInMatchMs: NonNegativeInt.nullable(),
  type: z.enum(['kill']),
  actorParticipantKey: z.string().min(1).max(40),
  targetParticipantKey: z.string().min(1).max(40),
  assistantParticipantKeys: z.array(z.string().min(1).max(40)),
  weapon: CanonicalAsset.nullable(),
  /** Event location AS REPORTED by the source. Not assumed to be the victim's position. PRIVATE. */
  location: CanonicalPoint.nullable(),
  /** Player snapshots at this event (first row per player). PRIVATE. Never interpolated into paths. */
  playerSnapshots: z.array(CanonicalPlayerSnapshot),
}).strict();
export type CanonicalEvent = z.infer<typeof CanonicalEvent>;

const ObjectiveStatus = z.enum(['present', 'absent', 'missing', 'unavailable']);

export const CanonicalRoundParticipant = z.object({
  participantKey: z.string().min(1).max(40),
  stats: z.object({ status: EvidenceStatus, kills: NullableCount, score: NullableCount }).strict(),
  economy: z.object({ status: EvidenceStatus, loadoutValue: NullableCount, remainingCredits: NullableCount }).strict(),
  weapon: CanonicalAsset.extend({ status: EvidenceStatus }).strict(),
  armor: CanonicalAsset.extend({ status: EvidenceStatus }).strict(),
}).strict();
export type CanonicalRoundParticipant = z.infer<typeof CanonicalRoundParticipant>;

export const CanonicalRound = z.object({
  roundNumber: z.number().int().nonnegative(),
  winningTeamKey: z.string().min(1).max(20).nullable(),
  /** Provider round result code as given (e.g. Elimination / Bomb detonated / Bomb defused). */
  result: z.string().min(1).max(40).nullable(),
  /** Explicit side evidence only (never derived from halves or the winner alone); null = unknown. */
  winningTeamRole: z.enum(['attacker', 'defender']).nullable(),
  attackingTeamKey: z.string().min(1).max(20).nullable(),
  sideSource: z.enum(['winning_team_role', 'plant', 'defuse']).nullable(),
  plant: z.object({
    status: ObjectiveStatus,
    participantKey: z.string().min(1).max(40).nullable(),
    timeInRoundMs: NonNegativeInt.nullable(),
    /** Provider site label as given; never inferred from coordinates. */
    site: z.string().min(1).max(10).nullable(),
    location: CanonicalPoint.nullable(),
  }).strict(),
  defuse: z.object({
    status: ObjectiveStatus,
    participantKey: z.string().min(1).max(40).nullable(),
    timeInRoundMs: NonNegativeInt.nullable(),
    location: CanonicalPoint.nullable(),
  }).strict(),
  participantsStatus: EvidenceStatus,
  participants: z.array(CanonicalRoundParticipant),
}).strict();
export type CanonicalRound = z.infer<typeof CanonicalRound>;

export const CanonicalMatch = z.object({
  schemaVersion: z.literal(CANONICAL_SCHEMA_VERSION),
  /** Provider-neutral canonical key (derived; internal). */
  matchKey: z.string().regex(/^cm_[0-9a-f]{24}$/u),
  source: SourceReference,
  evidence: EvidenceMetadata,
  mapId: z.string().min(1).max(64).nullable(),
  mapName: z.string().min(1).max(40).nullable(),
  mode: GameMode,
  /** The source's own queue label, preserved (e.g. "Swiftplay", "Gauntlet: Glitched"). */
  queue: z.object({ id: z.string().min(1).max(40).nullable(), name: z.string().min(1).max(60).nullable() }).strict(),
  /** Season / Act: `key` is the provider short code, `ref` the provider season id (PRIVATE). */
  season: z.object({ key: z.string().min(1).max(16).nullable(), ref: z.string().min(1).max(64).nullable() }).strict(),
  startedAt: IsoInstant,
  durationMs: NonNegativeInt.nullable(),
  teams: z.array(CanonicalTeam),
  participants: z.array(CanonicalParticipant).min(1),
  rounds: z.array(CanonicalRound),
  events: z.array(CanonicalEvent),
}).strict();
export type CanonicalMatch = z.infer<typeof CanonicalMatch>;

/**
 * Rank evidence (separate from match evidence). Rank is CONTEXT, never a weight. `providerElo` keeps the provider's
 * own semantics (Henrik `elo` = (tier − 3) × 100 + RR) — it is NOT a hidden Riot MMR.
 * Time semantics: `effectiveAt` is when the value held. current / peak / seasonal rows are effective at INGESTION time
 * and are never valid match-time context for earlier matches.
 */
export const RankContextKind = z.enum(['match-snapshot', 'history', 'current', 'peak', 'seasonal']);
export const RankContext = z.object({
  rankContextId: z.string().min(1).max(80),
  memberId: InternalId,
  accountId: InternalId,
  kind: RankContextKind,
  effectiveAt: IsoInstant,
  /** Canonical match this row belongs to (match-snapshot / history rows), else null. */
  matchKey: z.string().regex(/^cm_[0-9a-f]{24}$/u).nullable(),
  providerId: z.string().min(1).max(40),
  sourceEndpoint: z.string().min(1).max(80),
  providerTierId: z.number().int().nonnegative().nullable(),
  providerTierName: z.string().min(1).max(40).nullable(),
  rr: z.number().int().nullable(),
  rrChange: z.number().int().nullable(),
  providerElo: z.number().int().nullable(),
  seasonKey: z.string().min(1).max(16).nullable(),
  queue: z.string().min(1).max(40).nullable(),
  normalizedTierKey: z.string().min(1).max(40).nullable(),
  tierOrdinal: z.number().int().nonnegative().nullable(),
  tierModelVersion: z.string().min(1).max(40),
}).strict();
export type RankContext = z.infer<typeof RankContext>;
