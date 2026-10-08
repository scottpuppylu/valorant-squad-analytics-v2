import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { applyDataRevocation, IngestService } from '@vsa/collector';
import {
  ControlPlaneError, ControlPlaneService, ControlPlaneViews, dispatch, InMemoryControlPlaneRepository, MockIdentityProvider, reconcileImportedConsents, RiotRsoIdentityProvider,
  startLocalControlApi, type Principal,
} from '@vsa/control-api';
import { ConsentSettingsView, DataRevocationRequested, InviteView, MyGroupsView, SyncStatusView } from '@vsa/contracts/control';
import { findPrivateKeys } from '@vsa/privacy';
import { FakeProviderAdapter } from '@vsa/source-adapters';
import { analyzeArchitecture } from '../scripts/architecture.ts';
import { freshDatabase, seedDemoRoster } from './helpers.ts';

// ---------------------------------------------------------------------------------------------------------------
const SYSTEM: Principal = { kind: 'SYSTEM', reason: 'test' };
const WORKER_A: Principal = { kind: 'WORKER', workerId: 'wkr_local-a' };
const WORKER_B: Principal = { kind: 'WORKER', workerId: 'wkr_local-b' };
const as = (userId: string): Principal => ({ kind: 'USER', userId });
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof ControlPlaneError ? e.code : `UNEXPECTED:${String(e)}`; } };

async function world() {
  let t = Date.UTC(2026, 9, 9, 12);
  const now = () => new Date(t);
  const advance = (ms: number) => { t += ms; };
  const repository = new InMemoryControlPlaneRepository();
  const riot = new MockIdentityProvider('RIOT');
  const service = new ControlPlaneService({ repository, identityProviders: [riot, new MockIdentityProvider('DISCORD')], now });
  const user = async (displayName: string) => (await service.registerUser(SYSTEM, { displayName })).userId;
  const [owner, admin, member, outsider] = [await user('Owner'), await user('Admin'), await user('Member'), await user('Outsider')];
  const { group } = await service.createGroup(as(owner), { name: '示範群組' });
  const join = async (userId: string) => (await service.acceptInvite(as(userId), { token: (await service.createInvite(as(owner), { groupId: group.groupId })).token })).membership;
  const adminM = await join(admin);
  await service.changeRole(as(owner), { groupId: group.groupId, membershipId: adminM.membershipId, role: 'ADMIN' });
  const memberM = await join(member);
  const connect = async (userId: string, subject: string) => {
    const begin = await service.beginRiotConnection(as(userId));
    return service.completeRiotConnection(as(userId), { connectionId: begin.connectionId, state: begin.state, code: `mock:${subject}` });
  };
  return { service, repository, riot, advance, now, owner, admin, member, outsider, group, adminM, memberM, join, connect, user };
}
const ALL: ['DATA_COLLECTION_ALLOWED', 'GROUP_VISIBILITY_ALLOWED', 'PUBLIC_DERIVED_ANALYTICS_ALLOWED'] = ['DATA_COLLECTION_ALLOWED', 'GROUP_VISIBILITY_ALLOWED', 'PUBLIC_DERIVED_ANALYTICS_ALLOWED'];

