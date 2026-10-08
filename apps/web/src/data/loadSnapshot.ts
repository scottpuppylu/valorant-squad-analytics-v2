import type {
  PublicAnalysisSnapshot, PublicFileKind, PublicGroupSnapshot, PublicPlayerSnapshot, PublicProfileSnapshot, PublicSharedMatchSnapshot, PublicTeamBuilderSnapshot, SnapshotManifest,
} from '@vsa/contracts/public';
import { MANIFEST_VERSION, PUBLIC_SNAPSHOT_VERSION } from '@vsa/contracts/versions';
import { PrivacyViolation, validateManifest, validatePublicDocument } from '@vsa/privacy';

/** The static data path: manifest.json → immutable snapshot files. No database, no provider, no server API. */
export type SnapshotState =
  | { status: 'loading' }
  | ({ status: 'ready'; manifest: SnapshotManifest } & SnapshotDocuments)
  | { status: 'empty'; detail: string }
  | { status: 'invalid-manifest'; detail: string }
  | { status: 'unsupported-version'; detail: string }
  | { status: 'missing-snapshot'; detail: string }
  | { status: 'privacy-failure'; detail: string };

/** Every document a v2 snapshot must contain (validated, strict). */
export interface SnapshotDocuments {
  group: PublicGroupSnapshot; players: PublicPlayerSnapshot; analytics: PublicAnalysisSnapshot;
  profiles: PublicProfileSnapshot; sharedMatch: PublicSharedMatchSnapshot; teamBuilder: PublicTeamBuilderSnapshot;
}
export type ReadySnapshot = Extract<SnapshotState, { status: 'ready' }>;

export interface FetchedText { ok: boolean; status: number; text(): Promise<string> }
export type Fetcher = (path: string, init?: { cache?: 'no-store' | 'default' }) => Promise<FetchedText>;

/**
 * SHA-256 via Web Crypto, or null where `crypto.subtle` is unavailable (browsers expose it only in secure contexts:
 * https or localhost). The hash check guards against partial/corrupt reads; privacy validation always runs regardless.
 */
async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const describe = (error: unknown) => (error instanceof PrivacyViolation ? error.violations.slice(0, 3).join('; ') : error instanceof Error ? error.message : String(error));

export async function loadSnapshot(fetcher: Fetcher, base = 'public-data'): Promise<SnapshotState> {
  let response: FetchedText;
  try {
    response = await fetcher(`${base}/manifest.json`, { cache: 'no-store' });
  } catch (error) {
    return { status: 'invalid-manifest', detail: `manifest could not be loaded: ${describe(error)}` };
  }
  if (response.status === 404) return { status: 'empty', detail: 'No snapshot has been published yet.' };
  if (!response.ok) return { status: 'invalid-manifest', detail: `manifest request failed (${response.status})` };

  let raw: unknown;
  try { raw = JSON.parse(await response.text()); } catch { return { status: 'invalid-manifest', detail: 'manifest is not valid JSON' }; }
  const peek = raw as { manifestVersion?: unknown; active?: { snapshotVersion?: unknown } } | null;
  if (peek?.manifestVersion !== MANIFEST_VERSION || peek.active?.snapshotVersion !== PUBLIC_SNAPSHOT_VERSION) {
    return { status: 'unsupported-version', detail: `manifest ${String(peek?.manifestVersion)} / snapshot ${String(peek?.active?.snapshotVersion)} (supported: ${MANIFEST_VERSION} / ${PUBLIC_SNAPSHOT_VERSION})` };
  }
  let manifest: SnapshotManifest;
  try { manifest = validateManifest(raw); } catch (error) { return { status: 'invalid-manifest', detail: describe(error) }; }

  const documents: Partial<Record<PublicFileKind, unknown>> = {};
  for (const file of manifest.active.files) {
    // path and name are fixed patterns validated above: no traversal is expressible.
    const fileResponse = await fetcher(`${base}/${manifest.active.path}/${file.name}`).catch(() => null);
    if (!fileResponse || !fileResponse.ok) return { status: 'missing-snapshot', detail: `${manifest.active.snapshotId}/${file.name} is missing` };
    const text = await fileResponse.text();
    const digest = await sha256Hex(text);
    if (digest !== null && digest !== file.sha256) return { status: 'invalid-manifest', detail: `${file.name} does not match the manifest hash` };
    let json: unknown;
    try { json = JSON.parse(text); } catch { return { status: 'privacy-failure', detail: `${file.name} is not valid JSON` }; }
    if ((json as { snapshotVersion?: unknown } | null)?.snapshotVersion !== PUBLIC_SNAPSHOT_VERSION) return { status: 'unsupported-version', detail: `${file.name} has an unsupported snapshot version` };
    try { documents[file.kind] = validatePublicDocument(file.kind, json); } catch (error) { return { status: 'privacy-failure', detail: `${file.name}: ${describe(error)}` }; }
  }
  const d = documents as Partial<{ group: PublicGroupSnapshot; players: PublicPlayerSnapshot; analytics: PublicAnalysisSnapshot; profiles: PublicProfileSnapshot;
    'shared-match': PublicSharedMatchSnapshot; 'team-builder': PublicTeamBuilderSnapshot }>;
  if (!d.group || !d.players || !d.analytics || !d.profiles || !d['shared-match'] || !d['team-builder']) {
    return { status: 'missing-snapshot', detail: 'the snapshot does not contain every required document (group, players, analytics, profiles, shared-match, team-builder)' };
  }
  if (d.group.members.length === 0) return { status: 'empty', detail: 'This snapshot has no visible members.' };
  return { status: 'ready', manifest, group: d.group, players: d.players, analytics: d.analytics, profiles: d.profiles, sharedMatch: d['shared-match'], teamBuilder: d['team-builder'] };
}

/** Browser fetcher: the manifest is fetched fresh; snapshot files are immutable and may be cached. */
export const browserFetcher: Fetcher = async (path, init) => {
  const response = await fetch(path, init?.cache === 'no-store' ? { cache: 'no-store' } : {});
  return { ok: response.ok, status: response.status, text: () => response.text() };
};
