import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { PUBLIC_FILE_NAMES, SnapshotId, type BuiltSnapshot, type PublicFileKind, type SnapshotManifest } from '@vsa/contracts/public';
import { MANIFEST_VERSION, PUBLIC_SNAPSHOT_VERSION } from '@vsa/contracts/versions';
import { deriveSnapshotId } from '@vsa/exporter';
import { findSecretPatterns, PrivacyViolation, validateManifest, validatePublicDocument } from '@vsa/privacy';
import { renameWithRetry } from './renameWithRetry.ts';

export interface PublishResult {
  snapshotId: string;
  reusedExistingSnapshot: boolean;
  /** True when the previous manifest was unreadable/invalid and has been repaired by this activation. */
  replacedInvalidManifest: boolean;
  manifest: SnapshotManifest;
}

/** Distribution abstraction: only LocalFilesystemPublisher is implemented in the bootstrap. */
export interface SnapshotPublisher {
  readonly publisherId: string;
  /** Write an immutable snapshot, validate it, then atomically make it the active one. */
  publish(snapshot: BuiltSnapshot, options?: { activatedAt?: string }): Promise<PublishResult>;
  /** Re-activate an already published immutable snapshot (after re-validating it). */
  rollback(snapshotId: string, options?: { activatedAt?: string }): Promise<PublishResult>;
  readActiveManifest(): Promise<SnapshotManifest | null>;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const KIND_BY_NAME = new Map((Object.entries(PUBLIC_FILE_NAMES) as [PublicFileKind, string][]).map(([kind, name]) => [name, kind]));

/** Validate one public file: hash, name ↔ kind, raw secret scan, then the full public-document validation. */
function validateFile(kind: PublicFileKind, name: string, content: string, expectedSha256?: string): void {
  if (PUBLIC_FILE_NAMES[kind] !== name) throw new PrivacyViolation([`${name}: name does not match kind ${kind}`]);
  if (expectedSha256 !== undefined && sha256(content) !== expectedSha256) throw new PrivacyViolation([`${name}: sha256 mismatch`]);
  const secrets = findSecretPatterns(content);
  if (secrets.length) throw new PrivacyViolation(secrets.map((s) => `${name}: secret pattern ${s}`));
  validatePublicDocument(kind, JSON.parse(content));
}

export interface LocalFilesystemPublisherOptions {
  /** Injected for tests (crash simulation); defaults to fs.rename with bounded Windows retry. */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Layout under `root`:
 *   manifest.json                  ← the ONLY mutable file, replaced atomically by rename
 *   snapshots/<snapshotId>/*.json  ← immutable; never modified or deleted by publish
 *   .staging/                      ← temporary build area (never referenced by a manifest)
 * A reader that sees a manifest always finds every file it references.
 */
export class LocalFilesystemPublisher implements SnapshotPublisher {
  readonly publisherId = 'local-filesystem';
  private readonly root: string;
  private readonly rename: (from: string, to: string) => Promise<void>;
  private sequence = 0;

  constructor(root: string, options: LocalFilesystemPublisherOptions = {}) {
    this.root = resolve(root);
    const injected = options.rename;
    this.rename = injected ? (from, to) => injected(from, to) : async (from, to) => { await renameWithRetry(from, to); };
  }

  /** Every path is derived from a validated snapshot id and stays strictly inside the root. */
  private inside(...parts: string[]): string {
    const target = resolve(this.root, ...parts);
    if (target !== this.root && !target.startsWith(this.root + sep)) throw new PrivacyViolation([`path escapes publication root: ${parts.join('/')}`]);
    return target;
  }

  private snapshotDir(snapshotId: string): string {
    SnapshotId.parse(snapshotId);
    return this.inside('snapshots', snapshotId);
  }

