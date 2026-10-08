import type {
  ConsentGrantName, ConsentGrants, ConsentReconciliationRecord, DataRevocationRequested, PublicationEligibility, SyncJobState,
} from '@vsa/contracts/control';
import { digestEquals, hashSecret, newId, newSecret } from './crypto.ts';
import { publicationEligibility, syncBlockReasons } from './eligibility.ts';
import { ControlPlaneError, deny } from './errors.ts';
import type { IdentityProvider } from './identity.ts';
import {
  GRANT_ORDER, JOB_TRANSITIONS, MEMBERSHIP_TRANSITIONS, NO_GRANTS, TERMINAL_JOB_STATES, type AuditAction, type ConsentRecord, type GroupRecord,
  type IdentityConnectionRecord, type InviteRecord, type MembershipRecord, type MembershipStateName, type Principal, type Role, type SyncJobRecord, type UserRecord,
} from './model.ts';
import type { ControlPlaneRepository, ControlPlaneStore } from './repository.ts';

export const INVITE_DEFAULT_TTL_HOURS = 72;
export const INVITE_MAX_TTL_HOURS = 168;
export const LEASE_DEFAULT_MS = 60_000;
export const LEASE_MAX_MS = 300_000;
export const MAX_POLL_JOBS = 20;
/** Grants a member may set explicitly. IDENTITY_CONNECTED is a verified fact set only by an identity connection. */
export type ExplicitGrant = Exclude<ConsentGrantName, 'IDENTITY_CONNECTED'>;
const EXPLICIT_GRANTS: readonly ExplicitGrant[] = ['DATA_COLLECTION_ALLOWED', 'GROUP_VISIBILITY_ALLOWED', 'PUBLIC_DERIVED_ANALYTICS_ALLOWED'];

const ROLE_RANK: Readonly<Record<Role, number>> = Object.freeze({ OWNER: 0, ADMIN: 1, MEMBER: 2 });
const NAME = /^[^\p{Cc}]{1,80}$/u;
const DISPLAY = /^[^\p{Cc}]{1,40}$/u;
const POLICY = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;

export interface ControlPlaneOptions {
  repository: ControlPlaneRepository;
  identityProviders: readonly IdentityProvider[];
  now?: () => Date;
}

/**
 * control-plane-v1 domain service. Every command takes the authenticated Principal from the transport and enforces
 * authorization HERE (never only in a UI). It stores metadata only, never calls a game-data provider, and reaches the
 * local data plane only through outbound-polled job and revocation records.
 */
export class ControlPlaneService {
  private readonly repo: ControlPlaneRepository;
  private readonly providers: ReadonlyMap<string, IdentityProvider>;
  private readonly now: () => Date;

  constructor(options: ControlPlaneOptions) {
    this.repo = options.repository;
    this.providers = new Map(options.identityProviders.map((p) => [p.provider, p]));
    this.now = options.now ?? (() => new Date());
  }

  private iso(offsetMs = 0): string { return new Date(this.now().getTime() + offsetMs).toISOString(); }

  /** Run a command; authorization / invite failures are audited in a separate transaction (the command's writes roll back). */
  private async command<T>(principal: Principal, action: AuditAction, groupId: string | null, work: (s: ControlPlaneStore) => T): Promise<T> {
    try {
      return await this.repo.transact(work);
    } catch (error) {
      if (error instanceof ControlPlaneError && ['FORBIDDEN', 'UNAUTHENTICATED', 'INVITE_INVALID', 'GROUP_ARCHIVED'].includes(error.code)) {
        await this.repo.transact((s) => this.audit(s, principal, error.code === 'INVITE_INVALID' ? 'INVITE_REJECTED' : 'AUTHORIZATION_DENIED', groupId, null, 'DENIED',
          [error.code, action]));
      }
      throw error;
    }
  }

  private audit(s: ControlPlaneStore, principal: Principal, action: AuditAction, groupId: string | null, targetRef: string | null, outcome: 'SUCCESS' | 'DENIED', codes: string[] = []) {
    const actorRef = principal.kind === 'USER' ? principal.userId : principal.kind === 'WORKER' ? principal.workerId : `system:${principal.reason}`;
    s.appendAudit({ auditId: newId('aud'), at: this.iso(), actorKind: principal.kind, actorRef: /^[a-z0-9:_-]{3,80}$/u.test(actorRef) ? actorRef : 'redacted', action, groupId,
      targetRef, outcome, codes: codes.filter((c) => CODE.test(c)).slice(0, 10) });
  }

  // ------------------------------------------------------------------ authorization helpers
  private user(s: ControlPlaneStore, principal: Principal): UserRecord {
    if (principal.kind !== 'USER') deny('UNAUTHENTICATED', 'a user principal is required');
    const user = s.getUser((principal as { userId: string }).userId);
    if (!user || user.status !== 'ACTIVE') deny('UNAUTHENTICATED', 'unknown or disabled user');
    return user!;
  }
  private group(s: ControlPlaneStore, groupId: string, forWrite: boolean): GroupRecord {
    const group = s.getGroup(groupId);
    if (!group) deny('FORBIDDEN', 'not a member of this group'); // no existence oracle
    if (forWrite && group!.status !== 'ACTIVE') deny('GROUP_ARCHIVED', 'group is archived');
    return group!;
  }
  private activeMembership(s: ControlPlaneStore, groupId: string, userId: string): MembershipRecord {
    const m = s.findMembership(groupId, userId);
    if (!m || m.state !== 'ACTIVE') deny('FORBIDDEN', 'not an active member of this group');
    return m!;
  }
  private requireRole(m: MembershipRecord, roles: readonly Role[]): void {
    if (!roles.includes(m.role)) deny('FORBIDDEN', `requires role ${roles.join('|')}`);
  }
  private moveMembership(m: MembershipRecord, next: MembershipStateName): MembershipRecord {
    if (!MEMBERSHIP_TRANSITIONS[m.state].includes(next)) deny('INVALID_STATE', `membership ${m.state} → ${next} not allowed`);
    return { ...m, state: next, updatedAt: this.iso() };
  }
  private moveJob(job: SyncJobRecord, next: SyncJobState): SyncJobRecord {
    if (!JOB_TRANSITIONS[job.state].includes(next)) deny('INVALID_STATE', `job ${job.state} → ${next} not allowed`);
    return { ...job, state: next, updatedAt: this.iso() };
  }

  // ------------------------------------------------------------------ users
  /** Registers a product user. In a deployment this follows product sign-in; here it is an explicit local command. */
  async registerUser(principal: Principal, input: { displayName: string }): Promise<UserRecord> {
    if (principal.kind !== 'SYSTEM') deny('FORBIDDEN', 'user registration is a system command');
    if (!DISPLAY.test(input.displayName)) deny('VALIDATION', 'invalid display name');
    return this.repo.transact((s) => {
      const user: UserRecord = { userId: newId('usr'), displayName: input.displayName, status: 'ACTIVE', createdAt: this.iso() };
      s.putUser(user);
      this.audit(s, principal, 'USER_REGISTERED', null, user.userId, 'SUCCESS');
      return user;
    });
  }

