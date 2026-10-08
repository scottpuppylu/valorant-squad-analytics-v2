import { createHash } from 'node:crypto';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASIC_PLAYER_STATS_ALGORITHM, computeBasicPlayerStats, summarizeObservations } from '@vsa/analytics';
import { DEMO_CONSENTS, DEMO_GROUP, DEMO_MEMBERS } from '@vsa/collector';
import type { BuiltSnapshot, SnapshotManifest } from '@vsa/contracts/public';
import { LocalFilesystemPublisher } from '@vsa/distribution';
import { buildPublicSnapshot } from '@vsa/exporter';
import { PrivacyViolation, validateManifest } from '@vsa/privacy';
import { FAKE_MATCHES, normalizeFakeMatch } from '@vsa/source-adapters/fake';
import { ACTIVATED_AT, demoProduct, demoResolver, OBSERVED_AT, withTempDir } from './helpers.ts';

function snapshot(summary = 'A'): BuiltSnapshot {
  const matches = FAKE_MATCHES.map((p) => normalizeFakeMatch(p, demoResolver, OBSERVED_AT));
  const ids = DEMO_MEMBERS.map((m) => m.memberId);
  return buildPublicSnapshot({ group: DEMO_GROUP, members: DEMO_MEMBERS, consents: DEMO_CONSENTS, analysis: computeBasicPlayerStats(matches, ids),
    algorithms: [{ algorithmId: BASIC_PLAYER_STATS_ALGORITHM, description: 'basic' }], observations: summarizeObservations(matches, ids), provenanceSummary: summary, product: demoProduct() });
}

/** The reader invariant: an observed manifest always references existing files with matching hashes. */
async function assertReadable(root: string): Promise<SnapshotManifest> {
  const manifest = validateManifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
  for (const f of manifest.active.files) {
    const text = await readFile(join(root, manifest.active.path, f.name), 'utf8');
    expect(createHash('sha256').update(text, 'utf8').digest('hex')).toBe(f.sha256);
  }
  return manifest;
}

describe('LocalFilesystemPublisher', () => {
  it('publishes an immutable snapshot and activates it via the manifest', () => withTempDir(async (root) => {
    const s = snapshot();
    const result = await new LocalFilesystemPublisher(root).publish(s, { activatedAt: ACTIVATED_AT });
    expect(result).toMatchObject({ snapshotId: s.snapshotId, reusedExistingSnapshot: false });
    const manifest = await assertReadable(root);
    expect(manifest).toMatchObject({ active: { snapshotId: s.snapshotId, path: `snapshots/${s.snapshotId}`, activatedAt: ACTIVATED_AT }, history: [] });
    expect((await readdir(join(root, 'snapshots', s.snapshotId))).sort()).toEqual(['analytics.json', 'group.json', 'players.json', 'profiles.json', 'shared-match.json', 'team-builder.json']);
  }));

  it('re-publishing identical content reuses the immutable snapshot', () => withTempDir(async (root) => {
    const publisher = new LocalFilesystemPublisher(root);
    await publisher.publish(snapshot());
    expect((await publisher.publish(snapshot())).reusedExistingSnapshot).toBe(true);
    expect(await readdir(join(root, 'snapshots'))).toHaveLength(1);
  }));

  it('keeps history and rolls back to a prior snapshot after re-validating it', () => withTempDir(async (root) => {
    const publisher = new LocalFilesystemPublisher(root);
    const a = snapshot('A'); const b = snapshot('B');
    await publisher.publish(a); await publisher.publish(b);
    expect((await assertReadable(root))).toMatchObject({ active: { snapshotId: b.snapshotId }, history: [a.snapshotId] });
    await publisher.rollback(a.snapshotId);
    expect((await assertReadable(root))).toMatchObject({ active: { snapshotId: a.snapshotId }, history: [b.snapshotId] });
    await expect(publisher.rollback('ps1-ffffffffffffffff')).rejects.toThrow(/not published/u);
  }));

  it('a corrupt active manifest never blocks recovery: the next valid publication repairs it and reports it', () => withTempDir(async (root) => {
    const publisher = new LocalFilesystemPublisher(root);
    await writeFile(join(root, 'manifest.json'), '{corrupt', 'utf8');
    await expect(publisher.readActiveManifest()).rejects.toThrow();
    const result = await publisher.publish(snapshot());
    expect(result.replacedInvalidManifest).toBe(true);
    expect((await assertReadable(root)).history).toEqual([]);
    expect((await publisher.publish(snapshot('B'))).replacedInvalidManifest).toBe(false);
  }));

  it('a crash during manifest activation leaves the previous manifest fully readable', () => withTempDir(async (root) => {
    const a = snapshot('A');
    await new LocalFilesystemPublisher(root).publish(a);
    const before = await readFile(join(root, 'manifest.json'), 'utf8');
    const crashing = new LocalFilesystemPublisher(root, {
      rename: async (from, to) => { if (to.endsWith('manifest.json')) throw Object.assign(new Error('simulated crash'), { code: 'EIO' }); await rename(from, to); },
    });
    await expect(crashing.publish(snapshot('B'))).rejects.toThrow('simulated crash');
    expect(await readFile(join(root, 'manifest.json'), 'utf8')).toBe(before);
    expect((await assertReadable(root)).active.snapshotId).toBe(a.snapshotId);
    expect((await readdir(root)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  }));

  it('a crash while moving the snapshot into place never changes the manifest', () => withTempDir(async (root) => {
    const a = snapshot('A');
    await new LocalFilesystemPublisher(root).publish(a);
    const crashing = new LocalFilesystemPublisher(root, { rename: async () => { throw Object.assign(new Error('move failed'), { code: 'EIO' }); } });
    await expect(crashing.publish(snapshot('B'))).rejects.toThrow('move failed');
    expect((await assertReadable(root)).active.snapshotId).toBe(a.snapshotId);
  }));

  it('refuses tampered, mislabelled or non-content-derived snapshots before writing anything', () => withTempDir(async (root) => {
    const publisher = new LocalFilesystemPublisher(root);
    const s = snapshot();
    const tampered = { ...s, files: s.files.map((f) => (f.kind === 'group' ? { ...f, content: f.content.replace(DEMO_GROUP.name, 'Evil Squad') } : f)) };
    await expect(publisher.publish(tampered)).rejects.toThrow(PrivacyViolation);
    await expect(publisher.publish({ ...s, snapshotId: 'ps1-ffffffffffffffff' })).rejects.toThrow(PrivacyViolation);
    await expect(publisher.publish({ ...s, snapshotId: '../../escape' })).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  }));

  it('rollback rejects path traversal and a tampered immutable snapshot', () => withTempDir(async (root) => {
    const publisher = new LocalFilesystemPublisher(root);
    const a = snapshot('A'); const b = snapshot('B');
    await publisher.publish(a); await publisher.publish(b);
    await expect(publisher.rollback('../../etc')).rejects.toThrow();
    const file = join(root, 'snapshots', a.snapshotId, 'group.json');
    await writeFile(file, (await readFile(file, 'utf8')).replace(JSON.stringify(DEMO_GROUP.name), `${JSON.stringify(DEMO_GROUP.name)}, "puuid": "fake-puuid-x"`), 'utf8');
    await expect(publisher.rollback(a.snapshotId)).rejects.toThrow(PrivacyViolation);
    expect((await assertReadable(root)).active.snapshotId).toBe(b.snapshotId);
  }));
});
