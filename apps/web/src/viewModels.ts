import type { PublicProductMetric, PublicProfile, PublicSharedMatchSnapshot, PublicTeamBuilderSnapshot } from '@vsa/contracts/public';
import type { ReadySnapshot } from './data/loadSnapshot.ts';

/**
 * PRESENTATION models (DashboardViewModel, PlayerProfileViewModel, CompareViewModel, SynergyViewModel, TeamBuilder*).
 * They only select, order and look up values that the snapshot already contains — no score is computed here or in any
 * React component. Ordering uses the accepted ranking comparator (status: available → partial → unavailable, then value).
 */
type SharedMember = PublicSharedMatchSnapshot['members'][number];
type SharedPair = PublicSharedMatchSnapshot['pairs'][number];
export type TeamResult = PublicTeamBuilderSnapshot['results'][number];

const STATUS_ORDER: Record<PublicProductMetric['status'], number> = { available: 0, partial: 1, unavailable: 2, insufficient: 3 };
/** Legacy `compareScoreResults` ordering (status priority, then value desc) — an ordering, not a score. */
export const compareMetrics = (a: PublicProductMetric, b: PublicProductMetric) =>
  STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.value ?? -Infinity) - (a.value ?? -Infinity);
export const hasValue = (m: PublicProductMetric) => m.value !== null && (m.status === 'available' || m.status === 'partial');

export interface DashboardRow { profile: PublicProfile; rank: number | null; shared: SharedMember | null }
export interface DashboardViewModel {
  groupName: string;
  coverage: ReadySnapshot['group']['coverage'];
  dataAsOf: string | null;
  memberCount: number;
  ranked: DashboardRow[];
  insufficient: DashboardRow[];
  sharedPairsWithEvidence: number;
  teamBuilderMaps: string[];
}

export function dashboardViewModel(s: ReadySnapshot): DashboardViewModel {
  const shared = new Map(s.sharedMatch.members.map((m) => [m.publicMemberId, m]));
  const rows = s.profiles.profiles.map((profile) => ({ profile, rank: null as number | null, shared: shared.get(profile.publicMemberId) ?? null }))
    .sort((a, b) => compareMetrics(a.profile.currentStrength, b.profile.currentStrength) || a.profile.displayName.localeCompare(b.profile.displayName));
  const ranked = rows.filter((r) => hasValue(r.profile.currentStrength)).map((r, i) => ({ ...r, rank: i + 1 }));
  return {
    groupName: s.group.group.name, coverage: s.group.coverage, dataAsOf: s.group.dataAsOf, memberCount: s.group.members.length,
    ranked, insufficient: rows.filter((r) => !hasValue(r.profile.currentStrength)),
    sharedPairsWithEvidence: s.sharedMatch.pairs.filter((p) => p.eligibility.eligible).length,
    teamBuilderMaps: s.teamBuilder.maps,
  };
}

export interface PlayerProfileViewModel {
  profile: PublicProfile;
  basic: ReadySnapshot['analytics']['players'][number] | null;
  player: ReadySnapshot['players']['players'][number] | null;
  shared: SharedMember | null;
  partners: { pair: SharedPair; partnerId: string; partnerName: string; mine: 'A' | 'B' }[];
}

export function profileViewModel(s: ReadySnapshot, memberId: string): PlayerProfileViewModel | null {
  const profile = s.profiles.profiles.find((p) => p.publicMemberId === memberId);
  if (!profile) return null;
  const name = new Map(s.group.members.map((m) => [m.publicMemberId, m.displayName]));
  return {
    profile,
    basic: s.analytics.players.find((p) => p.publicMemberId === memberId) ?? null,
    player: s.players.players.find((p) => p.publicMemberId === memberId) ?? null,
    shared: s.sharedMatch.members.find((m) => m.publicMemberId === memberId) ?? null,
    partners: s.sharedMatch.pairs.filter((p) => p.memberA === memberId || p.memberB === memberId)
      .map((pair) => { const mine = pair.memberA === memberId ? 'A' as const : 'B' as const; const partnerId = mine === 'A' ? pair.memberB : pair.memberA;
        return { pair, partnerId, partnerName: name.get(partnerId) ?? '?', mine }; })
      .sort((x, y) => y.pair.sharedMatches - x.pair.sharedMatches || x.partnerName.localeCompare(y.partnerName)),
  };
}

/** A pair seen from member `a`'s side (A/B in the snapshot follow an internal order, never "who is better"). */
export interface OrientedPair { sharedMatches: number; scoredMatches: number; competitiveMatches: number; unratedMatches: number; sameTeamMatches: number;
  ratingA: number | null; ratingB: number | null; difference: number | null; aAhead: number; bAhead: number; neutral: number; confidence: number; eligible: boolean; reasons: SharedPair['eligibility']['reasons'] }