  // ------------------------------------------------------------------ groups
  async createGroup(principal: Principal, input: { name: string; visibility?: 'PRIVATE' | 'INVITE_ONLY' }): Promise<{ group: GroupRecord; membership: MembershipRecord }> {
    if (!NAME.test(input.name)) deny('VALIDATION', 'invalid group name');
    const visibility = input.visibility ?? 'INVITE_ONLY';
    if (visibility !== 'PRIVATE' && visibility !== 'INVITE_ONLY') deny('VALIDATION', 'unsupported visibility (no public groups in control-plane-v1)');
    return this.command(principal, 'GROUP_CREATED', null, (s) => {
      const user = this.user(s, principal);
      const group: GroupRecord = { groupId: newId('grp'), name: input.name, visibility, status: 'ACTIVE', createdBy: user.userId, createdAt: this.iso(), archivedAt: null };
      s.putGroup(group);
      const membership = this.addMembership(s, group.groupId, user.userId, 'OWNER', 'ACTIVE');
      this.audit(s, principal, 'GROUP_CREATED', group.groupId, group.groupId, 'SUCCESS', [visibility]);
      return { group, membership };
    });
  }

  async renameGroup(principal: Principal, input: { groupId: string; name: string }): Promise<GroupRecord> {
    if (!NAME.test(input.name)) deny('VALIDATION', 'invalid group name');
    return this.command(principal, 'GROUP_RENAMED', input.groupId, (s) => {
      const user = this.user(s, principal);
      const group = this.group(s, input.groupId, true);
      this.requireRole(this.activeMembership(s, group.groupId, user.userId), ['OWNER']);
      const next = { ...group, name: input.name };
      s.putGroup(next);
      this.audit(s, principal, 'GROUP_RENAMED', group.groupId, group.groupId, 'SUCCESS');
      return next;
    });
  }

  /** Archive: the group becomes read-only for its members; every mutating command fails with GROUP_ARCHIVED. Idempotent. */
  async archiveGroup(principal: Principal, input: { groupId: string }): Promise<GroupRecord> {
    return this.command(principal, 'GROUP_ARCHIVED', input.groupId, (s) => {
      const user = this.user(s, principal);
      const group = this.group(s, input.groupId, false);
      this.requireRole(this.activeMembership(s, group.groupId, user.userId), ['OWNER']);
      if (group.status === 'ARCHIVED') return group;
      const next: GroupRecord = { ...group, status: 'ARCHIVED', archivedAt: this.iso() };
      s.putGroup(next);
      for (const job of s.listJobs().filter((j) => j.groupId === group.groupId && !TERMINAL_JOB_STATES.has(j.state))) s.putJob({ ...this.moveJob(job, 'CANCELLED'), leaseOwner: null });
      this.audit(s, principal, 'GROUP_ARCHIVED', group.groupId, group.groupId, 'SUCCESS');
      return next;
    });
  }

  async listGroups(principal: Principal): Promise<{ group: GroupRecord; membership: MembershipRecord }[]> {
    return this.repo.read((s) => {
      const user = this.user(s, principal);
      return s.listMembershipsByUser(user.userId).filter((m) => m.state === 'ACTIVE').map((membership) => ({ group: s.getGroup(membership.groupId)!, membership }))
        .sort((a, b) => (a.group.createdAt + a.group.groupId < b.group.createdAt + b.group.groupId ? -1 : 1));
    });
  }

  /** Active members (and pending INVITED addressees for OWNER / ADMIN). Readable in archived groups. */
  async listMembers(principal: Principal, input: { groupId: string }): Promise<{ membership: MembershipRecord; displayName: string }[]> {
    return this.command(principal, 'AUTHORIZATION_DENIED', input.groupId, (s) => {
      const user = this.user(s, principal);
      const group = this.group(s, input.groupId, false);
      const me = this.activeMembership(s, group.groupId, user.userId);
      const visible = new Set<MembershipStateName>(me.role === 'MEMBER' ? ['ACTIVE'] : ['ACTIVE', 'INVITED']);
      return s.listMembershipsByGroup(group.groupId).filter((m) => visible.has(m.state))
        .map((membership) => ({ membership, displayName: s.getUser(membership.userId)?.displayName ?? 'unknown' }))
        .sort((a, b) => ROLE_RANK[a.membership.role] - ROLE_RANK[b.membership.role] || (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0)
          || (a.membership.membershipId < b.membership.membershipId ? -1 : 1));
    });
  }

  /** OWNER only: promote / demote between ADMIN and MEMBER (there is exactly one OWNER; ownership transfer is out of scope). */
  async changeRole(principal: Principal, input: { groupId: string; membershipId: string; role: 'ADMIN' | 'MEMBER' }): Promise<MembershipRecord> {
    return this.command(principal, 'ROLE_CHANGED', input.groupId, (s) => {
      const user = this.user(s, principal);
      const group = this.group(s, input.groupId, true);
      this.requireRole(this.activeMembership(s, group.groupId, user.userId), ['OWNER']);
      const target = s.getMembership(input.membershipId);
      if (!target || target.groupId !== group.groupId || target.state !== 'ACTIVE') deny('NOT_FOUND', 'membership not found');
      if (target!.role === 'OWNER') deny('FORBIDDEN', 'the owner role cannot be changed');
      if (input.role !== 'ADMIN' && input.role !== 'MEMBER') deny('VALIDATION', 'invalid role');
      if (target!.role === input.role) return target!;
      const next = { ...target!, role: input.role, updatedAt: this.iso() };
      s.putMembership(next);
      this.audit(s, principal, 'ROLE_CHANGED', group.groupId, next.membershipId, 'SUCCESS', [input.role]);
      return next;
    });
  }

  /** OWNER removes ADMIN / MEMBER; ADMIN removes MEMBER only. Removal never grants or deletes consent; it ends eligibility. */
  async removeMember(principal: Principal, input: { groupId: string; membershipId: string }): Promise<MembershipRecord> {
    return this.command(principal, 'MEMBERSHIP_REMOVED', input.groupId, (s) => {
      const user = this.user(s, principal);
      const group = this.group(s, input.groupId, true);
      const me = this.activeMembership(s, group.groupId, user.userId);
      this.requireRole(me, ['OWNER', 'ADMIN']);
      const target = s.getMembership(input.membershipId);
      if (!target || target.groupId !== group.groupId) deny('NOT_FOUND', 'membership not found');
      if (target!.state === 'REMOVED') return target!;
      if (target!.role === 'OWNER' || (me.role === 'ADMIN' && target!.role !== 'MEMBER')) deny('FORBIDDEN', 'insufficient role to remove this member');
      const next = this.moveMembership(target!, 'REMOVED');
      s.putMembership(next);
      this.blockOpenJobs(s, principal, next.membershipId, ['MEMBERSHIP_NOT_ACTIVE']);
      this.audit(s, principal, 'MEMBERSHIP_REMOVED', group.groupId, next.membershipId, 'SUCCESS');
      return next;
    });
  }

