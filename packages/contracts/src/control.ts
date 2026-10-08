import { z } from 'zod';
import { InternalId, IsoInstant } from './common.ts';

/**
 * Control-plane contracts: groups, membership, source accounts, consent, invites and sync-job METADATA.
 * Nothing here carries match telemetry (rounds, events, positions, analytics evidence) — that stays in the local
 * canonical store. See docs/CONTROL_PLANE_DESIGN.md.
 */
export const Group = z.object({
  groupId: InternalId,
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/u),
  name: z.string().min(1).max(80),
  visibility: z.enum(['private', 'invite-only']),
  createdAt: IsoInstant,
}).strict();
export type Group = z.infer<typeof Group>;

export const GroupMember = z.object({
  memberId: InternalId,
  groupId: InternalId,
  displayName: z.string().min(1).max(40),
  status: z.enum(['active', 'left']),
  joinedAt: IsoInstant,
}).strict();
export type GroupMember = z.infer<typeof GroupMember>;

/**
 * A provider account linked to a member. `providerAccountRef` is PRIVATE (e.g. a provider's account id).
 * A member may have several accounts; at most one is primary.
 */
export const SourceAccount = z.object({
  accountId: InternalId,
  memberId: InternalId,
  providerId: z.string().min(1).max(40),
  providerAccountRef: z.string().min(1).max(200),
  isPrimary: z.boolean(),
  linkedAt: IsoInstant,
}).strict();
export type SourceAccount = z.infer<typeof SourceAccount>;

/**
 * Consent is four independent grants, never one boolean:
 *  identityConnected            — the member linked a source identity
 *  dataCollectionAllowed        — the collector may fetch and store their match evidence locally
 *  groupVisibilityAllowed       — group members may see their derived analytics
 *  publicDerivedAnalyticsAllowed — derived (never raw) analytics may appear in a published snapshot
 *
 * `status`:
 *  explicit                 — the grants were given explicitly by the member (control plane / demo fixture)
 *  requires-reconciliation  — consent is NOT known (e.g. imported legacy evidence). Every grant is false (deny by
 *                             default) until reconciled; evidence presence is never consent.
 */
export const ConsentStatus = z.enum(['explicit', 'requires-reconciliation']);
export const ConsentState = z.object({
  memberId: InternalId,
  status: ConsentStatus,
  source: z.string().min(1).max(60),
  identityConnected: z.boolean(),
  dataCollectionAllowed: z.boolean(),
  groupVisibilityAllowed: z.boolean(),
  publicDerivedAnalyticsAllowed: z.boolean(),
  policyVersion: z.string().min(1).max(40),
  updatedAt: IsoInstant,
}).strict().superRefine((c, ctx) => {
  if (c.status === 'requires-reconciliation' && (c.identityConnected || c.dataCollectionAllowed || c.groupVisibilityAllowed || c.publicDerivedAnalyticsAllowed)) {
    ctx.addIssue({ code: 'custom', message: 'unreconciled consent grants nothing' });
  }
});
export type ConsentState = z.infer<typeof ConsentState>;

export const Invite = z.object({
  inviteId: InternalId,
  groupId: InternalId,
  createdBy: InternalId,
  status: z.enum(['open', 'accepted', 'expired', 'revoked']),
  createdAt: IsoInstant,
  expiresAt: IsoInstant,
}).strict();
export type Invite = z.infer<typeof Invite>;

/** Sync-job metadata only: the local collector polls OUTBOUND for pending jobs; no telemetry travels here. */
export const SyncJob = z.object({
  jobId: InternalId,
  groupId: InternalId,
  memberId: InternalId,
  status: z.enum(['pending', 'claimed', 'succeeded', 'failed']),
  requestedAt: IsoInstant,
  updatedAt: IsoInstant,
  summary: z.object({ matchesIngested: z.number().int().nonnegative() }).strict().nullable(),
}).strict();
export type SyncJob = z.infer<typeof SyncJob>;

// ---------------------------------------------------------------------------------------------------------------
// control-plane-v1 (V2-CONSENT-CONTROL-PLANE-01): product-facing control-plane contracts. The storage records (invite
// token hashes, provider subjects, lease tokens) live inside apps/control-api and are never part of these shapes.
// ---------------------------------------------------------------------------------------------------------------

export const GroupVisibilityV1 = z.enum(['PRIVATE', 'INVITE_ONLY']);
export const GroupRole = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export const MembershipState = z.enum(['INVITED', 'ACTIVE', 'LEFT', 'REMOVED']);
export const IdentityProviderKind = z.enum(['RIOT', 'DISCORD']);
export const IdentityConnectionStatus = z.enum(['PENDING', 'VERIFIED', 'DISCONNECTED']);
export const ConsentGrantName = z.enum(['IDENTITY_CONNECTED', 'DATA_COLLECTION_ALLOWED', 'GROUP_VISIBILITY_ALLOWED', 'PUBLIC_DERIVED_ANALYTICS_ALLOWED']);
export type ConsentGrantName = z.infer<typeof ConsentGrantName>;
export const SyncJobState = z.enum(['PENDING', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'BLOCKED_CONSENT']);
export type SyncJobState = z.infer<typeof SyncJobState>;

