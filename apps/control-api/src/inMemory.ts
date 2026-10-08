import { ConsentState, Group, GroupMember, Invite, SyncJob } from '@vsa/contracts/control';
import type { ConsentGrant, ControlPlaneService } from './service.ts';

/**
 * Reference implementation in memory (tests and local design only — not a deployment). Deterministic ids via a
 * counter and an injected clock.
 */
export class InMemoryControlPlane implements ControlPlaneService {
  private readonly groups = new Map<string, Group>();
  private readonly members = new Map<string, GroupMember>();
  private readonly invites = new Map<string, Invite>();
  private readonly consents = new Map<string, ConsentState>();
  private readonly jobs = new Map<string, SyncJob>();
  private counter = 0;
  private readonly now: () => Date;
  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  private id(prefix: string) { this.counter += 1; return `${prefix}-${String(this.counter).padStart(6, '0')}`; }
  private iso(offsetMs = 0) { return new Date(this.now().getTime() + offsetMs).toISOString(); }

  private addMember(groupId: string, displayName: string): GroupMember {
    if (!this.groups.has(groupId)) throw new Error('unknown group');
    const member = GroupMember.parse({ memberId: this.id('member'), groupId, displayName, status: 'active', joinedAt: this.iso() });
    this.members.set(member.memberId, member);
    // Joining grants NOTHING: every consent starts false and must be granted explicitly.
    this.consents.set(member.memberId, ConsentState.parse({ memberId: member.memberId, identityConnected: false, dataCollectionAllowed: false,
      groupVisibilityAllowed: false, publicDerivedAnalyticsAllowed: false, policyVersion: 'none', updatedAt: this.iso() }));
    return member;
  }

  async createGroup(input: { name: string; slug: string; ownerDisplayName: string }) {
    const group = Group.parse({ groupId: this.id('group'), slug: input.slug, name: input.name, visibility: 'invite-only', createdAt: this.iso() });
    this.groups.set(group.groupId, group);
    return { group, owner: this.addMember(group.groupId, input.ownerDisplayName) };
  }

  async createInvite(input: { groupId: string; createdBy: string; ttlHours: number }) {
    const creator = this.members.get(input.createdBy);
    if (!creator || creator.groupId !== input.groupId || creator.status !== 'active') throw new Error('only an active member can invite');
    const invite = Invite.parse({ inviteId: this.id('invite'), groupId: input.groupId, createdBy: input.createdBy, status: 'open',
      createdAt: this.iso(), expiresAt: this.iso(input.ttlHours * 3_600_000) });
    this.invites.set(invite.inviteId, invite);
    return invite;
  }

  async acceptInvite(input: { inviteId: string; displayName: string }) {
    const invite = this.invites.get(input.inviteId);
    if (!invite || invite.status !== 'open') throw new Error('invite is not open');
    if (new Date(invite.expiresAt).getTime() <= this.now().getTime()) {
      this.invites.set(invite.inviteId, { ...invite, status: 'expired' });
      throw new Error('invite expired');
    }
    this.invites.set(invite.inviteId, { ...invite, status: 'accepted' });
    return this.addMember(invite.groupId, input.displayName);
  }

  async joinGroup(input: { groupId: string; displayName: string }) {
    return this.addMember(input.groupId, input.displayName);
  }

  private setConsent(memberId: string, update: Partial<Record<ConsentGrant, boolean>>, policyVersion?: string): ConsentState {
    const current = this.consents.get(memberId);
    if (!current) throw new Error('unknown member');
    let next = { ...current, ...update, updatedAt: this.iso(), ...(policyVersion ? { policyVersion } : {}) };
    // Dependencies: no collection without identity; no visibility without collection; no public without visibility.
    if (!next.identityConnected) next = { ...next, dataCollectionAllowed: false };
    if (!next.dataCollectionAllowed) next = { ...next, groupVisibilityAllowed: false };
    if (!next.groupVisibilityAllowed) next = { ...next, publicDerivedAnalyticsAllowed: false };
    const parsed = ConsentState.parse(next);
    this.consents.set(memberId, parsed);
    return parsed;
  }

  async grantConsent(input: { memberId: string; grants: readonly ConsentGrant[]; policyVersion: string }) {
    const current = this.consents.get(input.memberId);
    if (!current) throw new Error('unknown member');
    const order: ConsentGrant[] = ['identityConnected', 'dataCollectionAllowed', 'groupVisibilityAllowed', 'publicDerivedAnalyticsAllowed'];
    const state = { ...current, ...Object.fromEntries(input.grants.map((g) => [g, true])) };
    for (let i = 1; i < order.length; i += 1) if (state[order[i]!] && !state[order[i - 1]!]) throw new Error(`${order[i]} requires ${order[i - 1]}`);
    return this.setConsent(input.memberId, Object.fromEntries(input.grants.map((g) => [g, true])), input.policyVersion);
  }

  async revokeConsent(input: { memberId: string; grants: readonly ConsentGrant[] }) {
    return this.setConsent(input.memberId, Object.fromEntries(input.grants.map((g) => [g, false])));
  }

  async requestSync(input: { groupId: string; memberId: string }) {
    const member = this.members.get(input.memberId);
    if (!member || member.groupId !== input.groupId) throw new Error('unknown member');
    if (this.consents.get(input.memberId)?.dataCollectionAllowed !== true) throw new Error('data collection consent required');
    const job = SyncJob.parse({ jobId: this.id('job'), groupId: input.groupId, memberId: input.memberId, status: 'pending', requestedAt: this.iso(), updatedAt: this.iso(), summary: null });
    this.jobs.set(job.jobId, job);
    return job;
  }

  async getSyncStatus(jobId: string) { return this.jobs.get(jobId) ?? null; }

  async claimPendingJobs(limit: number) {
    const claimed = [...this.jobs.values()].filter((j) => j.status === 'pending').slice(0, Math.max(0, Math.min(limit, 20)))
      .map((j) => SyncJob.parse({ ...j, status: 'claimed', updatedAt: this.iso() }));
    for (const job of claimed) this.jobs.set(job.jobId, job);
    return claimed;
  }

  async completeJob(input: { jobId: string; status: 'succeeded' | 'failed'; matchesIngested: number }) {
    const job = this.jobs.get(input.jobId);
    if (!job || job.status !== 'claimed') throw new Error('job is not claimed');
    const done = SyncJob.parse({ ...job, status: input.status, updatedAt: this.iso(), summary: { matchesIngested: input.matchesIngested } });
    this.jobs.set(done.jobId, done);
    return done;
  }
}