  async leaveGroup(principal: Principal, input: { groupId: string }): Promise<MembershipRecord> {
    return this.command(principal, 'MEMBERSHIP_LEFT', input.groupId, (s) => {
      const user = this.user(s, principal);
      const group = this.group(s, input.groupId, false);
      const me = this.activeMembership(s, group.groupId, user.userId);
      if (me.role === 'OWNER') deny('INVALID_STATE', 'the owner cannot leave (archive the group instead)');
      const next = this.moveMembership(me, 'LEFT');
      s.putMembership(next);
      this.blockOpenJobs(s, principal, next.membershipId, ['MEMBERSHIP_NOT_ACTIVE']);
      this.audit(s, principal, 'MEMBERSHIP_LEFT', group.groupId, next.membershipId, 'SUCCESS');
      return next;
    });
  }

  private addMembership(s: ControlPlaneStore, groupId: string, userId: string, role: Role, state: 'ACTIVE' | 'INVITED'): MembershipRecord {
    const existing = s.findMembership(groupId, userId);
    const membership: MembershipRecord = existing
      ? { ...this.moveMembership(existing, state === 'ACTIVE' ? 'ACTIVE' : existing.state), role: existing.role === 'OWNER' ? 'OWNER' : role }
      : { membershipId: newId('mbr'), groupId, userId, role, state, createdAt: this.iso(), updatedAt: this.iso() };
    s.putMembership(membership);
    const identityFact = s.listConnectionsByUser(userId).some((c) => c.provider === 'RIOT' && c.status === 'VERIFIED');
    const previous = s.getConsent(membership.membershipId);
    if (previous && existing && (existing.state === 'LEFT' || existing.state === 'REMOVED')) {
      // Re-joining never revives old permissions: consent restarts at DENY (plus the verified identity fact).
      const reset: ConsentRecord = { ...previous, status: 'EXPLICIT', grants: { ...NO_GRANTS, IDENTITY_CONNECTED: identityFact }, policyVersion: null, updatedAt: this.iso(), version: previous.version + 1 };
      s.putConsent(reset);
      s.appendConsentTransition({ transitionId: newId('ctr'), membershipId: membership.membershipId, actor: userId, at: this.iso(), source: 'membership-rejoined-reset',
        previous: previous.grants, next: reset.grants });
    }
    if (!previous) {
      // Membership never implies consent: a new consent record is all-DENY except the verified identity fact.
      const identity = identityFact;
      const consent: ConsentRecord = { membershipId: membership.membershipId, groupId, userId, status: 'EXPLICIT', grants: { ...NO_GRANTS, IDENTITY_CONNECTED: identity },
        policyVersion: null, updatedAt: this.iso(), version: 1 };
      s.putConsent(consent);
      if (identity) s.appendConsentTransition({ transitionId: newId('ctr'), membershipId: membership.membershipId, actor: userId, at: this.iso(), source: 'identity-connection-fact',
        previous: NO_GRANTS, next: consent.grants });
    }
    return membership;
  }

  // ------------------------------------------------------------------ invites
  /**
   * OWNER / ADMIN. Returns the raw 256-bit token ONCE; only its domain-separated SHA-256 is stored. An addressed invite
   * (`forUserId`) creates an INVITED membership until acceptance or revocation.
   */
  async createInvite(principal: Principal, input: { groupId: string; ttlHours?: number; forUserId?: string }): Promise<{ invite: Omit<InviteRecord, 'tokenHash'>; token: string }> {
    const ttl = input.ttlHours ?? INVITE_DEFAULT_TTL_HOURS;
    if (!(ttl > 0 && ttl <= INVITE_MAX_TTL_HOURS)) deny('VALIDATION', `ttlHours must be in (0, ${INVITE_MAX_TTL_HOURS}]`);
    const token = newSecret();
    const invite = await this.command(principal, 'INVITE_CREATED', input.groupId, (s) => {
      const user = this.user(s, principal);
      const group = this.group(s, input.groupId, true);
      this.requireRole(this.activeMembership(s, group.groupId, user.userId), ['OWNER', 'ADMIN']);
      if (input.forUserId !== undefined) {
        if (!s.getUser(input.forUserId)) deny('NOT_FOUND', 'user not found');
        const existing = s.findMembership(group.groupId, input.forUserId);
        if (existing?.state === 'ACTIVE') deny('INVALID_STATE', 'already an active member');
        if (!existing || existing.state === 'LEFT' || existing.state === 'REMOVED') {
          const m: MembershipRecord = existing ? { ...existing, state: 'INVITED', updatedAt: this.iso() } : { membershipId: newId('mbr'), groupId: group.groupId, userId: input.forUserId, role: 'MEMBER',
            state: 'INVITED', createdAt: this.iso(), updatedAt: this.iso() };
          s.putMembership(m);
        }
      }
      const record: InviteRecord = { inviteId: newId('inv'), groupId: group.groupId, createdBy: user.userId, tokenHash: hashSecret('invite-token-v1', token), forUserId: input.forUserId ?? null,
        status: 'OPEN', createdAt: this.iso(), expiresAt: this.iso(ttl * 3_600_000), acceptedBy: null, acceptedAt: null, revokedAt: null };
      s.putInvite(record);
      this.audit(s, principal, 'INVITE_CREATED', group.groupId, record.inviteId, 'SUCCESS', record.forUserId ? ['ADDRESSED'] : ['OPEN_LINK']);
      const { tokenHash: _hidden, ...publicInvite } = record;
      return publicInvite;
    });
    return { invite, token };
  }

  /** Looks up by hash, then compares digests in constant time. Unknown / expired / revoked / consumed are indistinguishable. */
  private inviteByToken(s: ControlPlaneStore, token: string): InviteRecord | null {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const hash = hashSecret('invite-token-v1', token);
    const invite = s.findInviteByTokenHash(hash);
    return invite && digestEquals(invite.tokenHash, hash) ? invite : null;
  }

  /** Pre-acceptance view: only "acceptable or not" — never the group's name, members, owner or expiry. */
  async previewInvite(principal: Principal, input: { token: string }): Promise<{ acceptable: boolean }> {
    return this.repo.read((s) => {
      this.user(s, principal);
      const invite = this.inviteByToken(s, input.token);
      return { acceptable: !!invite && invite.status === 'OPEN' && Date.parse(invite.expiresAt) > this.now().getTime() && s.getGroup(invite.groupId)?.status === 'ACTIVE' };
    });
  }

