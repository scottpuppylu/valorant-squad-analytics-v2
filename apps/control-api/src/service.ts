import type { ConsentState, Group, GroupMember, Invite, SyncJob } from '@vsa/contracts/control';

/**
 * The control-plane service contract. A future deployment may host it in the cloud; it stores ONLY metadata
 * (groups, members, invites, consent, sync-job status). Match telemetry is never sent here: the local collector polls
 * OUTBOUND for pending jobs, fetches provider data locally and reports only a job summary back.
 */
export type ConsentGrant = 'identityConnected' | 'dataCollectionAllowed' | 'groupVisibilityAllowed' | 'publicDerivedAnalyticsAllowed';

export interface ControlPlaneService {
  createGroup(input: { name: string; slug: string; ownerDisplayName: string }): Promise<{ group: Group; owner: GroupMember }>;
  createInvite(input: { groupId: string; createdBy: string; ttlHours: number }): Promise<Invite>;
  acceptInvite(input: { inviteId: string; displayName: string }): Promise<GroupMember>;
  /** Direct join for an already-authorized flow (e.g. owner adding themselves elsewhere); invites are the normal path. */
  joinGroup(input: { groupId: string; displayName: string }): Promise<GroupMember>;
  grantConsent(input: { memberId: string; grants: readonly ConsentGrant[]; policyVersion: string }): Promise<ConsentState>;
  /** Revoking identity or collection also revokes everything that depends on it. */
  revokeConsent(input: { memberId: string; grants: readonly ConsentGrant[] }): Promise<ConsentState>;
  requestSync(input: { groupId: string; memberId: string }): Promise<SyncJob>;
  getSyncStatus(jobId: string): Promise<SyncJob | null>;
  /** Collector side (outbound poll): claim pending jobs and report a summary — never telemetry. */
  claimPendingJobs(limit: number): Promise<SyncJob[]>;
  completeJob(input: { jobId: string; status: 'succeeded' | 'failed'; matchesIngested: number }): Promise<SyncJob>;
}
