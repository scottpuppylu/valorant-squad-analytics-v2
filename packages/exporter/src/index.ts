import { createHash } from 'node:crypto';
import type { AnalysisResult } from '@vsa/contracts/analysis';
import type { ConsentState, Group, GroupMember } from '@vsa/contracts/control';
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
}

/**
 * Builds the public snapshot. A member appears ONLY with active membership plus both group-visibility and
 * public-derived-analytics consent. Every document passes the explicit allowlist serializer (unknown or private
 * fields throw) before it is serialized deterministically.
 */
export function buildPublicSnapshot(input: ExportInput): BuiltSnapshot {
  const consent = new Map(input.consents.map((c) => [c.memberId, c]));
  const visible = input.members
    .filter((m) => m.status === 'active' && consent.get(m.memberId)?.groupVisibilityAllowed === true && consent.get(m.memberId)?.publicDerivedAnalyticsAllowed === true)
    .sort((a, b) => a.memberId.localeCompare(b.memberId));
  const visibleIds = new Set(visible.map((m) => m.memberId));
  const pid = (memberId: string) => publicMemberId(input.group.groupId, memberId);
  const byMember = new Map(input.observations.map((o) => [o.memberId, o]));
  const lastTimes = visible.map((m) => byMember.get(m.memberId)?.lastObservedAt).filter((t): t is string => Boolean(t)).sort();

  const documents: Record<PublicFileKind, unknown> = {
    group: {
      snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
      group: { publicGroupId: publicGroupId(input.group.groupId), name: input.group.name },
      members: visible.map((m) => ({ publicMemberId: pid(m.memberId), displayName: m.displayName })),
      provenance: { historyCompleteness: input.analysis.scope.historyCompleteness, lifetimeComplete: false, summary: input.provenanceSummary },
      dataAsOf: lastTimes.at(-1) ?? null,
    },
    players: {
      snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
      players: visible.map((m) => {
        const o = byMember.get(m.memberId);
        return { publicMemberId: pid(m.memberId), displayName: m.displayName, matchesObserved: o?.matchesObserved ?? 0, firstObservedAt: o?.firstObservedAt ?? null, lastObservedAt: o?.lastObservedAt ?? null };
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
  };

  const files = (Object.keys(PUBLIC_FILE_NAMES) as PublicFileKind[]).map((kind): BuiltSnapshotFile => {
    const content = `${JSON.stringify(toPublicDocument(kind, documents[kind]), null, 2)}\n`;
    return { kind, name: PUBLIC_FILE_NAMES[kind], content, sha256: sha256(content), bytes: Buffer.byteLength(content, 'utf8') };
  });
  return { snapshotId: deriveSnapshotId(files), snapshotVersion: PUBLIC_SNAPSHOT_VERSION, files };
}
