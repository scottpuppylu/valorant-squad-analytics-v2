import { createHash } from 'node:crypto';
import type { AnalysisResult } from '@vsa/contracts/analysis';
import type { ConsentState, Group, GroupMember } from '@vsa/contracts/control';
import type { ProductAnalytics } from '@vsa/contracts/product';
import { PUBLIC_FILE_NAMES, type BuiltSnapshot, type BuiltSnapshotFile, type PublicFileKind } from '@vsa/contracts/public';
import { PUBLIC_SNAPSHOT_VERSION } from '@vsa/contracts/versions';
import { toPublicDocument } from '@vsa/privacy';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Public ids are derived and non-reversible; they are never a provider account id or an internal id. */
export const publicMemberId = (groupId: string, memberId: string) => `m_${sha256(`public-member-id-v1:${groupId}:${memberId}`).slice(0, 16)}`;
export const publicGroupId = (groupId: string) => `g_${sha256(`public-group-id-v1:${groupId}`).slice(0, 16)}`;

/** Content-derived snapshot identity: schema version + every file's name and hash (no wall clock). */
export function deriveSnapshotId(files: readonly Pick<BuiltSnapshotFile, 'name' | 'sha256'>[]): string {
  const material = [PUBLIC_SNAPSHOT_VERSION, ...[...files].sort((a, b) => a.name.localeCompare(b.name)).map((f) => `${f.name}\u0000${f.sha256}`)].join('\n');
  return `ps1-${sha256(material).slice(0, 16)}`;
}

export interface ExportInput {
  group: Group;
  members: readonly GroupMember[];
  consents: readonly ConsentState[];
  analysis: AnalysisResult;
  algorithms: readonly { algorithmId: string; description: string }[];
  observations: readonly { memberId: string; matchesObserved: number; firstObservedAt: string | null; lastObservedAt: string | null }[];
  provenanceSummary: string;
  /** product-contract-v1 read models, computed over the VISIBLE population only (see visibleMemberIds). */
  product: ProductAnalytics;
}

/** Members that may appear publicly: active membership plus group-visibility AND public-derived-analytics consent. */
export function visibleMemberIds(members: readonly GroupMember[], consents: readonly ConsentState[]): string[] {
  const consent = new Map(consents.map((c) => [c.memberId, c]));
  return members.filter((m) => m.status === 'active' && consent.get(m.memberId)?.groupVisibilityAllowed === true && consent.get(m.memberId)?.publicDerivedAnalyticsAllowed === true)
    .map((m) => m.memberId).sort();
}

export class ExportPopulationError extends Error {}

/** Every internal member id the product read model mentions. */
export function productMemberIds(product: ProductAnalytics): Set<string> {
  return new Set([
    ...product.profiles.map((p) => p.memberId), ...product.sharedMatch.members.map((m) => m.memberId),
    ...product.sharedMatch.pairs.flatMap((p) => [p.memberA, p.memberB]), ...product.teamBuilder.results.flatMap((r) => r.memberIds),
  ]);
}

/**
 * Builds the public snapshot. A member appears ONLY with active membership plus both group-visibility and
 * public-derived-analytics consent, and the product read models must have been computed over exactly that population
 * (a withheld member's evidence never enters public analytics — enforced here, not assumed). Every document passes the
 * explicit allowlist serializer (unknown or private fields throw) before it is serialized deterministically.
 */
