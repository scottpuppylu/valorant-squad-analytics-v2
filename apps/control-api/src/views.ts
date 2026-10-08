import { ConsentSettingsView, GroupMembersView, InviteView, MyGroupsView, SyncStatusView } from '@vsa/contracts/control';
import type { Principal } from './model.ts';
import type { ControlPlaneService } from './service.ts';

/**
 * Product-facing view contracts for a future UI (not wired into the public Pages demo). Every view is parsed with its
 * strict schema, so a token, token hash, provider subject or lease token can never be added by accident.
 */
export class ControlPlaneViews {
  private readonly service: ControlPlaneService;
  constructor(service: ControlPlaneService) {
    this.service = service;
  }

  async myGroups(principal: Principal): Promise<MyGroupsView> {
    const rows = await this.service.listGroups(principal);
    return MyGroupsView.parse({ groups: rows.map(({ group, membership }) => ({ groupId: group.groupId, name: group.name, visibility: group.visibility,
      archived: group.status === 'ARCHIVED', role: membership.role, membershipState: membership.state })) });
  }

  async groupMembers(principal: Principal, groupId: string): Promise<GroupMembersView> {
    const rows = await this.service.listMembers(principal, { groupId });
    return GroupMembersView.parse({ groupId, members: rows.map(({ membership, displayName }) => ({ membershipId: membership.membershipId, displayName, role: membership.role,
      state: membership.state })) });
  }

  async invite(principal: Principal, token: string): Promise<InviteView> {
    return InviteView.parse(await this.service.previewInvite(principal, { token }));
  }

  async consentSettings(principal: Principal, groupId: string): Promise<ConsentSettingsView> {
    const consent = await this.service.getConsent(principal, { groupId });
    return ConsentSettingsView.parse({ groupId, status: consent.status, grants: consent.grants, policyVersion: consent.policyVersion,
      identityConnections: await this.service.myIdentityConnections(principal),
      publicationEligible: (await this.service.myPublicationEligibility(principal, { groupId })).eligible });
  }

  async syncStatus(principal: Principal, jobId: string): Promise<SyncStatusView> {
    const job = await this.service.getSyncStatus(principal, { jobId });
    return SyncStatusView.parse({ jobId: job.jobId, state: job.state, requestedAt: job.createdAt, updatedAt: job.updatedAt, blockedReasons: job.blockedReasons,
      matchesIngested: job.result?.matchesIngested ?? null });
  }
}