export function orientPair(pair: SharedPair, a: string): OrientedPair {
  const flip = pair.memberA !== a;
  return {
    sharedMatches: pair.sharedMatches, scoredMatches: pair.scoredMatches, competitiveMatches: pair.competitiveMatches, unratedMatches: pair.unratedMatches, sameTeamMatches: pair.sameTeamMatches,
    ratingA: flip ? pair.ratingB : pair.ratingA, ratingB: flip ? pair.ratingA : pair.ratingB,
    difference: pair.relativeDifference === null ? null : flip ? -pair.relativeDifference : pair.relativeDifference,
    aAhead: flip ? pair.bOutperformed : pair.aOutperformed, bAhead: flip ? pair.aOutperformed : pair.bOutperformed, neutral: pair.neutral,
    confidence: pair.confidence, eligible: pair.eligibility.eligible, reasons: pair.eligibility.reasons,
  };
}

export interface CompareViewModel { a: PlayerProfileViewModel; b: PlayerProfileViewModel; pair: OrientedPair | null }

export function compareViewModel(s: ReadySnapshot, a: string | null, b: string | null): CompareViewModel | null {
  if (!a || !b || a === b) return null;
  const va = profileViewModel(s, a); const vb = profileViewModel(s, b);
  if (!va || !vb) return null;
  const pair = s.sharedMatch.pairs.find((p) => (p.memberA === a && p.memberB === b) || (p.memberA === b && p.memberB === a));
  return { a: va, b: vb, pair: pair ? orientPair(pair, a) : null };
}

/** Compare selection: two distinct members; choosing the other slot's member swaps the slots. */
export function selectCompare(current: { a: string | null; b: string | null }, slot: 'a' | 'b', memberId: string | null) {
  const other = slot === 'a' ? 'b' : 'a';
  if (memberId && current[other] === memberId) return { ...current, [slot]: memberId, [other]: current[slot] };
  return { ...current, [slot]: memberId };
}

export interface SynergyViewModel {
  members: (SharedMember & { name: string })[];
  pairs: (SharedPair & { nameA: string; nameB: string })[];
  coverage: PublicSharedMatchSnapshot['coverage'];
  algorithm: PublicSharedMatchSnapshot['algorithm'];
}

export function synergyViewModel(s: ReadySnapshot): SynergyViewModel {
  const name = new Map(s.group.members.map((m) => [m.publicMemberId, m.displayName]));
  return {
    members: s.sharedMatch.members.map((m) => ({ ...m, name: name.get(m.publicMemberId) ?? '?' }))
      .sort((x, y) => (x.combined.rating === null ? 1 : 0) - (y.combined.rating === null ? 1 : 0) || (y.combined.rating ?? 0) - (x.combined.rating ?? 0) || x.name.localeCompare(y.name)),
    pairs: s.sharedMatch.pairs.map((p) => ({ ...p, nameA: name.get(p.memberA) ?? '?', nameB: name.get(p.memberB) ?? '?' }))
      .sort((x, y) => y.sharedMatches - x.sharedMatches || x.nameA.localeCompare(y.nameA) || x.nameB.localeCompare(y.nameB)),
    coverage: s.sharedMatch.coverage, algorithm: s.sharedMatch.algorithm,
  };
}

// ---------------------------------------------------------------- Team Builder (lookup into precomputed results)
export const TEAM_SIZE = 5;
export interface TeamSelection { members: string[]; map: string | null }

/** Toggle a member; never more than five (a sixth pick is ignored, not silently swapped). */
export function toggleMember(selection: TeamSelection, memberId: string): TeamSelection {
  if (selection.members.includes(memberId)) return { ...selection, members: selection.members.filter((m) => m !== memberId) };
  if (selection.members.length >= TEAM_SIZE) return selection;
  return { ...selection, members: [...selection.members, memberId] };
}

export const canCalculate = (selection: TeamSelection, maps: readonly string[]) =>
  selection.members.length === TEAM_SIZE && new Set(selection.members).size === TEAM_SIZE && selection.map !== null && maps.includes(selection.map);

/** The precomputed result for exactly these five members on this map (order-independent), or null. */
export function findTeamResult(doc: PublicTeamBuilderSnapshot, selection: TeamSelection): TeamResult | null {
  if (!canCalculate(selection, doc.maps)) return null;
  const key = [...selection.members].sort().join(',');
  return doc.results.find((r) => r.map === selection.map && [...r.memberIds].sort().join(',') === key) ?? null;
}
