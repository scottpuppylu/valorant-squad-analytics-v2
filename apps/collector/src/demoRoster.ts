import type { ConsentState, Group, GroupMember, SourceAccount } from '@vsa/contracts/control';
import { FAKE_ACCOUNTS } from '@vsa/source-adapters/fake';

/**
 * Synthetic demo group (fictional names). In the real product this comes from the control plane (invites + explicit
 * consent). "Pike" deliberately withholds PUBLIC derived analytics: the snapshot must not contain them.
 */
const T0 = '2026-09-01T00:00:00.000Z';
export const DEMO_GROUP: Group = { groupId: 'group-demo', slug: 'demo-squad', name: 'Demo Squad', visibility: 'invite-only', createdAt: T0 };

const NAMES = ['Nova', 'Rook', 'Vex', 'Kite', 'Juno', 'Pike'] as const;

export const DEMO_MEMBERS: GroupMember[] = NAMES.map((name) => ({
  memberId: `member-${name.toLowerCase()}`, groupId: DEMO_GROUP.groupId, displayName: name, status: 'active', joinedAt: T0,
}));

export const DEMO_SOURCE_ACCOUNTS: SourceAccount[] = NAMES.map((name, i) => ({
  accountId: `account-${name.toLowerCase()}`, memberId: `member-${name.toLowerCase()}`, providerId: 'fake',
  providerAccountRef: FAKE_ACCOUNTS[i]!.fakePuuid, isPrimary: true, linkedAt: T0,
}));

export const DEMO_CONSENTS: ConsentState[] = NAMES.map((name) => ({
  memberId: `member-${name.toLowerCase()}`, status: 'explicit', source: 'demo-fixture', identityConnected: true, dataCollectionAllowed: true, groupVisibilityAllowed: true,
  publicDerivedAnalyticsAllowed: name !== 'Pike', policyVersion: 'demo-consent-v1', updatedAt: T0,
}));