  /**
   * One-time acceptance. Idempotent for the SAME user (re-accepting an invite they already consumed returns their
   * membership with `alreadyAccepted: true`, no side effect); for anyone else a consumed invite is INVITE_INVALID.
   */
  async acceptInvite(principal: Principal, input: { token: string }): Promise<{ membership: MembershipRecord; alreadyAccepted: boolean }> {
    try {
      return await this.repo.transact((s) => {
        const user = this.user(s, principal);
        const invite = this.inviteByToken(s, input.token);
        if (!invite) deny('INVITE_INVALID', 'invite is not valid');
        const group = s.getGroup(invite!.groupId);
        if (invite!.status === 'ACCEPTED' && invite!.acceptedBy === user.userId) {
          const m = s.findMembership(invite!.groupId, user.userId)!;
          return { membership: m, alreadyAccepted: true };
        }
        if (invite!.status !== 'OPEN' || !group || group.status !== 'ACTIVE') deny('INVITE_INVALID', 'invite is not valid');
        if (Date.parse(invite!.expiresAt) <= this.now().getTime()) {
          // Expiry is recorded in its own transaction below (this one rolls back with the rejection).
          throw new ControlPlaneError('INVITE_INVALID', `expired:${invite!.inviteId}`);
        }
        if (invite!.forUserId !== null && invite!.forUserId !== user.userId) deny('INVITE_INVALID', 'invite is not valid');
        const existing = s.findMembership(invite!.groupId, user.userId);
        if (existing?.state === 'ACTIVE') deny('INVALID_STATE', 'already an active member');
        const membership = this.addMembership(s, invite!.groupId, user.userId, 'MEMBER', 'ACTIVE');
        s.putInvite({ ...invite!, status: 'ACCEPTED', acceptedBy: user.userId, acceptedAt: this.iso() });
        this.audit(s, principal, 'INVITE_ACCEPTED', invite!.groupId, invite!.inviteId, 'SUCCESS');
        return { membership, alreadyAccepted: false };
      });
    } catch (error) {
      if (error instanceof ControlPlaneError && error.code === 'INVITE_INVALID') {
        const expired = /^expired:(inv_[0-9a-f]{24})$/u.exec(error.message)?.[1];
        await this.repo.transact((s) => {
          if (expired) this.expireOne(s, expired);
          this.audit(s, principal, 'INVITE_REJECTED', null, null, 'DENIED', ['INVITE_INVALID']);
        });
        throw new ControlPlaneError('INVITE_INVALID', 'invite is not valid');
      }
      throw error;
    }
  }

  private expireOne(s: ControlPlaneStore, inviteId: string): void {
    const invite = s.getInvite(inviteId);
    if (!invite || invite.status !== 'OPEN') return;
    s.putInvite({ ...invite, status: 'EXPIRED' });
    this.releaseAddressee(s, invite);
    this.audit(s, { kind: 'SYSTEM', reason: 'invite-expiry' }, 'INVITE_EXPIRED', invite.groupId, invite.inviteId, 'SUCCESS');
  }

  private releaseAddressee(s: ControlPlaneStore, invite: InviteRecord): void {
    if (!invite.forUserId) return;
    const m = s.findMembership(invite.groupId, invite.forUserId);
    if (m?.state === 'INVITED') s.putMembership(this.moveMembership(m, 'REMOVED'));
  }

  /** OWNER / ADMIN. Idempotent: revoking a revoked invite returns it unchanged; accepted / expired invites cannot be revoked. */
  async revokeInvite(principal: Principal, input: { groupId: string; inviteId: string }): Promise<Omit<InviteRecord, 'tokenHash'>> {
    return this.command(principal, 'INVITE_REVOKED', input.groupId, (s) => {
      const user = this.user(s, principal);
      const group = this.group(s, input.groupId, true);
      this.requireRole(this.activeMembership(s, group.groupId, user.userId), ['OWNER', 'ADMIN']);
      const invite = s.getInvite(input.inviteId);
      if (!invite || invite.groupId !== group.groupId) deny('NOT_FOUND', 'invite not found');
      let next = invite!;
      if (invite!.status === 'OPEN') {
        next = { ...invite!, status: 'REVOKED', revokedAt: this.iso() };
        s.putInvite(next);
        this.releaseAddressee(s, invite!);
        this.audit(s, principal, 'INVITE_REVOKED', group.groupId, invite!.inviteId, 'SUCCESS');
      } else if (invite!.status !== 'REVOKED') deny('INVALID_STATE', `invite is ${invite!.status}`);
      const { tokenHash: _hidden, ...publicInvite } = next;
      return publicInvite;
    });
  }

  /** System sweep: OPEN invites past their expiry become EXPIRED. Returns the number expired. */
  async expireInvites(principal: Principal): Promise<number> {
    if (principal.kind !== 'SYSTEM') deny('FORBIDDEN', 'invite expiry is a system command');
    return this.repo.transact((s) => {
      const due = s.listInvites().filter((i) => i.status === 'OPEN' && Date.parse(i.expiresAt) <= this.now().getTime());
      for (const i of due) this.expireOne(s, i.inviteId);
      return due.length;
    });
  }

  // ------------------------------------------------------------------ identity connections (RSO-ready)
  async beginIdentityConnection(principal: Principal, input: { provider: 'RIOT' | 'DISCORD' }): Promise<{ connectionId: string; state: string; redirectUrl: string }> {
    const provider = this.providers.get(input.provider);
    if (!provider) deny('INVALID_STATE', 'identity provider not configured');
    const state = newSecret();
    const { redirectUrl } = provider!.authorizationRequest(state);
    const connectionId = await this.command(principal, 'IDENTITY_CONNECTION_STARTED', null, (s) => {
      const user = this.user(s, principal);
      const record: IdentityConnectionRecord = { connectionId: newId('idc'), userId: user.userId, provider: input.provider, providerSubject: null, status: 'PENDING',
        attemptStateHash: hashSecret('identity-state-v1', state), createdAt: this.iso(), verifiedAt: null, disconnectedAt: null };
      s.putConnection(record);
      this.audit(s, principal, 'IDENTITY_CONNECTION_STARTED', null, record.connectionId, 'SUCCESS', [input.provider]);
      return record.connectionId;
    });
    return { connectionId, state, redirectUrl };
  }