// ---------------------------------------------------------------------------------------------------------------
describe('groups, roles and authorization (domain-side)', () => {
  it('creates INVITE_ONLY groups by default (PRIVATE allowed, no public groups) with the creator as OWNER', async () => {
    const w = await world();
    expect(w.group).toMatchObject({ visibility: 'INVITE_ONLY', status: 'ACTIVE' });
    expect((await w.service.createGroup(as(w.owner), { name: 'p', visibility: 'PRIVATE' })).group.visibility).toBe('PRIVATE');
    expect(await code(w.service.createGroup(as(w.owner), { name: 'x', visibility: 'PUBLIC' as never }))).toBe('VALIDATION');
    const members = await w.service.listMembers(as(w.owner), { groupId: w.group.groupId });
    expect(members.map((m) => [m.displayName, m.membership.role, m.membership.state])).toEqual([['Owner', 'OWNER', 'ACTIVE'], ['Admin', 'ADMIN', 'ACTIVE'], ['Member', 'MEMBER', 'ACTIVE']]);
  });

  it('non-members get FORBIDDEN without learning whether the group exists', async () => {
    const w = await world();
    expect(await code(w.service.listMembers(as(w.outsider), { groupId: w.group.groupId }))).toBe('FORBIDDEN');
    expect(await code(w.service.listMembers(as(w.outsider), { groupId: 'grp_000000000000000000000000' }))).toBe('FORBIDDEN');
    expect(await code(w.service.createInvite(as(w.outsider), { groupId: w.group.groupId }))).toBe('FORBIDDEN');
    expect(await code(w.service.requestSync(as(w.outsider), { groupId: w.group.groupId }))).toBe('FORBIDDEN');
    expect(await code(w.service.listGroups({ kind: 'USER', userId: 'usr_ffffffffffffffffffffffff' }))).toBe('UNAUTHENTICATED');
  });

  it('MEMBER cannot administer; ADMIN cannot perform OWNER-only actions; OWNER can', async () => {
    const w = await world();
    const g = w.group.groupId;
    expect(await code(w.service.createInvite(as(w.member), { groupId: g }))).toBe('FORBIDDEN');
    expect(await code(w.service.removeMember(as(w.member), { groupId: g, membershipId: w.adminM.membershipId }))).toBe('FORBIDDEN');
    expect(await code(w.service.renameGroup(as(w.admin), { groupId: g, name: 'renamed' }))).toBe('FORBIDDEN');
    expect(await code(w.service.archiveGroup(as(w.admin), { groupId: g }))).toBe('FORBIDDEN');
    expect(await code(w.service.changeRole(as(w.admin), { groupId: g, membershipId: w.memberM.membershipId, role: 'ADMIN' }))).toBe('FORBIDDEN');
    expect(await code(w.service.createInvite(as(w.admin), { groupId: g }))).toBe('OK');
    expect(await code(w.service.renameGroup(as(w.owner), { groupId: g, name: 'renamed' }))).toBe('OK');
    const audit = await w.service.auditLog(SYSTEM);
    expect(audit.filter((a) => a.action === 'AUTHORIZATION_DENIED').length).toBe(5);
  });

  it('ADMIN manages normal members only; removed members lose all access', async () => {
    const w = await world();
    const g = w.group.groupId;
    expect(await code(w.service.removeMember(as(w.admin), { groupId: g, membershipId: w.memberM.membershipId }))).toBe('OK');
    expect(await code(w.service.removeMember(as(w.admin), { groupId: g, membershipId: w.adminM.membershipId }))).toBe('FORBIDDEN');
    expect((await w.service.removeMember(as(w.admin), { groupId: g, membershipId: w.memberM.membershipId })).state).toBe('REMOVED'); // idempotent
    for (const p of [w.service.listMembers(as(w.member), { groupId: g }), w.service.requestSync(as(w.member), { groupId: g }),
      w.service.grantConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'], policyVersion: 'p1' })]) expect(await code(p)).toBe('FORBIDDEN');
    expect((await w.service.listGroups(as(w.member))).length).toBe(0);
  });

  it('archived groups are read-only for members; every mutation fails with GROUP_ARCHIVED; archiving is idempotent', async () => {
    const w = await world();
    const g = w.group.groupId;
    await w.service.archiveGroup(as(w.owner), { groupId: g });
    expect((await w.service.archiveGroup(as(w.owner), { groupId: g })).status).toBe('ARCHIVED');
    expect((await w.service.listMembers(as(w.member), { groupId: g })).length).toBe(3);
    for (const p of [w.service.createInvite(as(w.owner), { groupId: g }), w.service.renameGroup(as(w.owner), { groupId: g, name: 'n' }), w.service.requestSync(as(w.member), { groupId: g }),
      w.service.grantConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'], policyVersion: 'p1' })]) expect(await code(p)).toBe('GROUP_ARCHIVED');
    expect((await new ControlPlaneViews(w.service).myGroups(as(w.member))).groups[0]).toMatchObject({ archived: true });
  });

  it('membership state machine: INVITED → ACTIVE, ACTIVE → LEFT / REMOVED, re-join only by a new invite (consent restarts at DENY)', async () => {
    const w = await world();
    const g = w.group.groupId;
    const late = await w.user('Late');
    const { invite, token } = await w.service.createInvite(as(w.owner), { groupId: g, forUserId: late });
    expect((await w.service.listMembers(as(w.owner), { groupId: g })).some((m) => m.membership.userId === late && m.membership.state === 'INVITED')).toBe(true);
    expect((await w.service.listMembers(as(w.member), { groupId: g })).some((m) => m.membership.state === 'INVITED')).toBe(false);
    expect(await code(w.service.acceptInvite(as(w.outsider), { token }))).toBe('INVITE_INVALID'); // addressed to someone else
    expect((await w.service.acceptInvite(as(late), { token })).membership.state).toBe('ACTIVE');
    expect(invite.status).toBe('OPEN');
    await w.connect(w.member, 'subject-member-0001');
    await w.service.grantConsent(as(w.member), { groupId: g, grants: ALL, policyVersion: 'p1' });
    expect((await w.service.leaveGroup(as(w.member), { groupId: g })).state).toBe('LEFT');
    expect(await code(w.service.leaveGroup(as(w.owner), { groupId: g }))).toBe('INVALID_STATE');
    const back = await w.join(w.member);
    expect(back.membershipId).toBe(w.memberM.membershipId);
    expect((await w.service.getConsent(as(w.member), { groupId: g })).grants).toEqual({ IDENTITY_CONNECTED: true, DATA_COLLECTION_ALLOWED: false, GROUP_VISIBILITY_ALLOWED: false,
      PUBLIC_DERIVED_ANALYTICS_ALLOWED: false });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('invites', () => {
  it('tokens are 256-bit opaque random values; only a hash is stored; one-time acceptance', async () => {
    const w = await world();
    const a = await w.service.createInvite(as(w.owner), { groupId: w.group.groupId });
    const b = await w.service.createInvite(as(w.owner), { groupId: w.group.groupId });
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.from(a.token, 'base64url').length * 8).toBeGreaterThanOrEqual(128);
    expect(a.token).not.toBe(b.token);
    expect(JSON.stringify(a.invite)).not.toContain('tokenHash');
    const stored = await w.repository.read((s) => s.listInvites());
    expect(stored.every((i) => /^[0-9a-f]{64}$/u.test(i.tokenHash) && i.tokenHash !== a.token && i.tokenHash !== b.token)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(a.token);
    const x = await w.user('X'); const y = await w.user('Y');
    expect((await w.service.acceptInvite(as(x), { token: a.token })).alreadyAccepted).toBe(false);
    expect((await w.service.acceptInvite(as(x), { token: a.token })).alreadyAccepted).toBe(true); // idempotent for the same user
    expect(await code(w.service.acceptInvite(as(y), { token: a.token }))).toBe('INVITE_INVALID'); // replay by another user
    expect((await w.service.listMembers(as(w.owner), { groupId: w.group.groupId })).filter((m) => m.membership.userId === x)).toHaveLength(1);
  });

  it('expired, revoked, unknown and malformed tokens are rejected identically; expiry is recorded', async () => {
    const w = await world();
    const g = w.group.groupId;
    const exp = await w.service.createInvite(as(w.owner), { groupId: g, ttlHours: 1 });
    const rev = await w.service.createInvite(as(w.admin), { groupId: g });
    await w.service.revokeInvite(as(w.admin), { groupId: g, inviteId: rev.invite.inviteId });
    expect((await w.service.revokeInvite(as(w.owner), { groupId: g, inviteId: rev.invite.inviteId })).status).toBe('REVOKED'); // idempotent
    w.advance(3_600_001);
    const z = await w.user('Z');
    const views = new ControlPlaneViews(w.service);
    for (const token of [exp.token, rev.token, 'A'.repeat(43), 'short', '../../etc']) {
      expect(await code(w.service.acceptInvite(as(z), { token }))).toBe('INVITE_INVALID');
      expect(InviteView.parse(await views.invite(as(z), token))).toEqual({ acceptable: false });
    }
    const invites = await w.repository.read((s) => s.listInvites());
    expect(invites.find((i) => i.inviteId === exp.invite.inviteId)?.status).toBe('EXPIRED');
    expect(await code(w.service.revokeInvite(as(w.owner), { groupId: g, inviteId: exp.invite.inviteId }))).toBe('INVALID_STATE');
    const fresh = await w.service.createInvite(as(w.owner), { groupId: g, ttlHours: 1 });
    w.advance(3_600_001);
    expect(await w.service.expireInvites(SYSTEM)).toBe(1);
    expect(await code(w.service.expireInvites(as(w.owner)))).toBe('FORBIDDEN');
    expect(await code(w.service.createInvite(as(w.owner), { groupId: g, ttlHours: 500 }))).toBe('VALIDATION');
    expect(fresh.token).toBeTruthy();
  });

  it('the pre-acceptance view reveals nothing about the group', async () => {
    const w = await world();
    const { token } = await w.service.createInvite(as(w.owner), { groupId: w.group.groupId });
    const view = await new ControlPlaneViews(w.service).invite(as(w.outsider), token);
    expect(view).toEqual({ acceptable: true });
    expect(JSON.stringify(view)).not.toMatch(/示範|Owner|grp_/u);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('identity connections (RSO-ready, mock provider)', () => {
  it('product user ids are opaque and never a provider id; the provider subject stays private', async () => {
    const w = await world();
    expect(w.member).toMatch(/^usr_[0-9a-f]{24}$/u);
    const subject = 'riot-subject-0001-private';
    const done = await w.connect(w.member, subject);
    expect(done).toMatchObject({ provider: 'RIOT', status: 'VERIFIED' });
    expect(JSON.stringify(done)).not.toContain(subject);
    const views = new ControlPlaneViews(w.service);
    const settings = ConsentSettingsView.parse(await views.consentSettings(as(w.member), w.group.groupId));
    expect(JSON.stringify(settings)).not.toContain(subject);
    expect(JSON.stringify(await w.service.auditLog(SYSTEM))).not.toContain(subject);
    expect(JSON.stringify(await w.service.myIdentityConnections(as(w.member)))).not.toContain(subject);
    expect(settings.grants.IDENTITY_CONNECTED).toBe(true);
  });

  it('the state value must match; a subject already connected to another user is rejected; disconnect clears the subject', async () => {
    const w = await world();
    const begin = await w.service.beginRiotConnection(as(w.member));
    expect(await code(w.service.completeRiotConnection(as(w.member), { connectionId: begin.connectionId, state: 'wrong', code: 'mock:subject-aaaa' }))).toBe('FORBIDDEN');
    expect(await code(w.service.completeRiotConnection(as(w.outsider), { connectionId: begin.connectionId, state: begin.state, code: 'mock:subject-aaaa' }))).toBe('FORBIDDEN');
    await w.service.completeRiotConnection(as(w.member), { connectionId: begin.connectionId, state: begin.state, code: 'mock:subject-aaaa' });
    expect(await code(w.connect(w.admin, 'subject-aaaa'))).toBe('IDENTITY_CONFLICT');
    await w.service.disconnectRiotConnection(as(w.member), { connectionId: begin.connectionId });
    const stored = await w.repository.read((s) => s.getConnection(begin.connectionId));
    expect(stored).toMatchObject({ status: 'DISCONNECTED', providerSubject: null });
    expect((await w.service.getConsent(as(w.member), { groupId: w.group.groupId })).grants.IDENTITY_CONNECTED).toBe(false);
  });

  it('Riot RSO is NOT implemented: the real provider performs no network work and fails closed', async () => {
    const repository = new InMemoryControlPlaneRepository();
    const service = new ControlPlaneService({ repository, identityProviders: [new RiotRsoIdentityProvider()] });
    const u = (await service.registerUser(SYSTEM, { displayName: 'U' })).userId;
    await expect(service.beginRiotConnection(as(u))).rejects.toThrow(/RIOT_RSO_NOT_IMPLEMENTED/u);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('consent', () => {
  it('default DENY: joining grants nothing (membership never implies consent)', async () => {
    const w = await world();
    const c = await w.service.getConsent(as(w.member), { groupId: w.group.groupId });
    expect(c).toMatchObject({ status: 'EXPLICIT', policyVersion: null, grants: { IDENTITY_CONNECTED: false, DATA_COLLECTION_ALLOWED: false, GROUP_VISIBILITY_ALLOWED: false,
      PUBLIC_DERIVED_ANALYTICS_ALLOWED: false } });
    expect((await w.service.myPublicationEligibility(as(w.member), { groupId: w.group.groupId })).eligible).toBe(false);
  });

  it('grants are explicit, self-only, ordered and independent at the top (collection without public analytics)', async () => {
    const w = await world();
    const g = w.group.groupId;
    expect(await code(w.service.grantConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'], policyVersion: 'p1' }))).toBe('VALIDATION'); // needs identity
    expect(await code(w.service.grantConsent(as(w.member), { groupId: g, grants: ['IDENTITY_CONNECTED' as never], policyVersion: 'p1' }))).toBe('VALIDATION'); // not grantable
    await w.connect(w.member, 'subject-member-0002');
    const c = await w.service.grantConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'], policyVersion: 'p1' });
    expect(c.grants).toEqual({ IDENTITY_CONNECTED: true, DATA_COLLECTION_ALLOWED: true, GROUP_VISIBILITY_ALLOWED: false, PUBLIC_DERIVED_ANALYTICS_ALLOWED: false });
    expect(await code(w.service.grantConsent(as(w.member), { groupId: g, grants: ['PUBLIC_DERIVED_ANALYTICS_ALLOWED'], policyVersion: 'p1' }))).toBe('VALIDATION');
    expect((await w.service.grantConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'], policyVersion: 'p1' })).version).toBe(c.version); // idempotent
    const history = await w.service.consentHistory(as(w.member), { groupId: g });
    expect(history.at(-1)).toMatchObject({ actor: w.member, source: 'member-grant:p1', previous: { DATA_COLLECTION_ALLOWED: false }, next: { DATA_COLLECTION_ALLOWED: true } });
    expect(history.every((t) => t.actor && t.at && t.source && t.previous && t.next)).toBe(true);
  });

  it('nobody can grant for someone else (no consent escalation through roles)', async () => {
    const w = await world();
    await w.connect(w.member, 'subject-member-0003');
    const before = await w.service.getConsent(as(w.member), { groupId: w.group.groupId });
    // The API has no target parameter: an OWNER granting affects only the OWNER's own membership.
    await w.connect(w.owner, 'subject-owner-0003');
    await w.service.grantConsent(as(w.owner), { groupId: w.group.groupId, grants: ALL, policyVersion: 'p1' });
    expect(await w.service.getConsent(as(w.member), { groupId: w.group.groupId })).toEqual(before);
  });

  it('revocation cascades, is idempotent, and immediately ends sync and publication eligibility', async () => {
    const w = await world();
    const g = w.group.groupId;
    await w.connect(w.member, 'subject-member-0004');
    await w.service.grantConsent(as(w.member), { groupId: g, grants: ALL, policyVersion: 'p1' });
    expect((await w.service.myPublicationEligibility(as(w.member), { groupId: g })).eligible).toBe(true);
    const { job } = await w.service.requestSync(as(w.member), { groupId: g });
    expect(job.state).toBe('PENDING');
    const first = await w.service.revokeConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'], reason: 'user-request' });
    expect(first.consent.grants).toEqual({ IDENTITY_CONNECTED: true, DATA_COLLECTION_ALLOWED: false, GROUP_VISIBILITY_ALLOWED: false, PUBLIC_DERIVED_ANALYTICS_ALLOWED: false });
    expect(DataRevocationRequested.parse(first.event)).toMatchObject({ revokedGrants: ['DATA_COLLECTION_ALLOWED', 'GROUP_VISIBILITY_ALLOWED', 'PUBLIC_DERIVED_ANALYTICS_ALLOWED'],
      scopes: ['STOP_FUTURE_SYNC', 'EXCLUDE_FROM_PUBLICATION', 'ERASE_ATTRIBUTABLE_SPATIAL_EVIDENCE'] });
    expect((await w.service.getSyncStatus(as(w.member), { jobId: job.jobId })).state).toBe('BLOCKED_CONSENT');
    expect((await w.service.myPublicationEligibility(as(w.member), { groupId: g })).reasons).toContain('PUBLIC_DERIVED_ANALYTICS_NOT_ALLOWED');
    const again = await w.service.revokeConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'] });
    expect(again.event).toBeNull();
    expect((await w.service.pollRevocations(WORKER_A)).length).toBe(1);
  });

  it('revoking only public analytics excludes from publication without erasing evidence', async () => {
    const w = await world();
    const g = w.group.groupId;
    await w.connect(w.member, 'subject-member-0005');
    await w.service.grantConsent(as(w.member), { groupId: g, grants: ALL, policyVersion: 'p1' });
    const { event } = await w.service.revokeConsent(as(w.member), { groupId: g, grants: ['PUBLIC_DERIVED_ANALYTICS_ALLOWED'] });
    expect(event?.scopes).toEqual(['EXCLUDE_FROM_PUBLICATION']);
    expect((await w.service.requestSync(as(w.member), { groupId: g })).job.state).toBe('PENDING'); // collection still allowed
  });

  it('publication eligibility is deterministic and requires ACTIVE membership + visibility + public analytics', async () => {
    const w = await world();
    const g = w.group.groupId;
    await w.connect(w.member, 'subject-member-0006');
    await w.service.grantConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED', 'GROUP_VISIBILITY_ALLOWED'], policyVersion: 'p1' });
    const rows = await w.service.publicationEligibility(SYSTEM, { groupId: g });
    expect(rows).toEqual(await w.service.publicationEligibility(SYSTEM, { groupId: g }));
    expect(rows.filter((r) => r.eligible)).toHaveLength(0);
    await w.service.grantConsent(as(w.member), { groupId: g, grants: ['PUBLIC_DERIVED_ANALYTICS_ALLOWED'], policyVersion: 'p1' });
    expect((await w.service.publicationEligibility(SYSTEM, { groupId: g })).filter((r) => r.eligible).map((r) => r.membershipId)).toEqual([w.memberM.membershipId]);
    await w.service.removeMember(as(w.owner), { groupId: g, membershipId: w.memberM.membershipId });
    expect((await w.service.publicationEligibility(SYSTEM, { groupId: g })).find((r) => r.membershipId === w.memberM.membershipId)).toMatchObject({ eligible: false,
      reasons: ['MEMBERSHIP_NOT_ACTIVE'] });
    expect(await code(w.service.publicationEligibility(as(w.member), { groupId: g }))).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('legacy consent reconciliation (records only, never fabricated)', () => {
  const base = { importSource: 'legacy-rebuild-staging:rebuild-staging-v1', decidedAt: '2026-10-09T00:00:00.000Z', decidedBy: 'sdd-review', acceptedPolicyVersions: ['2026-10-02-public-v1'] };
  it('without authoritative evidence every imported member is REQUIRES_RECONSENT; match presence is not even an input', () => {
    const subjects = ['member-aaaa', 'member-bbbb', 'member-cccc'].map((subjectRef) => ({ subjectRef, status: 'requires-reconciliation' as const }));
    const records = reconcileImportedConsents({ ...base, subjects, evidence: [] });
    expect(records.map((r) => [r.state, r.evidenceCodes])).toEqual(Array(3).fill(['REQUIRES_RECONSENT', ['NO_AUTHORITATIVE_CONSENT_EVIDENCE']]));
    expect(reconcileImportedConsents({ ...base, subjects, evidence: [] })).toEqual(records); // deterministic ids
  });
  it('SUPPORTED / UNSUPPORTED / CONFLICT classify evidence but still grant nothing', () => {
    const ev = (subjectRef: string, policyVersion: string, pub = true) => ({ subjectRef, kind: 'EXPLICIT_PRODUCT_CONSENT' as const, policyVersion, dataCollectionAllowed: true, publicDerivedAnalyticsAllowed: pub });
    const records = reconcileImportedConsents({ ...base, subjects: ['member-s', 'member-u', 'member-c', 'member-x'].map((subjectRef) => ({ subjectRef, status: 'requires-reconciliation' as const }))
      .concat([{ subjectRef: 'member-e', status: 'explicit' as never }]),
    evidence: [ev('member-s', '2026-10-02-public-v1'), ev('member-u', 'old-policy'), ev('member-c', '2026-10-02-public-v1'), ev('member-c', '2026-10-02-public-v1', false)] });
    expect(Object.fromEntries(records.map((r) => [r.subjectRef, r.state]))).toEqual({ 'member-c': 'CONFLICT', 'member-s': 'SUPPORTED', 'member-u': 'UNSUPPORTED', 'member-x': 'REQUIRES_RECONSENT' });
    expect(records.find((r) => r.subjectRef === 'member-s')?.evidenceCodes).toContain('EXPLICIT_REGRANT_REQUIRED');
    expect(Object.keys(records[0]!)).not.toContain('grants');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('sync jobs: outbound polling, leases, consent gate, idempotency', () => {
  async function ready() {
    const w = await world();
    await w.connect(w.member, 'subject-member-sync');
    await w.service.grantConsent(as(w.member), { groupId: w.group.groupId, grants: ['DATA_COLLECTION_ALLOWED'], policyVersion: 'p1' });
    return w;
  }

  it('requestSync creates metadata only; without consent the job is BLOCKED_CONSENT and never claimable', async () => {
    const w = await world();
    const { job } = await w.service.requestSync(as(w.member), { groupId: w.group.groupId });
    expect(job).toMatchObject({ state: 'BLOCKED_CONSENT', blockedReasons: ['IDENTITY_NOT_CONNECTED', 'DATA_COLLECTION_NOT_ALLOWED'] });
    expect(await w.service.pollJobs(WORKER_A)).toEqual([]);
    expect((await w.service.auditLog(SYSTEM)).some((a) => a.action === 'SYNC_BLOCKED')).toBe(true);
    expect(SyncStatusView.parse(await new ControlPlaneViews(w.service).syncStatus(as(w.member), job.jobId)).state).toBe('BLOCKED_CONSENT');
  });

  it('full lifecycle PENDING → CLAIMED → RUNNING → SUCCEEDED; duplicates are deduplicated; completion is idempotent', async () => {
    const w = await ready();
    const { job } = await w.service.requestSync(as(w.member), { groupId: w.group.groupId });
    expect((await w.service.requestSync(as(w.member), { groupId: w.group.groupId })).deduplicated).toBe(true);
    expect(await w.service.pollJobs(WORKER_A)).toEqual([{ jobId: job.jobId, groupId: w.group.groupId, membershipId: w.memberM.membershipId, state: 'PENDING', attempt: 0 }]);
    const { leaseToken } = await w.service.claimJob(WORKER_A, { jobId: job.jobId });
    expect(await code(w.service.claimJob(WORKER_B, { jobId: job.jobId }))).toBe('LEASE_CONFLICT');
    expect(await code(w.service.completeJob(WORKER_A, { jobId: job.jobId, leaseToken: leaseToken!, matchesIngested: 3 }))).toBe('INVALID_STATE'); // no CLAIMED → SUCCEEDED
    expect((await w.service.startJob(WORKER_A, { jobId: job.jobId, leaseToken: leaseToken! })).state).toBe('RUNNING');
    expect(await code(w.service.heartbeatJob(WORKER_B, { jobId: job.jobId, leaseToken: leaseToken! }))).toBe('LEASE_CONFLICT');
    expect(await code(w.service.heartbeatJob(WORKER_A, { jobId: job.jobId, leaseToken: 'x'.repeat(43) }))).toBe('LEASE_CONFLICT');
    expect((await w.service.heartbeatJob(WORKER_A, { jobId: job.jobId, leaseToken: leaseToken! })).proceed).toBe(true);
    const done = await w.service.completeJob(WORKER_A, { jobId: job.jobId, leaseToken: leaseToken!, matchesIngested: 3 });
    expect(done).toMatchObject({ state: 'SUCCEEDED', result: { outcome: 'SUCCEEDED', matchesIngested: 3 } });
    expect(await w.service.completeJob(WORKER_A, { jobId: job.jobId, leaseToken: leaseToken!, matchesIngested: 3 })).toEqual(done);
    expect(await code(w.service.completeJob(WORKER_A, { jobId: job.jobId, leaseToken: leaseToken!, matchesIngested: 4 }))).toBe('INVALID_STATE');
    expect(await code(w.service.failJob(WORKER_A, { jobId: job.jobId, leaseToken: leaseToken!, errorCode: 'LATE_FAILURE' }))).toBe('INVALID_STATE');
    expect(await code(w.service.pollJobs(as(w.member)))).toBe('UNAUTHENTICATED'); // users cannot act as workers
  });

  it('an expired lease is reclaimed safely; the old lease holder is fenced out', async () => {
    const w = await ready();
    const { job } = await w.service.requestSync(as(w.member), { groupId: w.group.groupId });
    const a = await w.service.claimJob(WORKER_A, { jobId: job.jobId, leaseMs: 5_000 });
    await w.service.startJob(WORKER_A, { jobId: job.jobId, leaseToken: a.leaseToken! });
    w.advance(5_001);
    expect((await w.service.pollJobs(WORKER_B)).map((j) => [j.jobId, j.state])).toEqual([[job.jobId, 'RUNNING']]);
    const b = await w.service.claimJob(WORKER_B, { jobId: job.jobId });
    expect(b.job).toMatchObject({ state: 'CLAIMED', attempt: 2, leaseOwner: 'wkr_local-b' });
    expect(await code(w.service.completeJob(WORKER_A, { jobId: job.jobId, leaseToken: a.leaseToken!, matchesIngested: 1 }))).toBe('LEASE_CONFLICT');
    await w.service.startJob(WORKER_B, { jobId: job.jobId, leaseToken: b.leaseToken! });
    expect((await w.service.failJob(WORKER_B, { jobId: job.jobId, leaseToken: b.leaseToken!, errorCode: 'PROVIDER_UNAVAILABLE' })).state).toBe('FAILED');
    expect((await w.service.auditLog(SYSTEM)).some((e) => e.action === 'SYNC_RECLAIMED')).toBe(true);
  });

  it('consent is re-checked before RUNNING and on heartbeat: revocation blocks the job and stops the worker', async () => {
    const w = await ready();
    const g = w.group.groupId;
    const { job } = await w.service.requestSync(as(w.member), { groupId: g });
    const claim = await w.service.claimJob(WORKER_A, { jobId: job.jobId });
    await w.service.revokeConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'] });
    expect((await w.service.getSyncStatus(as(w.member), { jobId: job.jobId })).state).toBe('BLOCKED_CONSENT');
    expect(await code(w.service.startJob(WORKER_A, { jobId: job.jobId, leaseToken: claim.leaseToken! }))).toBe('LEASE_CONFLICT'); // lease released on block
    await w.service.grantConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'], policyVersion: 'p1' });
    const second = (await w.service.requestSync(as(w.member), { groupId: g })).job;
    const c2 = await w.service.claimJob(WORKER_A, { jobId: second.jobId });
    await w.service.startJob(WORKER_A, { jobId: second.jobId, leaseToken: c2.leaseToken! });
    await w.service.revokeConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'] });
    expect((await w.service.heartbeatJob(WORKER_A, { jobId: second.jobId, leaseToken: c2.leaseToken! })).proceed).toBe(false);
  });

  it('job visibility: the member, OWNER and ADMIN may read a job; another MEMBER may not; cancellation is idempotent', async () => {
    const w = await ready();
    const { job } = await w.service.requestSync(as(w.member), { groupId: w.group.groupId });
    const other = await w.user('Other');
    await w.join(other);
    expect(await code(w.service.getSyncStatus(as(other), { jobId: job.jobId }))).toBe('FORBIDDEN');
    expect(await code(w.service.getSyncStatus(as(w.admin), { jobId: job.jobId }))).toBe('OK');
    expect((await w.service.cancelSync(as(w.member), { jobId: job.jobId })).state).toBe('CANCELLED');
    expect((await w.service.cancelSync(as(w.member), { jobId: job.jobId })).state).toBe('CANCELLED');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('revocation contract with the local data plane (synthetic data only)', () => {
  it('ERASE_ATTRIBUTABLE_SPATIAL_EVIDENCE removes the member’s precise spatial evidence and keeps shared match topology', async () => {
    const { sql, repository } = await freshDatabase();
    try {
      await seedDemoRoster(repository);
      await new IngestService(repository, new FakeProviderAdapter(), () => '2026-10-09T12:00:00.000Z').ingestGroup('group-demo', { maxMatchesPerAccount: 200 });
      const matchesBefore = (await repository.listMatchKeys()).length;
      const event = { type: 'DataRevocationRequested', eventId: 'evt_000000000000000000000001', groupId: 'grp_000000000000000000000001', membershipId: 'mbr_000000000000000000000001',
        revokedGrants: ['DATA_COLLECTION_ALLOWED'], scopes: ['STOP_FUTURE_SYNC', 'EXCLUDE_FROM_PUBLICATION', 'ERASE_ATTRIBUTABLE_SPATIAL_EVIDENCE'], requestedAt: '2026-10-09T12:00:00.000Z' };
      const resolve = (m: string) => (m === 'mbr_000000000000000000000001' ? 'member-nova' : null);
      const first = await applyDataRevocation(repository, event, resolve);
      expect(first.spatialErasure!.participants).toBeGreaterThan(0);
      expect(first.spatialErasure!.snapshotsDeleted + first.spatialErasure!.eventLocationsCleared).toBeGreaterThan(0);
      expect((await repository.listMatchKeys()).length).toBe(matchesBefore); // topology retained
      const again = await applyDataRevocation(repository, event, resolve);
      expect(again.spatialErasure).toMatchObject({ snapshotsDeleted: 0, eventLocationsCleared: 0, plantLocationsCleared: 0, defuseLocationsCleared: 0 });
      const pubOnly = await applyDataRevocation(repository, { ...event, eventId: 'evt_000000000000000000000002', scopes: ['EXCLUDE_FROM_PUBLICATION'] }, resolve);
      expect(pubOnly.spatialErasure).toBeNull();
      await expect(applyDataRevocation(repository, { ...event, scopes: ['DELETE_EVERYTHING'] }, resolve)).rejects.toThrow();
    } finally {
      await sql.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('audit, redaction and boundaries', () => {
  it('security-relevant actions are audited append-only, without tokens, hashes or subjects', async () => {
    const w = await world();
    const g = w.group.groupId;
    const subject = 'riot-subject-audit-0001';
    const { token, invite } = await w.service.createInvite(as(w.owner), { groupId: g });
    await w.service.revokeInvite(as(w.owner), { groupId: g, inviteId: invite.inviteId });
    await code(w.service.acceptInvite(as(w.outsider), { token }));
    await w.connect(w.member, subject);
    await w.service.grantConsent(as(w.member), { groupId: g, grants: ALL, policyVersion: 'p1' });
    await w.service.requestSync(as(w.member), { groupId: g });
    await w.service.revokeConsent(as(w.member), { groupId: g, grants: ['DATA_COLLECTION_ALLOWED'] });
    await w.service.removeMember(as(w.owner), { groupId: g, membershipId: w.memberM.membershipId });
    const audit = await w.service.auditLog(SYSTEM);
    const actions = new Set(audit.map((a) => a.action));
    for (const a of ['GROUP_CREATED', 'INVITE_CREATED', 'INVITE_REVOKED', 'INVITE_ACCEPTED', 'INVITE_REJECTED', 'IDENTITY_CONNECTED', 'CONSENT_GRANTED', 'CONSENT_REVOKED',
      'SYNC_REQUESTED', 'SYNC_BLOCKED', 'DATA_REVOCATION_REQUESTED', 'MEMBERSHIP_REMOVED']) expect(actions).toContain(a);
    await w.service.disconnectRiotConnection(as(w.member), { connectionId: (await w.service.myIdentityConnections(as(w.member)))[0]!.connectionId });
    expect((await w.service.auditLog(SYSTEM)).map((a) => a.action)).toContain('IDENTITY_DISCONNECTED');
    const text = JSON.stringify(await w.service.auditLog(SYSTEM));
    const hashes = (await w.repository.read((s) => s.listInvites())).map((i) => i.tokenHash);
    for (const secret of [token, subject, ...hashes]) expect(text).not.toContain(secret);
    expect(audit.map((a) => a.seq)).toEqual(audit.map((_, i) => i + 1));
    expect(findPrivateKeys(await new ControlPlaneViews(w.service).myGroups(as(w.owner)))).toEqual([]);
    expect(MyGroupsView.parse(await new ControlPlaneViews(w.service).myGroups(as(w.owner))).groups).toHaveLength(1);
  });

  it('transactions are atomic: a denied command leaves no partial writes', async () => {
    const w = await world();
    const before = await w.repository.read((s) => s.listInvites().length);
    await code(w.service.createInvite(as(w.member), { groupId: w.group.groupId }));
    expect(await w.repository.read((s) => s.listInvites().length)).toBe(before);
  });

  it('thin handlers forward to the domain; the local server binds to loopback only', async () => {
    const w = await world();
    expect(await dispatch(w.service, as(w.outsider), 'listMembers', { groupId: w.group.groupId })).toEqual({ status: 403, body: { error: 'FORBIDDEN' } });
    expect((await dispatch(w.service, as(w.owner), 'listGroups', {})).status).toBe(200);
    expect((await dispatch(w.service, as(w.owner), 'deleteEverything', {})).status).toBe(404);
    const { server, url } = await startLocalControlApi({ service: w.service, authenticate: (h) => (h === 'Bearer dev-owner' ? as(w.owner) : null) });
    try {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      const res = await fetch(`${url}/rpc/listGroups`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer dev-owner' }, body: '{}' });
      expect(res.status).toBe(200);
      expect((await fetch(`${url}/rpc/listGroups`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
      expect((await fetch(`${url}/rpc/listGroups`, { method: 'POST', headers: { 'content-type': 'text/plain', authorization: 'Bearer dev-owner' }, body: '{}' })).status).toBe(415);
    } finally {
      server.close();
    }
  });

  it('control plane stores no telemetry, calls no provider and imports no analytics (architecture gates)', async () => {
    const report = await analyzeArchitecture(process.cwd());
    for (const rule of ['CONTROL_PLANE_CANONICAL_TELEMETRY_IMPORTS', 'CONTROL_PLANE_CANONICAL_MATCH_STORAGE', 'CONTROL_PLANE_PROVIDER_NETWORK_CALLS', 'CONTROL_PLANE_ANALYTICS_IMPORTS']) {
      expect(report.counts[rule]).toBe(0);
    }
    const pkg = JSON.parse(await readFile('apps/control-api/package.json', 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(['@vsa/contracts']);
  });
});