/** The four grants. Every grant defaults to false (DENY); none is ever inferred. */
export const ConsentGrants = z.object({
  IDENTITY_CONNECTED: z.boolean(),
  DATA_COLLECTION_ALLOWED: z.boolean(),
  GROUP_VISIBILITY_ALLOWED: z.boolean(),
  PUBLIC_DERIVED_ANALYTICS_ALLOWED: z.boolean(),
}).strict();
export type ConsentGrants = z.infer<typeof ConsentGrants>;

/**
 * Legacy consent reconciliation. A record states what AUTHORITATIVE evidence says about an imported member's consent;
 * it never grants anything by itself (a SUPPORTED record still needs an explicit grant by the member).
 */
export const ReconciliationState = z.enum(['PENDING', 'SUPPORTED', 'UNSUPPORTED', 'CONFLICT', 'REQUIRES_RECONSENT']);
export const ConsentReconciliationRecord = z.object({
  recordId: InternalId,
  /** Internal data-plane member reference (never a provider id). */
  subjectRef: InternalId,
  importSource: z.string().min(1).max(80),
  state: ReconciliationState,
  /** Code labels only, e.g. NO_AUTHORITATIVE_CONSENT_EVIDENCE. */
  evidenceCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u)).max(10),
  decidedAt: IsoInstant,
  decidedBy: z.string().min(1).max(60),
}).strict();
export type ConsentReconciliationRecord = z.infer<typeof ConsentReconciliationRecord>;

/**
 * Control plane → local data plane instruction (polled OUTBOUND by the collector). The data plane enforces it; the
 * control plane never touches canonical telemetry.
 */
export const RevocationScope = z.enum(['STOP_FUTURE_SYNC', 'EXCLUDE_FROM_PUBLICATION', 'ERASE_ATTRIBUTABLE_SPATIAL_EVIDENCE']);
export const DataRevocationRequested = z.object({
  type: z.literal('DataRevocationRequested'),
  eventId: InternalId,
  groupId: InternalId,
  /** The membership whose data-plane member record is affected. */
  membershipId: InternalId,
  revokedGrants: z.array(ConsentGrantName).min(1),
  scopes: z.array(RevocationScope).min(1),
  requestedAt: IsoInstant,
}).strict();
export type DataRevocationRequested = z.infer<typeof DataRevocationRequested>;

/** Deterministic publication eligibility of one membership (codes explain every denial). */
export const PublicationEligibility = z.object({
  membershipId: InternalId,
  eligible: z.boolean(),
  reasons: z.array(z.enum(['MEMBERSHIP_NOT_ACTIVE', 'GROUP_ARCHIVED', 'CONSENT_REQUIRES_RECONCILIATION', 'GROUP_VISIBILITY_NOT_ALLOWED',
    'PUBLIC_DERIVED_ANALYTICS_NOT_ALLOWED', 'DATA_COLLECTION_NOT_ALLOWED', 'IDENTITY_NOT_CONNECTED'])),
}).strict();
export type PublicationEligibility = z.infer<typeof PublicationEligibility>;

// Views for a future UI. No token, token hash, provider subject, lease token or audit internals.
export const MyGroupsView = z.object({
  groups: z.array(z.object({ groupId: InternalId, name: z.string().min(1).max(80), visibility: GroupVisibilityV1, archived: z.boolean(), role: GroupRole,
    membershipState: MembershipState }).strict()),
}).strict();
export const GroupMembersView = z.object({
  groupId: InternalId,
  members: z.array(z.object({ membershipId: InternalId, displayName: z.string().min(1).max(40), role: GroupRole, state: MembershipState }).strict()),
}).strict();
/** Before acceptance an invite reveals only whether it can be accepted — never the group's name, members or owner. */
export const InviteView = z.object({ acceptable: z.boolean() }).strict();
export const ConsentSettingsView = z.object({
  groupId: InternalId,
  status: z.enum(['EXPLICIT', 'REQUIRES_RECONCILIATION']),
  grants: ConsentGrants,
  policyVersion: z.string().min(1).max(40).nullable(),
  identityConnections: z.array(z.object({ connectionId: InternalId, provider: IdentityProviderKind, status: IdentityConnectionStatus, verifiedAt: IsoInstant.nullable() }).strict()),
  publicationEligible: z.boolean(),
}).strict();
export const SyncStatusView = z.object({
  jobId: InternalId,
  state: SyncJobState,
  requestedAt: IsoInstant,
  updatedAt: IsoInstant,
  blockedReasons: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u)),
  matchesIngested: z.number().int().nonnegative().nullable(),
}).strict();
export type MyGroupsView = z.infer<typeof MyGroupsView>;
export type GroupMembersView = z.infer<typeof GroupMembersView>;
export type InviteView = z.infer<typeof InviteView>;
export type ConsentSettingsView = z.infer<typeof ConsentSettingsView>;
export type SyncStatusView = z.infer<typeof SyncStatusView>;
