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