export function buildPublicSnapshot(input: ExportInput): BuiltSnapshot {
  const visibleIds = new Set(visibleMemberIds(input.members, input.consents));
  const visible = input.members.filter((m) => visibleIds.has(m.memberId)).sort((a, b) => a.memberId.localeCompare(b.memberId));
  const product = input.product;
  for (const id of productMemberIds(product)) if (!visibleIds.has(id)) throw new ExportPopulationError('product analytics contain a member outside the visible population');
  const pid = (memberId: string) => publicMemberId(input.group.groupId, memberId);
  const name = new Map(visible.map((m) => [m.memberId, m.displayName]));
  const profileOf = new Map(product.profiles.map((p) => [p.memberId, p]));
  const byMember = new Map(input.observations.map((o) => [o.memberId, o]));
  const lastTimes = visible.map((m) => byMember.get(m.memberId)?.lastObservedAt).filter((t): t is string => Boolean(t)).sort();

  const documents: Record<PublicFileKind, unknown> = {
    group: {
      snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
      group: { publicGroupId: publicGroupId(input.group.groupId), name: input.group.name },
      members: visible.map((m) => ({ publicMemberId: pid(m.memberId), displayName: m.displayName })),
      provenance: { historyCompleteness: input.analysis.scope.historyCompleteness, lifetimeComplete: false, summary: input.provenanceSummary },
      coverage: { ...product.coverage },
      dataAsOf: lastTimes.at(-1) ?? null,
    },
    players: {
      snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
      players: visible.map((m) => {
        const o = byMember.get(m.memberId);
        return { publicMemberId: pid(m.memberId), displayName: m.displayName, matchesObserved: o?.matchesObserved ?? 0, competitiveMatches: profileOf.get(m.memberId)?.competitiveMatches ?? 0,
          firstObservedAt: o?.firstObservedAt ?? null, lastObservedAt: o?.lastObservedAt ?? null };
      }),
    },
    analytics: {
      snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
      analyticsContractVersion: input.analysis.analyticsContractVersion,
      scope: { ...input.analysis.scope },
      algorithms: input.algorithms.map((a) => ({ algorithmId: a.algorithmId, description: a.description })),
      // metrics / sampleSize are spread on purpose: anything accidentally attached to them is caught by the serializer.
      players: input.analysis.players.filter((p) => visibleIds.has(p.memberId)).map((p) => ({
        publicMemberId: pid(p.memberId), algorithmId: p.algorithmId, sampleSize: { ...p.sampleSize }, ...p.metrics,
        eligible: p.eligibility.eligible, eligibilityReasons: [...p.eligibility.reasons],
      })),
    },
    profiles: {
      snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
      productContractVersion: product.productContractVersion,
      profiles: [...product.profiles].sort((a, b) => a.memberId.localeCompare(b.memberId))
        .map(({ memberId, ...rest }) => ({ publicMemberId: pid(memberId), displayName: name.get(memberId)!, ...rest })),
    },
    'shared-match': {
      snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
      productContractVersion: product.productContractVersion,
      algorithm: { version: product.sharedMatch.version, evidenceVersion: product.sharedMatch.evidenceVersion, neutralSigma: product.sharedMatch.neutralSigma,
        shrinkK: product.sharedMatch.shrinkK, minMatches: product.sharedMatch.minMatches },
      members: product.sharedMatch.members.map(({ memberId, ...rest }) => ({ publicMemberId: pid(memberId), ...rest })),
      pairs: product.sharedMatch.pairs.map(({ memberA, memberB, ...rest }) => ({ memberA: pid(memberA), memberB: pid(memberB), ...rest })),
      coverage: { ...product.sharedMatch.coverage },
    },
    'team-builder': {
      snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
      productContractVersion: product.productContractVersion,
      algorithm: { v1Version: product.teamBuilder.v1Version, v2Version: product.teamBuilder.v2Version, fitVersion: product.teamBuilder.fitVersion,
        teamFitSemantics: 'historical-relative-lineup-fit', isWinProbability: false, isProvenOptimalLineup: false },
      maps: [...product.teamBuilder.maps],
      emittableAttack: [...product.teamBuilder.emittableAttack], emittableDefense: [...product.teamBuilder.emittableDefense], withheldLabels: [...product.teamBuilder.withheldLabels],
      results: product.teamBuilder.results.map((r) => ({
        ...r, memberIds: r.memberIds.map(pid),
        lineups: r.lineups.map((l) => ({ ...l, members: l.members.map(({ memberId, ...m }) => ({ publicMemberId: pid(memberId), ...m })) })),
      })),
    },
  };

  const files = (Object.keys(PUBLIC_FILE_NAMES) as PublicFileKind[]).map((kind): BuiltSnapshotFile => {
    // Small documents stay human-readable; the product documents are compact (the Team Builder table can be large).
    const compact = kind === 'profiles' || kind === 'shared-match' || kind === 'team-builder';
    const content = `${JSON.stringify(toPublicDocument(kind, documents[kind]), null, compact ? 0 : 2)}\n`;
    return { kind, name: PUBLIC_FILE_NAMES[kind], content, sha256: sha256(content), bytes: Buffer.byteLength(content, 'utf8') };
  });
  return { snapshotId: deriveSnapshotId(files), snapshotVersion: PUBLIC_SNAPSHOT_VERSION, files };
}
