import { createHash } from 'node:crypto';
import type { CanonicalReadRepository } from '@vsa/canonical-data';

/**
 * Deterministic, group-scoped dataset fingerprint over canonical SEMANTIC content: members, accounts, consent, every
 * canonical match of the group's members (full JSON, ordered by key) and their rank evidence. Excluded by construction: sequences, wall-clock import times,
 * checkpoint rows. Returned as `cdfp-v1:<sha256>`.
 */
export async function canonicalDatasetFingerprint(repository: CanonicalReadRepository, groupId: string): Promise<{ fingerprint: string; matches: number }> {
  const hash = createHash('sha256');
  const line = (kind: string, value: unknown) => hash.update(`${kind}\u0000${JSON.stringify(value)}\n`, 'utf8');
  const members = await repository.listMembers(groupId);
  for (const m of members) line('member', m);
  for (const a of await repository.listSourceAccounts(groupId)) line('account', a);
  for (const c of await repository.listConsents(groupId)) line('consent', c);
  // Group-scoped: only matches with at least one of this group's members (other groups' data never changes this value).
  const keys = [...(await repository.listMatchKeysForMembers(members.map((m) => m.memberId)))].sort();
  for (let i = 0; i < keys.length; i += 25) {
    for (const match of await repository.getMatches(keys.slice(i, i + 25))) line('match', match);
  }
  for (const r of await repository.listRankContext(members.map((m) => m.memberId))) line('rank', r);
  return { fingerprint: `cdfp-v1:${hash.digest('hex')}`, matches: keys.length };
}