  async completeIdentityConnection(principal: Principal, input: { connectionId: string; state: string; code: string }): Promise<{ connectionId: string; provider: string; status: string; verifiedAt: string | null }> {
    const pending = await this.repo.read((s) => {
      const user = this.user(s, principal);
      const c = s.getConnection(input.connectionId);
      if (!c || c.userId !== user.userId || c.status !== 'PENDING' || !c.attemptStateHash) deny('FORBIDDEN', 'no pending connection');
      if (!digestEquals(c!.attemptStateHash!, hashSecret('identity-state-v1', input.state))) deny('FORBIDDEN', 'connection state mismatch');
      return c!;
    });
    const provider = this.providers.get(pending.provider);
    if (!provider) deny('INVALID_STATE', 'identity provider not configured');
    const { providerSubject } = await provider!.verifyCallback({ state: input.state, code: input.code });
    return this.command(principal, 'IDENTITY_CONNECTED', null, (s) => {
      const user = this.user(s, principal);
      const c = s.getConnection(pending.connectionId);
      if (!c || c.status !== 'PENDING' || c.userId !== user.userId) deny('INVALID_STATE', 'connection is no longer pending');
      const other = s.findVerifiedConnectionBySubject(c!.provider, providerSubject);
      if (other && other.userId !== user.userId) deny('IDENTITY_CONFLICT', 'this external identity is connected to another user');
      const verified: IdentityConnectionRecord = { ...c!, providerSubject, status: 'VERIFIED', attemptStateHash: null, verifiedAt: this.iso() };
      s.putConnection(verified);
      if (verified.provider === 'RIOT') {
        for (const consent of s.listConsentsByUser(user.userId).filter((x) => x.status === 'EXPLICIT' && !x.grants.IDENTITY_CONNECTED)) {
          this.writeConsent(s, user.userId, consent, { ...consent.grants, IDENTITY_CONNECTED: true }, 'identity-connection-fact', consent.policyVersion);
        }
      }
      this.audit(s, principal, 'IDENTITY_CONNECTED', null, verified.connectionId, 'SUCCESS', [verified.provider]);
      return { connectionId: verified.connectionId, provider: verified.provider, status: verified.status, verifiedAt: verified.verifiedAt };
    });
  }

  /** Disconnecting the last verified RIOT identity clears IDENTITY_CONNECTED, which cascades and emits revocation events. */
  async disconnectIdentity(principal: Principal, input: { connectionId: string }): Promise<{ connectionId: string; status: string }> {
    return this.command(principal, 'IDENTITY_DISCONNECTED', null, (s) => {
      const user = this.user(s, principal);
      const c = s.getConnection(input.connectionId);
      if (!c || c.userId !== user.userId) deny('FORBIDDEN', 'not your connection');
      if (c!.status === 'DISCONNECTED') return { connectionId: c!.connectionId, status: c!.status };
      s.putConnection({ ...c!, status: 'DISCONNECTED', providerSubject: null, attemptStateHash: null, disconnectedAt: this.iso() });
      const stillConnected = s.listConnectionsByUser(user.userId).some((x) => x.provider === 'RIOT' && x.status === 'VERIFIED');
      if (c!.provider === 'RIOT' && !stillConnected) {
        for (const consent of s.listConsentsByUser(user.userId).filter((x) => x.status === 'EXPLICIT' && x.grants.IDENTITY_CONNECTED)) {
          this.revokeFrom(s, principal, user.userId, consent, 'IDENTITY_CONNECTED', 'identity-disconnected');
        }
      }
      this.audit(s, principal, 'IDENTITY_DISCONNECTED', null, c!.connectionId, 'SUCCESS', [c!.provider]);
      return { connectionId: c!.connectionId, status: 'DISCONNECTED' };
    });
  }

  /** The caller's own connections, WITHOUT provider subjects. */
  async myIdentityConnections(principal: Principal): Promise<{ connectionId: string; provider: 'RIOT' | 'DISCORD'; status: 'PENDING' | 'VERIFIED' | 'DISCONNECTED'; verifiedAt: string | null }[]> {
    return this.repo.read((s) => {
      const user = this.user(s, principal);
      return s.listConnectionsByUser(user.userId).map((c) => ({ connectionId: c.connectionId, provider: c.provider, status: c.status, verifiedAt: c.verifiedAt }))
        .sort((a, b) => (a.connectionId < b.connectionId ? -1 : 1));
    });
  }

  /** RSO-ready aliases (Riot). With RiotRsoIdentityProvider these fail NOT_IMPLEMENTED; tests use MockIdentityProvider. */
  beginRiotConnection(principal: Principal) { return this.beginIdentityConnection(principal, { provider: 'RIOT' }); }
  completeRiotConnection(principal: Principal, input: { connectionId: string; state: string; code: string }) { return this.completeIdentityConnection(principal, input); }
  disconnectRiotConnection(principal: Principal, input: { connectionId: string }) { return this.disconnectIdentity(principal, input); }

  // ------------------------------------------------------------------ consent
  private writeConsent(s: ControlPlaneStore, actor: string, consent: ConsentRecord, next: ConsentGrants, source: string, policyVersion: string | null): ConsentRecord {
    const record: ConsentRecord = { ...consent, status: 'EXPLICIT', grants: next, policyVersion, updatedAt: this.iso(), version: consent.version + 1 };
    s.putConsent(record);
    s.appendConsentTransition({ transitionId: newId('ctr'), membershipId: consent.membershipId, actor, at: this.iso(), source, previous: consent.grants, next });
    return record;
  }

  /** Revoke `grant` and everything after it; emit DataRevocationRequested; block open jobs when collection ends. */
  private revokeFrom(s: ControlPlaneStore, principal: Principal, actor: string, consent: ConsentRecord, grant: ConsentGrantName, source: string): { consent: ConsentRecord; event: DataRevocationRequested | null } {
    const from = GRANT_ORDER.indexOf(grant);
    const next = { ...consent.grants };
    const revoked: ConsentGrantName[] = [];
    for (const g of GRANT_ORDER.slice(from)) if (next[g]) { next[g] = false; revoked.push(g); }
    if (!revoked.length) return { consent, event: null };
    const record = this.writeConsent(s, actor, consent, next, source, consent.policyVersion);
    const collectionEnded = revoked.includes('DATA_COLLECTION_ALLOWED') || revoked.includes('IDENTITY_CONNECTED');
    const event: DataRevocationRequested = { type: 'DataRevocationRequested', eventId: newId('evt'), groupId: consent.groupId, membershipId: consent.membershipId, revokedGrants: revoked,
      scopes: collectionEnded ? ['STOP_FUTURE_SYNC', 'EXCLUDE_FROM_PUBLICATION', 'ERASE_ATTRIBUTABLE_SPATIAL_EVIDENCE'] : ['EXCLUDE_FROM_PUBLICATION'], requestedAt: this.iso() };
    s.appendRevocation(event);
    if (collectionEnded) this.blockOpenJobs(s, principal, consent.membershipId, ['DATA_COLLECTION_NOT_ALLOWED']);
    this.audit(s, principal, 'CONSENT_REVOKED', consent.groupId, consent.membershipId, 'SUCCESS', revoked);
    this.audit(s, principal, 'DATA_REVOCATION_REQUESTED', consent.groupId, event.eventId, 'SUCCESS', event.scopes);
    return { consent: record, event };
  }

