import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { InMemoryControlPlane } from '@vsa/control-api';
import { analyzeArchitecture } from '../scripts/architecture.ts';

const clock = () => { let t = Date.UTC(2026, 9, 1); return () => new Date((t += 1000)); };

describe('control plane (metadata only)', () => {
  it('joining grants no consent; the four grants are independent but ordered', async () => {
    const cp = new InMemoryControlPlane(clock());
    const { group, owner } = await cp.createGroup({ name: 'Demo', slug: 'demo-squad', ownerDisplayName: 'Nova' });
    const invite = await cp.createInvite({ groupId: group.groupId, createdBy: owner.memberId, ttlHours: 24 });
    const member = await cp.acceptInvite({ inviteId: invite.inviteId, displayName: 'Rook' });
    await expect(cp.acceptInvite({ inviteId: invite.inviteId, displayName: 'Again' })).rejects.toThrow(/not open/u);
    await expect(cp.grantConsent({ memberId: member.memberId, grants: ['dataCollectionAllowed'], policyVersion: 'p1' })).rejects.toThrow(/requires identityConnected/u);
    const c = await cp.grantConsent({ memberId: member.memberId, grants: ['identityConnected', 'dataCollectionAllowed'], policyVersion: 'p1' });
    expect(c).toMatchObject({ identityConnected: true, dataCollectionAllowed: true, groupVisibilityAllowed: false, publicDerivedAnalyticsAllowed: false });
  });

  it('revoking collection cascades to visibility and public analytics', async () => {
    const cp = new InMemoryControlPlane(clock());
    const { owner } = await cp.createGroup({ name: 'Demo', slug: 'demo-squad', ownerDisplayName: 'Nova' });
    await cp.grantConsent({ memberId: owner.memberId, grants: ['identityConnected', 'dataCollectionAllowed', 'groupVisibilityAllowed', 'publicDerivedAnalyticsAllowed'], policyVersion: 'p1' });
    expect(await cp.revokeConsent({ memberId: owner.memberId, grants: ['dataCollectionAllowed'] }))
      .toMatchObject({ identityConnected: true, dataCollectionAllowed: false, groupVisibilityAllowed: false, publicDerivedAnalyticsAllowed: false });
  });

  it('sync jobs require collection consent and carry only a summary back (outbound poll model)', async () => {
    const cp = new InMemoryControlPlane(clock());
    const { group, owner } = await cp.createGroup({ name: 'Demo', slug: 'demo-squad', ownerDisplayName: 'Nova' });
    await expect(cp.requestSync({ groupId: group.groupId, memberId: owner.memberId })).rejects.toThrow(/consent required/u);
    await cp.grantConsent({ memberId: owner.memberId, grants: ['identityConnected', 'dataCollectionAllowed'], policyVersion: 'p1' });
    const job = await cp.requestSync({ groupId: group.groupId, memberId: owner.memberId });
    const [claimed] = await cp.claimPendingJobs(5);
    expect(claimed?.jobId).toBe(job.jobId);
    const done = await cp.completeJob({ jobId: job.jobId, status: 'succeeded', matchesIngested: 7 });
    expect(done).toMatchObject({ status: 'succeeded', summary: { matchesIngested: 7 } });
    expect(Object.keys(done).sort()).toEqual(['groupId', 'jobId', 'memberId', 'requestedAt', 'status', 'summary', 'updatedAt']);
  });

  it('cannot reach canonical telemetry: no canonical-data / analytics / canonical-contract imports', async () => {
    const report = await analyzeArchitecture(process.cwd());
    expect(report.counts.CONTROL_PLANE_CANONICAL_TELEMETRY_IMPORTS).toBe(0);
    const pkg = JSON.parse(await readFile('apps/control-api/package.json', 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(['@vsa/contracts']);
  });
});
