import { createHash } from 'node:crypto';
import type { ConsentState, Group, GroupMember, SourceAccount } from '@vsa/contracts/control';
import type { LegacyAccountRow } from './legacySchema.ts';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * V2 internal identities are DERIVED (deterministic → idempotent re-import) and NOT equal to any provider id, Riot PUUID
 * or legacy primary key: `member-<h>` / `account-<h>` where h = SHA-256 over a V2 namespace + the legacy public id.
 * Provider identities live only in source_accounts.provider_account_ref (private).
 */
export const v2MemberId = (legacyMemberPublicId: string) => `member-${sha(`vsa-v2-member-v1|legacy-rebuild-staging|${legacyMemberPublicId}`).slice(0, 16)}`;
export const v2AccountId = (legacyAccountPublicId: string) => `account-${sha(`vsa-v2-account-v1|legacy-rebuild-staging|${legacyAccountPublicId}`).slice(0, 16)}`;
/** Hash of a source record reference for import checkpoints (the raw provider id is never stored there). */
export const sourceRefHash = (providerMatchId: string) => sha(`vsa-v2-source-ref-v1|legacy-rebuild-staging|${providerMatchId}`);

export const IMPORT_GROUP: Group = { groupId: 'group-goblin', slug: 'goblin-squad', name: '哥布林', visibility: 'invite-only', createdAt: '2026-10-08T00:00:00.000Z' };
const IMPORTED_AT = '2026-10-08T00:00:00.000Z';

export interface IdentityPlan {
  members: GroupMember[];
  accounts: SourceAccount[];
  consents: ConsentState[];
  /** Provider account ref → internal ids (private, in-memory only). */
  resolver: Map<string, { memberId: string; accountId: string }>;
  /** legacy account public id → internal ids (rank evidence join). */
  byLegacyAccount: Map<string, { memberId: string; accountId: string }>;
  unresolvedAccounts: number;
  collisions: string[];
}

/**
 * Members, multi-account linkage and consent. Consent is NEVER inferred from evidence: every imported member gets
 * status `requires-reconciliation` with every grant false (legacy staging carries no consent records).
 */
export function planIdentities(rows: readonly LegacyAccountRow[]): IdentityPlan {
  const collisions: string[] = [];
  const byMember = new Map<string, LegacyAccountRow[]>();
  for (const row of rows) byMember.set(row.member_public_id, [...(byMember.get(row.member_public_id) ?? []), row]);
  const members: GroupMember[] = []; const accounts: SourceAccount[] = []; const consents: ConsentState[] = [];
  const resolver = new Map<string, { memberId: string; accountId: string }>();
  const byLegacyAccount = new Map<string, { memberId: string; accountId: string }>();
  let unresolvedAccounts = 0;
  for (const legacyMemberId of [...byMember.keys()].sort()) {
    const memberRows = byMember.get(legacyMemberId)!;
    const memberId = v2MemberId(legacyMemberId);
    const names = [...new Set(memberRows.map((r) => r.community_name))];
    if (names.length !== 1) collisions.push(`member has ${names.length} community names`);
    const primaries = memberRows.filter((r) => r.is_primary);
    if (primaries.length > 1) collisions.push('member has more than one primary account');
    members.push({ memberId, groupId: IMPORT_GROUP.groupId, displayName: [...names].sort()[0]!, status: 'active', joinedAt: IMPORTED_AT });
    consents.push({ memberId, status: 'requires-reconciliation', source: 'legacy-import', identityConnected: false, dataCollectionAllowed: false,
      groupVisibilityAllowed: false, publicDerivedAnalyticsAllowed: false, policyVersion: 'unreconciled', updatedAt: IMPORTED_AT });
    for (const row of [...memberRows].sort((a, b) => a.account_public_id.localeCompare(b.account_public_id))) {
      const accountId = v2AccountId(row.account_public_id);
      byLegacyAccount.set(row.account_public_id, { memberId, accountId });
      if (!row.provider_puuid) { unresolvedAccounts += 1; continue; }
      if (resolver.has(row.provider_puuid)) { collisions.push('one provider identity is linked to more than one account'); continue; }
      resolver.set(row.provider_puuid, { memberId, accountId });
      accounts.push({ accountId, memberId, providerId: 'henrik', providerAccountRef: row.provider_puuid, isPrimary: row.is_primary && primaries.length === 1, linkedAt: IMPORTED_AT });
    }
  }
  return { members, accounts, consents, resolver, byLegacyAccount, unresolvedAccounts, collisions };
}