  /**
   * The member grants explicitly for THEIR OWN membership (nobody can grant for someone else). Ordered: each grant needs
   * the previous one. Granting on a REQUIRES_RECONCILIATION record is an explicit re-consent: the record becomes
   * EXPLICIT with exactly the grants given. Idempotent: already-held grants are a no-op.
   */
  async grantConsent(principal: Principal, input: { groupId: string; grants: readonly ExplicitGrant[]; policyVersion: string }): Promise<ConsentRecord> {
    if (!input.grants.length || input.grants.some((g) => !EXPLICIT_GRANTS.includes(g))) deny('VALIDATION', 'grants must be DATA_COLLECTION_ALLOWED / GROUP_VISIBILITY_ALLOWED / PUBLIC_DERIVED_ANALYTICS_ALLOWED');
    if (!POLICY.test(input.policyVersion)) deny('VALIDATION', 'invalid policy version');
    return this.command(principal, 'CONSENT_GRANTED', input.groupId, (s) => {
      const user = this.user(s, principal);
      this.group(s, input.groupId, true);
      const m = this.activeMembership(s, input.groupId, user.userId);
      const consent = s.getConsent(m.membershipId)!;
      const base = consent.status === 'EXPLICIT' ? consent.grants : { ...NO_GRANTS, IDENTITY_CONNECTED: s.listConnectionsByUser(user.userId).some((c) => c.provider === 'RIOT' && c.status === 'VERIFIED') };
      const next = { ...base };
      for (const g of input.grants) next[g] = true;
      for (let i = 1; i < GRANT_ORDER.length; i += 1) if (next[GRANT_ORDER[i]!] && !next[GRANT_ORDER[i - 1]!]) deny('VALIDATION', `${GRANT_ORDER[i]} requires ${GRANT_ORDER[i - 1]}`);
      if (consent.status === 'EXPLICIT' && GRANT_ORDER.every((g) => next[g] === consent.grants[g]) && consent.policyVersion === input.policyVersion) return consent;
      const record = this.writeConsent(s, user.userId, consent, next, `member-grant:${input.policyVersion}`, input.policyVersion);
      this.audit(s, principal, 'CONSENT_GRANTED', input.groupId, m.membershipId, 'SUCCESS', input.grants.filter((g) => !consent.grants[g] || consent.status !== 'EXPLICIT'));
      return record;
    });
  }

  /**
   * The member revokes for their own membership (also allowed after leaving / removal, and in archived groups —
   * revocation is never blocked). Immediate effect on sync and publication eligibility; emits DataRevocationRequested.
   * Idempotent: revoking an already-revoked grant changes nothing and emits nothing.
   */
  async revokeConsent(principal: Principal, input: { groupId: string; grants: readonly ExplicitGrant[]; reason?: string }): Promise<{ consent: ConsentRecord; event: DataRevocationRequested | null }> {
    if (!input.grants.length || input.grants.some((g) => !EXPLICIT_GRANTS.includes(g))) deny('VALIDATION', 'invalid grants');
    return this.command(principal, 'CONSENT_REVOKED', input.groupId, (s) => {
      const user = this.user(s, principal);
      const m = s.findMembership(input.groupId, user.userId);
      if (!m) deny('FORBIDDEN', 'no membership in this group');
      let consent = s.getConsent(m!.membershipId)!;
      let event: DataRevocationRequested | null = null;
      const first = GRANT_ORDER.find((g) => (input.grants as readonly string[]).includes(g))!;
      const result = this.revokeFrom(s, principal, user.userId, consent, first, `member-revoke${input.reason && /^[a-z0-9-]{1,40}$/u.test(input.reason) ? `:${input.reason}` : ''}`);
      consent = result.consent; event = result.event;
      return { consent, event };
    });
  }

  async getConsent(principal: Principal, input: { groupId: string }): Promise<ConsentRecord> {
    return this.repo.read((s) => {
      const user = this.user(s, principal);
      const m = s.findMembership(input.groupId, user.userId);
      if (!m) deny('FORBIDDEN', 'no membership in this group');
      return s.getConsent(m!.membershipId)!;
    });
  }

  async myPublicationEligibility(principal: Principal, input: { groupId: string }): Promise<PublicationEligibility> {
    return this.repo.read((s) => {
      const user = this.user(s, principal);
      const m = s.findMembership(input.groupId, user.userId);
      if (!m) deny('FORBIDDEN', 'no membership in this group');
      return publicationEligibility(m!, s.getGroup(input.groupId)!, s.getConsent(m!.membershipId));
    });
  }

  async consentHistory(principal: Principal, input: { groupId: string }) {
    return this.repo.read((s) => {
      const user = this.user(s, principal);
      const m = s.findMembership(input.groupId, user.userId);
      if (!m) deny('FORBIDDEN', 'no membership in this group');
      return s.listConsentTransitions(m!.membershipId);
    });
  }

  /** OWNER / ADMIN or SYSTEM (the local exporter): deterministic eligibility for every membership of the group. */
  async publicationEligibility(principal: Principal, input: { groupId: string }): Promise<PublicationEligibility[]> {
    return this.repo.read((s) => {
      if (principal.kind === 'USER') {
        const user = this.user(s, principal);
        this.requireRole(this.activeMembership(s, input.groupId, user.userId), ['OWNER', 'ADMIN']);
      } else if (principal.kind !== 'SYSTEM') deny('FORBIDDEN', 'not allowed');
      const group = s.getGroup(input.groupId);
      if (!group) deny('NOT_FOUND', 'group not found');
      return s.listMembershipsByGroup(group!.groupId).map((m) => publicationEligibility(m, group!, s.getConsent(m.membershipId)))
        .sort((a, b) => (a.membershipId < b.membershipId ? -1 : 1));
    });
  }

  // ------------------------------------------------------------------ reconciliation (records only)
  async recordReconciliations(principal: Principal, records: readonly ConsentReconciliationRecord[]): Promise<number> {
    if (principal.kind !== 'SYSTEM') deny('FORBIDDEN', 'reconciliation is a system command');
    return this.repo.transact((s) => { for (const r of records) s.putReconciliation(r); return records.length; });
  }

  // ------------------------------------------------------------------ sync jobs (metadata only)
  private blockOpenJobs(s: ControlPlaneStore, principal: Principal, membershipId: string, reasons: string[]): void {
    for (const job of s.listJobs().filter((j) => j.membershipId === membershipId && (j.state === 'PENDING' || j.state === 'CLAIMED'))) {
      s.putJob({ ...this.moveJob(job, 'BLOCKED_CONSENT'), blockedReasons: reasons, leaseOwner: null, leaseExpiresAt: null, finishedAt: this.iso() });
      this.audit(s, principal, 'SYNC_BLOCKED', job.groupId, job.jobId, 'SUCCESS', reasons);
    }
  }

