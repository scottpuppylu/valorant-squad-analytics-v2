import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { ProviderConflictError } from './errors.ts';

/**
 * Multi-source logical-match identity (`logical-match-identity-v1`, docs/PROVIDER_ARCHITECTURE.md).
 *
 * EXACT evidence only:
 *   SAME_RECORD   the same (provider namespace, provider record ref) → the same derived `matchKey`
 *                 (e.g. a legacy import and a live Henrik fetch of one Henrik match).
 *   EXACT_LINKED  an explicit, recorded cross-provider link whose evidence is a provider-DOCUMENTED id equivalence or
 *                 an operator verification. No link is ever created automatically — in particular a Henrik match id is
 *                 never assumed to equal a Riot match id, and an Overwolf pseudo id never equals anything.
 * CANDIDATE evidence (same map and mode, start within 120 s, same participant count) is a review hint only and is
 * NEVER merged. Everything else is DISTINCT. Records whose identity is unproven stay separate.
 * Exact pairs are compared on provider-neutral facts; any difference is PROVIDER_CONFLICT (no merge, no winner).
 */
export const LOGICAL_MATCH_IDENTITY_VERSION = 'logical-match-identity-v1';
export const CANDIDATE_START_WINDOW_MS = 120_000;

export type MatchIdentityRelation = 'SAME_RECORD' | 'EXACT_LINKED' | 'CANDIDATE' | 'DISTINCT';

export interface CrossProviderLink {
  left: { providerId: string; providerRecordRef: string };
  right: { providerId: string; providerRecordRef: string };
  evidence: 'provider-documented-id-equivalence' | 'operator-verified';
}

const linked = (a: CanonicalMatch, b: CanonicalMatch, links: readonly CrossProviderLink[]) => links.some((l) => {
  const is = (side: CrossProviderLink['left'], m: CanonicalMatch) => side.providerId === m.source.providerId && side.providerRecordRef === m.source.providerRecordRef;
  return (is(l.left, a) && is(l.right, b)) || (is(l.left, b) && is(l.right, a));
});

/** Provider-neutral facts two exact records of one real match must share. Returns differing field NAMES only. */
export function factConflicts(a: CanonicalMatch, b: CanonicalMatch): string[] {
  const out: string[] = [];
  if (a.mapId !== null && b.mapId !== null && a.mapId !== b.mapId) out.push('mapId');
  if (a.mode !== b.mode) out.push('mode');
  if (Math.floor(Date.parse(a.startedAt) / 1000) !== Math.floor(Date.parse(b.startedAt) / 1000)) out.push('startedAt');
  if (a.participants.length !== b.participants.length) out.push('participants');
  const score = (m: CanonicalMatch) => m.teams.map((t) => `${t.roundsWon ?? '?'}-${t.roundsLost ?? '?'}`).sort().join(',');
  if (a.teams.length !== b.teams.length || score(a) !== score(b)) out.push('teams');
  if (a.evidence.rounds === 'observed' && b.evidence.rounds === 'observed' && a.rounds.length !== b.rounds.length) out.push('rounds');
  if (a.evidence.kills === 'observed' && b.evidence.kills === 'observed' && a.events.length !== b.events.length) out.push('kills');
  return out;
}

export function relateMatches(a: CanonicalMatch, b: CanonicalMatch, links: readonly CrossProviderLink[] = []): { relation: MatchIdentityRelation; conflicts: string[] } {
  if (a.matchKey === b.matchKey) return { relation: 'SAME_RECORD', conflicts: factConflicts(a, b) };
  if (linked(a, b, links)) return { relation: 'EXACT_LINKED', conflicts: factConflicts(a, b) };
  const near = Math.abs(Date.parse(a.startedAt) - Date.parse(b.startedAt)) <= CANDIDATE_START_WINDOW_MS;
  if (near && a.mapId !== null && a.mapId === b.mapId && a.mode === b.mode && a.participants.length === b.participants.length) return { relation: 'CANDIDATE', conflicts: [] };
  return { relation: 'DISTINCT', conflicts: [] };
}

/** Throws PROVIDER_CONFLICT when two exact records disagree; never picks a winner. */
export function assertConsistent(a: CanonicalMatch, b: CanonicalMatch, links: readonly CrossProviderLink[] = []): MatchIdentityRelation {
  const { relation, conflicts } = relateMatches(a, b, links);
  if ((relation === 'SAME_RECORD' || relation === 'EXACT_LINKED') && conflicts.length) throw new ProviderConflictError([a.source.providerId, b.source.providerId], conflicts);
  return relation;
}

export interface LogicalMatchGrouping {
  /** Groups of canonical match keys proven to be one real match (singletons included). Evidence is never combined. */
  groups: string[][];
  candidates: [string, string][];
  conflicts: { matchKeys: [string, string]; fields: string[] }[];
}

/** Group by exact evidence only. Conflicting exact pairs are NOT grouped; candidates are listed, never grouped. */
export function groupLogicalMatches(matches: readonly CanonicalMatch[], links: readonly CrossProviderLink[] = []): LogicalMatchGrouping {
  const keys = [...new Set(matches.map((m) => m.matchKey))].sort();
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k: string): string => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const candidates: [string, string][] = [];
  const conflicts: LogicalMatchGrouping['conflicts'] = [];
  const sorted = [...matches].sort((x, y) => (x.matchKey + x.source.acquisitionSource < y.matchKey + y.source.acquisitionSource ? -1 : 1));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]!; const b = sorted[j]!;
      const { relation, conflicts: fields } = relateMatches(a, b, links);
      const pair: [string, string] = [a.matchKey, b.matchKey];
      if (relation === 'CANDIDATE') candidates.push(pair);
      else if ((relation === 'SAME_RECORD' || relation === 'EXACT_LINKED') && fields.length) conflicts.push({ matchKeys: pair, fields });
      else if (relation === 'EXACT_LINKED') parent.set(find(b.matchKey), find(a.matchKey));
    }
  }
  const groups = new Map<string, string[]>();
  for (const k of keys) groups.set(find(k), [...(groups.get(find(k)) ?? []), k]);
  return { groups: [...groups.values()].map((g) => g.sort()).sort((x, y) => (x[0]! < y[0]! ? -1 : 1)), candidates, conflicts };
}
