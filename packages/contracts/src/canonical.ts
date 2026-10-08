import { z } from 'zod';
import { GameMode, HistoryCompleteness, InternalId, IsoInstant, NonNegativeInt } from './common.ts';
import { CANONICAL_SCHEMA_VERSION } from './versions.ts';

/**
 * Canonical, provider-neutral match evidence. Adapters convert provider payloads INTO these shapes; analytics consumes
 * ONLY these shapes. Field names describe game semantics, not any provider's payload.
 *
 * PRIVATE by design (never published): `source.providerRecordRef`, participant `accountId`, event `spatial`.
 */
export const SourceReference = z.object({
  providerId: z.string().min(1).max(40),
  providerVersion: z.string().min(1).max(40),
  normalizerVersion: z.string().min(1).max(40),
  /** The provider's own record reference (e.g. its match id). PRIVATE. */
  providerRecordRef: z.string().min(1).max(200),
  observedAt: IsoInstant,
}).strict();
export type SourceReference = z.infer<typeof SourceReference>;

export const EvidenceMetadata = z.object({
  /** Never "lifetime": a provider only exposes part of a career. */
  historyCompleteness: HistoryCompleteness,
  evidenceQuality: z.enum(['complete', 'partial', 'basic']),
  hasRounds: z.boolean(),
  hasEvents: z.boolean(),
  hasDamage: z.boolean(),
}).strict();
export type EvidenceMetadata = z.infer<typeof EvidenceMetadata>;

export const CanonicalTeam = z.object({
  teamKey: z.string().min(1).max(20),
  roundsWon: NonNegativeInt,
  /** null = draw or unknown. */
  won: z.boolean().nullable(),
}).strict();
export type CanonicalTeam = z.infer<typeof CanonicalTeam>;

export const CanonicalParticipant = z.object({
  /** Match-scoped participant key (internal). */
  participantKey: z.string().min(1).max(40),
  teamKey: z.string().min(1).max(20),
  /** Internal stable member identity when the participant is a tracked group member; null otherwise. */
  memberId: InternalId.nullable(),
  /** Internal source-account id (PRIVATE linkage); null for untracked participants. */
  accountId: InternalId.nullable(),
  agentId: z.string().min(1).max(64).nullable(),
  agentName: z.string().min(1).max(40).nullable(),
  stats: z.object({
    kills: NonNegativeInt,
    deaths: NonNegativeInt,
    assists: NonNegativeInt,
    /** Total damage dealt in the match; null when the source has no damage evidence. */
    damageDealt: NonNegativeInt.nullable(),
    score: NonNegativeInt.nullable(),
  }).strict(),
}).strict();
export type CanonicalParticipant = z.infer<typeof CanonicalParticipant>;

/** Raw event-time spatial evidence. PRIVATE: never published, never exported. */
export const CanonicalSpatialEvidence = z.object({
  locationX: z.number(),
  locationY: z.number(),
  viewRadians: z.number().nullable(),
}).strict();

export const CanonicalEvent = z.object({
  eventKey: z.string().min(1).max(40),
  roundNumber: z.number().int().positive(),
  timeInRoundMs: NonNegativeInt,
  type: z.enum(['kill']),
  actorParticipantKey: z.string().min(1).max(40),
  targetParticipantKey: z.string().min(1).max(40),
  assistantParticipantKeys: z.array(z.string().min(1).max(40)),
  /** Victim position at the event, when the source provides it. PRIVATE. */
  spatial: CanonicalSpatialEvidence.nullable(),
}).strict();
export type CanonicalEvent = z.infer<typeof CanonicalEvent>;

export const CanonicalRound = z.object({
  roundNumber: z.number().int().positive(),
  winningTeamKey: z.string().min(1).max(20).nullable(),
  /** Explicit evidence only; null when the side is unknown. */
  attackingTeamKey: z.string().min(1).max(20).nullable(),
}).strict();
export type CanonicalRound = z.infer<typeof CanonicalRound>;

export const CanonicalMatch = z.object({
  schemaVersion: z.literal(CANONICAL_SCHEMA_VERSION),
  /** Provider-neutral canonical key (derived; internal). */
  matchKey: z.string().regex(/^cm_[0-9a-f]{24}$/u),
  source: SourceReference,
  evidence: EvidenceMetadata,
  mapId: z.string().min(1).max(64),
  mapName: z.string().min(1).max(40),
  mode: GameMode,
  startedAt: IsoInstant,
  durationSeconds: NonNegativeInt.nullable(),
  teams: z.array(CanonicalTeam).min(2),
  participants: z.array(CanonicalParticipant).min(2),
  rounds: z.array(CanonicalRound),
  events: z.array(CanonicalEvent),
  rankContextRefs: z.array(z.string().min(1).max(80)),
}).strict();
export type CanonicalMatch = z.infer<typeof CanonicalMatch>;

export const RankContext = z.object({
  rankContextId: z.string().min(1).max(80),
  memberId: InternalId,
  /** pre-match = observed for that match; current / peak = account-level context. Rank is CONTEXT, never a weight. */
  kind: z.enum(['pre-match', 'current', 'peak']),
  observedAt: IsoInstant,
  tierId: z.number().int().nonnegative().nullable(),
  tierName: z.string().min(1).max(40).nullable(),
  providerId: z.string().min(1).max(40),
}).strict();
export type RankContext = z.infer<typeof RankContext>;