  /**
   * Creates job METADATA only — the control plane never calls a provider. A member requests for themself; OWNER / ADMIN
   * may request for an active member. Without consent the job is recorded as BLOCKED_CONSENT immediately. Idempotent:
   * an open (PENDING / CLAIMED / RUNNING) job for the same membership is returned instead of a duplicate.
   */
  async requestSync(principal: Principal, input: { groupId: string; membershipId?: string }): Promise<{ job: SyncJobRecord; deduplicated: boolean }> {
    return this.command(principal, 'SYNC_REQUESTED', input.groupId, (s) => {
      const user = this.user(s, principal);
      const group = this.group(s, input.groupId, true);
      const me = this.activeMembership(s, group.groupId, user.userId);
      const target = input.membershipId ? s.getMembership(input.membershipId) : me;
      if (!target || target.groupId !== group.groupId) deny('NOT_FOUND', 'membership not found');
      if (target!.membershipId !== me.membershipId) this.requireRole(me, ['OWNER', 'ADMIN']);
      const open = s.listJobs().find((j) => j.membershipId === target!.membershipId && ['PENDING', 'CLAIMED', 'RUNNING'].includes(j.state));
      if (open) return { job: open, deduplicated: true };
      const reasons = syncBlockReasons(target!, group, s.getConsent(target!.membershipId));
      const job: SyncJobRecord = { jobId: newId('job'), groupId: group.groupId, membershipId: target!.membershipId, requestedBy: user.userId, state: reasons.length ? 'BLOCKED_CONSENT' : 'PENDING',
        attempt: 0, leaseOwner: null, leaseTokenHash: null, leaseExpiresAt: null, createdAt: this.iso(), updatedAt: this.iso(), startedAt: null, finishedAt: reasons.length ? this.iso() : null,
        blockedReasons: reasons, result: null };
      s.putJob(job);
      this.audit(s, principal, 'SYNC_REQUESTED', group.groupId, job.jobId, 'SUCCESS');
      if (reasons.length) this.audit(s, principal, 'SYNC_BLOCKED', group.groupId, job.jobId, 'SUCCESS', reasons);
      return { job, deduplicated: false };
    });
  }

  async getSyncStatus(principal: Principal, input: { jobId: string }): Promise<SyncJobRecord> {
    return this.repo.read((s) => {
      const user = this.user(s, principal);
      const job = s.getJob(input.jobId);
      if (!job) deny('NOT_FOUND', 'job not found');
      const me = s.findMembership(job!.groupId, user.userId);
      if (!me || me.state !== 'ACTIVE' || (me.membershipId !== job!.membershipId && me.role === 'MEMBER')) deny('FORBIDDEN', 'not allowed to view this job');
      return job!;
    });
  }

  async cancelSync(principal: Principal, input: { jobId: string }): Promise<SyncJobRecord> {
    return this.command(principal, 'SYNC_CANCELLED', null, (s) => {
      const user = this.user(s, principal);
      const job = s.getJob(input.jobId);
      if (!job) deny('NOT_FOUND', 'job not found');
      const me = this.activeMembership(s, job!.groupId, user.userId);
      if (me.membershipId !== job!.membershipId) this.requireRole(me, ['OWNER', 'ADMIN']);
      if (job!.state === 'CANCELLED') return job!;
      const next = { ...this.moveJob(job!, 'CANCELLED'), leaseOwner: null, leaseExpiresAt: null, finishedAt: this.iso() };
      s.putJob(next);
      this.audit(s, principal, 'SYNC_CANCELLED', job!.groupId, job!.jobId, 'SUCCESS');
      return next;
    });
  }

  // ------------------------------------------------------------------ outbound worker contract
  private worker(principal: Principal): string {
    if (principal.kind !== 'WORKER' || !/^wkr_[a-z0-9_-]{3,40}$/u.test(principal.workerId)) deny('UNAUTHENTICATED', 'a worker principal is required');
    return (principal as { workerId: string }).workerId;
  }
  private claimable(job: SyncJobRecord, nowMs: number): boolean {
    return job.state === 'PENDING' || ((job.state === 'CLAIMED' || job.state === 'RUNNING') && job.leaseExpiresAt !== null && Date.parse(job.leaseExpiresAt) <= nowMs);
  }
  private requireLease(job: SyncJobRecord | null, workerId: string, leaseToken: string): SyncJobRecord {
    if (!job) deny('NOT_FOUND', 'job not found');
    if (job!.leaseOwner !== workerId || !job!.leaseTokenHash || !digestEquals(job!.leaseTokenHash, hashSecret('lease-token-v1', leaseToken))) deny('LEASE_CONFLICT', 'lease not held');
    return job!;
  }
  private leaseValid(job: SyncJobRecord): boolean { return job.leaseExpiresAt !== null && Date.parse(job.leaseExpiresAt) > this.now().getTime(); }

  /** The local worker polls OUTBOUND: claimable jobs (PENDING, or holding an expired lease), oldest first, ≤ 20. */
  async pollJobs(principal: Principal, input: { limit?: number } = {}): Promise<{ jobId: string; groupId: string; membershipId: string; state: SyncJobState; attempt: number }[]> {
    this.worker(principal);
    const limit = Math.max(1, Math.min(MAX_POLL_JOBS, Math.trunc(input.limit ?? MAX_POLL_JOBS)));
    return this.repo.read((s) => s.listJobs().filter((j) => this.claimable(j, this.now().getTime())).sort((a, b) => (a.createdAt + a.jobId < b.createdAt + b.jobId ? -1 : 1))
      .slice(0, limit).map((j) => ({ jobId: j.jobId, groupId: j.groupId, membershipId: j.membershipId, state: j.state, attempt: j.attempt })));
  }

  /** Claim with a fencing lease token (returned once). A live lease held by anyone is LEASE_CONFLICT; an expired one is reclaimed. */
  async claimJob(principal: Principal, input: { jobId: string; leaseMs?: number }): Promise<{ job: SyncJobRecord; leaseToken: string | null }> {
    const workerId = this.worker(principal);
    const leaseMs = input.leaseMs ?? LEASE_DEFAULT_MS;
    if (!(leaseMs >= 1_000 && leaseMs <= LEASE_MAX_MS)) deny('VALIDATION', `leaseMs must be in [1000, ${LEASE_MAX_MS}]`);
    const leaseToken = newSecret();
    return this.repo.transact((s) => {
      const job = s.getJob(input.jobId);
      if (!job) deny('NOT_FOUND', 'job not found');
      if (!this.claimable(job!, this.now().getTime())) deny('LEASE_CONFLICT', `job is ${job!.state}${job!.leaseOwner ? ' and leased' : ''}`);
      const reasons = syncBlockReasons(s.getMembership(job!.membershipId), s.getGroup(job!.groupId), s.getConsent(job!.membershipId));
      if (reasons.length) {
        const blocked = { ...this.moveJob(job!, 'BLOCKED_CONSENT'), blockedReasons: reasons, leaseOwner: null, leaseTokenHash: null, leaseExpiresAt: null, finishedAt: this.iso() };
        s.putJob(blocked);
        this.audit(s, principal, 'SYNC_BLOCKED', job!.groupId, job!.jobId, 'SUCCESS', reasons);
        return { job: blocked, leaseToken: null };
      }
      const reclaim = job!.state !== 'PENDING';
      const claimed: SyncJobRecord = { ...this.moveJob(job!, 'CLAIMED'), attempt: job!.attempt + 1, leaseOwner: workerId, leaseTokenHash: hashSecret('lease-token-v1', leaseToken),
        leaseExpiresAt: this.iso(leaseMs), startedAt: null };
      s.putJob(claimed);
      this.audit(s, principal, reclaim ? 'SYNC_RECLAIMED' : 'SYNC_CLAIMED', job!.groupId, job!.jobId, 'SUCCESS');
      return { job: claimed, leaseToken };
    });
  }