  async readActiveManifest(): Promise<SnapshotManifest | null> {
    try {
      return validateManifest(JSON.parse(await readFile(this.inside('manifest.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async publish(snapshot: BuiltSnapshot, options: { activatedAt?: string } = {}): Promise<PublishResult> {
    // 1–3: validate every public file and the content-derived identity BEFORE anything touches the root.
    SnapshotId.parse(snapshot.snapshotId);
    if (snapshot.snapshotVersion !== PUBLIC_SNAPSHOT_VERSION) throw new Error(`unsupported snapshot version ${snapshot.snapshotVersion}`);
    for (const f of snapshot.files) {
      validateFile(f.kind, f.name, f.content, f.sha256);
      if (Buffer.byteLength(f.content, 'utf8') !== f.bytes) throw new PrivacyViolation([`${f.name}: byte length mismatch`]);
    }
    if (deriveSnapshotId(snapshot.files) !== snapshot.snapshotId) throw new PrivacyViolation(['snapshot id is not derived from its content']);

    const finalDir = this.snapshotDir(snapshot.snapshotId);
    let reused = false;
    if (await exists(finalDir)) {
      await this.verifySnapshotDir(snapshot.snapshotId, snapshot.files.map((f) => ({ kind: f.kind, name: f.name, sha256: f.sha256 })));
      reused = true; // immutable + content-addressed: identical content already published
    } else {
      // 4: write into a private staging directory, then move it into place in one rename.
      const staging = this.inside('.staging', `${snapshot.snapshotId}.${process.pid}.${++this.sequence}`);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      for (const f of snapshot.files) await writeFile(join(staging, f.name), f.content, 'utf8');
      await mkdir(this.inside('snapshots'), { recursive: true });
      await this.rename(staging, finalDir);
    }
    const { manifest, replacedInvalidManifest } = await this.activate(snapshot.snapshotId, snapshot.files.map((f) => ({ kind: f.kind, name: f.name, sha256: f.sha256, bytes: f.bytes })), options.activatedAt);
    return { snapshotId: snapshot.snapshotId, reusedExistingSnapshot: reused, replacedInvalidManifest, manifest };
  }

  async rollback(snapshotId: string, options: { activatedAt?: string } = {}): Promise<PublishResult> {
    const dir = this.snapshotDir(snapshotId);
    if (!(await exists(dir))) throw new Error(`snapshot ${snapshotId} is not published`);
    const names = (await readdir(dir)).sort();
    const files = [];
    for (const name of names) {
      const kind = KIND_BY_NAME.get(name);
      if (!kind) throw new PrivacyViolation([`${snapshotId}/${name}: unexpected file`]);
      const content = await readFile(join(dir, name), 'utf8');
      validateFile(kind, name, content);
      files.push({ kind, name, sha256: sha256(content), bytes: Buffer.byteLength(content, 'utf8') });
    }
    if (files.length === 0 || deriveSnapshotId(files) !== snapshotId) throw new PrivacyViolation([`${snapshotId}: content does not match its id`]);
    const { manifest, replacedInvalidManifest } = await this.activate(snapshotId, files, options.activatedAt);
    return { snapshotId, reusedExistingSnapshot: true, replacedInvalidManifest, manifest };
  }

  private async verifySnapshotDir(snapshotId: string, expected: readonly { kind: PublicFileKind; name: string; sha256: string }[]): Promise<void> {
    const dir = this.snapshotDir(snapshotId);
    const names = (await readdir(dir)).sort();
    if (names.join('\n') !== expected.map((f) => f.name).sort().join('\n')) throw new PrivacyViolation([`${snapshotId}: existing snapshot has different files`]);
    for (const f of expected) validateFile(f.kind, f.name, await readFile(join(dir, f.name), 'utf8'), f.sha256);
  }

  /** 5–7: write a temporary manifest next to the active one and atomically replace it. */
  private async activate(snapshotId: string, files: SnapshotManifest['active']['files'], activatedAt = new Date().toISOString()): Promise<{ manifest: SnapshotManifest; replacedInvalidManifest: boolean }> {
    // A corrupt/invalid active manifest must never block recovery: a new valid publication repairs it (reported, not hidden).
    let previous: SnapshotManifest | null = null;
    let replacedInvalidManifest = false;
    try { previous = await this.readActiveManifest(); } catch { replacedInvalidManifest = true; }
    const history = previous ? [previous.active.snapshotId, ...previous.history].filter((id) => id !== snapshotId).slice(0, 50) : [];
    const manifest = validateManifest({
      manifestVersion: MANIFEST_VERSION,
      active: { snapshotId, snapshotVersion: PUBLIC_SNAPSHOT_VERSION, path: `snapshots/${snapshotId}`, files: [...files].sort((a, b) => a.name.localeCompare(b.name)), activatedAt },
      history: [...new Set(history)],
    });
    const temp = this.inside(`manifest.json.${process.pid}.${++this.sequence}.tmp`);
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    try {
      await this.rename(temp, this.inside('manifest.json'));
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return { manifest, replacedInvalidManifest };
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
