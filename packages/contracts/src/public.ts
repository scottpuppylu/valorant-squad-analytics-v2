import { z } from 'zod';
import { GameMode, HistoryCompleteness, IsoInstant, NonNegativeInt, PublicGroupId, PublicMemberId } from './common.ts';
import { ANALYTICS_CONTRACT_VERSION, MANIFEST_VERSION, PUBLIC_SNAPSHOT_VERSION } from './versions.ts';

/**
 * PUBLIC contracts: everything a static snapshot may contain. Every object is `.strict()` (unknown fields rejected).
 * These shapes have NO field for provider account ids, raw match ids, participant ids, coordinates, view direction,
 * tokens, keys or database URLs — such data cannot be represented here at all. The explicit serializer allowlist lives
 * in @vsa/privacy and is tested to match these shapes.
 */
export const PublicProvenance = z.object({
  historyCompleteness: HistoryCompleteness,
  /** Always false: no source proves a complete career history. */
  lifetimeComplete: z.literal(false),
  summary: z.string().min(1).max(200),
}).strict();

export const PublicMember = z.object({
  publicMemberId: PublicMemberId,
  displayName: z.string().min(1).max(40),
}).strict();

export const PublicGroupSnapshot = z.object({
  snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
  group: z.object({ publicGroupId: PublicGroupId, name: z.string().min(1).max(80) }).strict(),
  members: z.array(PublicMember),
  provenance: PublicProvenance,
  /** Latest match start time represented in this snapshot (data-derived, deterministic). */
  dataAsOf: IsoInstant.nullable(),
}).strict();
export type PublicGroupSnapshot = z.infer<typeof PublicGroupSnapshot>;

export const PublicPlayer = z.object({
  publicMemberId: PublicMemberId,
  displayName: z.string().min(1).max(40),
  matchesObserved: NonNegativeInt,
  firstObservedAt: IsoInstant.nullable(),
  lastObservedAt: IsoInstant.nullable(),
}).strict();

export const PublicPlayerSnapshot = z.object({
  snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
  players: z.array(PublicPlayer),
}).strict();
export type PublicPlayerSnapshot = z.infer<typeof PublicPlayerSnapshot>;

export const PublicPlayerAnalysis = z.object({
  publicMemberId: PublicMemberId,
  algorithmId: z.string().min(1).max(60),
  sampleSize: z.object({ matches: NonNegativeInt, rounds: NonNegativeInt }).strict(),
  matchesPlayed: NonNegativeInt,
  wins: NonNegativeInt,
  losses: NonNegativeInt,
  kills: NonNegativeInt,
  deaths: NonNegativeInt,
  assists: NonNegativeInt,
  kd: z.number().nonnegative().nullable(),
  adr: z.number().nonnegative().nullable(),
  eligible: z.boolean(),
  eligibilityReasons: z.array(z.string().min(1).max(120)),
}).strict();

export const PublicAnalysisSnapshot = z.object({
  snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
  analyticsContractVersion: z.literal(ANALYTICS_CONTRACT_VERSION),
  scope: z.object({ mode: GameMode, historyCompleteness: HistoryCompleteness }).strict(),
  algorithms: z.array(z.object({ algorithmId: z.string().min(1).max(60), description: z.string().min(1).max(200) }).strict()),
  players: z.array(PublicPlayerAnalysis),
}).strict();
export type PublicAnalysisSnapshot = z.infer<typeof PublicAnalysisSnapshot>;

/** File names a snapshot may contain: plain names only — no directories, no traversal. */
export const PublicFileKind = z.enum(['group', 'players', 'analytics']);
export type PublicFileKind = z.infer<typeof PublicFileKind>;
export const PUBLIC_FILE_NAMES: Record<PublicFileKind, string> = { group: 'group.json', players: 'players.json', analytics: 'analytics.json' };

export const SnapshotId = z.string().regex(/^ps1-[0-9a-f]{16}$/u, 'content-derived snapshot id');

export const SnapshotFileEntry = z.object({
  kind: PublicFileKind,
  name: z.string().regex(/^[a-z][a-z0-9-]{0,40}\.json$/u, 'plain file name'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  bytes: z.number().int().positive(),
}).strict();

export const SnapshotManifest = z.object({
  manifestVersion: z.literal(MANIFEST_VERSION),
  active: z.object({
    snapshotId: SnapshotId,
    snapshotVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
    /** Always `snapshots/<snapshotId>` — validated, never free-form. */
    path: z.string().regex(/^snapshots\/ps1-[0-9a-f]{16}$/u),
    files: z.array(SnapshotFileEntry).min(1),
    /** Wall-clock activation time: metadata only, never part of the snapshot identity. */
    activatedAt: IsoInstant,
  }).strict(),
  /** Previously active snapshot ids, most recent first (rollback candidates). */
  history: z.array(SnapshotId).max(50),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.active.path !== `snapshots/${manifest.active.snapshotId}`) ctx.addIssue({ code: 'custom', message: 'path must equal snapshots/<snapshotId>' });
  const names = manifest.active.files.map((f) => f.name);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', message: 'duplicate file names' });
  for (const f of manifest.active.files) if (PUBLIC_FILE_NAMES[f.kind] !== f.name) ctx.addIssue({ code: 'custom', message: `file ${f.name} does not match kind ${f.kind}` });
});
export type SnapshotManifest = z.infer<typeof SnapshotManifest>;

/** Exporter → publisher hand-off (internal; the files are the public part). */
export interface BuiltSnapshotFile { kind: PublicFileKind; name: string; content: string; sha256: string; bytes: number }
export interface BuiltSnapshot { snapshotId: string; snapshotVersion: typeof PUBLIC_SNAPSHOT_VERSION; files: BuiltSnapshotFile[] }

export const PUBLIC_DOCUMENT_SCHEMAS = {
  group: PublicGroupSnapshot,
  players: PublicPlayerSnapshot,
  analytics: PublicAnalysisSnapshot,
} as const;