  /** CLAIMED → RUNNING only if the lease is live AND IDENTITY_CONNECTED + DATA_COLLECTION_ALLOWED still hold; else BLOCKED_CONSENT. */
  async startJob(principal: Principal, input: { jobId: string; leaseToken: string }): Promise<SyncJobRecord> {
    const workerId = this.worker(principal);
    return this.repo.transact((s) => {
      const job = this.requireLease(s.getJob(input.jobId), workerId, input.leaseToken);
      if (job.state === 'RUNNING') return job; // idempotent
      if (!this.leaseValid(job)) deny('LEASE_CONFLICT', 'lease expired');
      const reasons = syncBlockReasons(s.getMembership(job.membershipId), s.getGroup(job.groupId), s.getConsent(job.membershipId));
      if (reasons.length) {
        const blocked = { ...this.moveJob(job, 'BLOCKED_CONSENT'), blockedReasons: reasons, leaseOwner: null, leaseTokenHash: null, leaseExpiresAt: null, finishedAt: this.iso() };
        s.putJob(blocked);
        this.audit(s, principal, 'SYNC_BLOCKED', job.groupId, job.jobId, 'SUCCESS', reasons);
        return blocked;
      }
      const running = { ...this.moveJob(job, 'RUNNING'), startedAt: this.iso() };
      s.putJob(running);
      this.audit(s, principal, 'SYNC_STARTED', job.groupId, job.jobId, 'SUCCESS');
      return running;
    });
  }

  /** Extends a live lease. `proceed: false` tells the worker consent ended mid-run: stop provider fetches now. */
  async heartbeatJob(principal: Principal, input: { jobId: string; leaseToken: string; leaseMs?: number }): Promise<{ leaseExpiresAt: string; proceed: boolean }> {
    const workerId = this.worker(principal);
    const leaseMs = input.leaseMs ?? LEASE_DEFAULT_MS;
    if (!(leaseMs >= 1_000 && leaseMs <= LEASE_MAX_MS)) deny('VALIDATION', 'invalid leaseMs');
    return this.repo.transact((s) => {
      const job = this.requireLease(s.getJob(input.jobId), workerId, input.leaseToken);
      if (job.state !== 'CLAIMED' && job.state !== 'RUNNING') deny('INVALID_STATE', `job is ${job.state}`);
      if (!this.leaseValid(job)) deny('LEASE_CONFLICT', 'lease expired');
      const next = { ...job, leaseExpiresAt: this.iso(leaseMs), updatedAt: this.iso() };
      s.putJob(next);
      return { leaseExpiresAt: next.leaseExpiresAt!, proceed: syncBlockReasons(s.getMembership(job.membershipId), s.getGroup(job.groupId), s.getConsent(job.membershipId)).length === 0 };
    });
  }

  /**
   * RUNNING → SUCCEEDED with an execution summary (never telemetry). Idempotent: the same lease holder repeating the same
   * completion gets the stored job; a different result, another worker or an expired lease is rejected.
   */
  async completeJob(principal: Principal, input: { jobId: string; leaseToken: string; matchesIngested: number }): Promise<SyncJobRecord> {
    if (!Number.isSafeInteger(input.matchesIngested) || input.matchesIngested < 0) deny('VALIDATION', 'matchesIngested must be a non-negative integer');
    return this.finish(principal, input.jobId, input.leaseToken, { outcome: 'SUCCEEDED', matchesIngested: input.matchesIngested, errorCode: null });
  }

  async failJob(principal: Principal, input: { jobId: string; leaseToken: string; errorCode: string }): Promise<SyncJobRecord> {
    if (!CODE.test(input.errorCode)) deny('VALIDATION', 'errorCode must be an UPPER_SNAKE code');
    return this.finish(principal, input.jobId, input.leaseToken, { outcome: 'FAILED', matchesIngested: 0, errorCode: input.errorCode });
  }

  private finish(principal: Principal, jobId: string, leaseToken: string, result: NonNullable<SyncJobRecord['result']>): Promise<SyncJobRecord> {
    const workerId = this.worker(principal);
    return this.repo.transact((s) => {
      const job = this.requireLease(s.getJob(jobId), workerId, leaseToken);
      if (job.state === result.outcome) {
        if (JSON.stringify(job.result) === JSON.stringify(result)) return job;
        deny('INVALID_STATE', 'job already finished with a different result');
      }
      if (TERMINAL_JOB_STATES.has(job.state)) deny('INVALID_STATE', `job is ${job.state}`);
      if (result.outcome === 'SUCCEEDED' && job.state !== 'RUNNING') deny('INVALID_STATE', 'only a RUNNING job can succeed');
      if (!this.leaseValid(job)) deny('LEASE_CONFLICT', 'lease expired');
      const done = { ...this.moveJob(job, result.outcome), result, leaseExpiresAt: null, finishedAt: this.iso() };
      s.putJob(done);
      this.audit(s, principal, 'SYNC_COMPLETED', job.groupId, job.jobId, 'SUCCESS', [result.outcome, ...(result.errorCode ? [result.errorCode] : [])]);
      return done;
    });
  }

  /** Data-plane outbox: revocation instructions after `afterEventId` (outbound poll by the local worker). */
  async pollRevocations(principal: Principal, input: { afterEventId?: string | null } = {}): Promise<DataRevocationRequested[]> {
    this.worker(principal);
    return this.repo.read((s) => {
      const all = s.listRevocations();
      const start = input.afterEventId ? all.findIndex((e) => e.eventId === input.afterEventId) + 1 : 0;
      return all.slice(start, start + MAX_POLL_JOBS);
    });
  }

  /** Operator / test read of the append-only audit log. */
  async auditLog(principal: Principal) {
    if (principal.kind !== 'SYSTEM') deny('FORBIDDEN', 'audit read is a system command');
    return this.repo.read((s) => s.listAudit());
  }
}
