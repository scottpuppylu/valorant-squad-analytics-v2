import { describe, expect, it } from 'vitest';
import { PrivacyViolation, validateManifest } from '@vsa/privacy';

const ID = 'ps1-0123456789abcdef';
const manifest = (active: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  manifestVersion: 'manifest-v1',
  active: {
    snapshotId: ID, snapshotVersion: 'public-snapshot-v2', path: `snapshots/${ID}`,
    files: [{ kind: 'group', name: 'group.json', sha256: 'a'.repeat(64), bytes: 10 }],
    activatedAt: '2026-10-01T00:00:00.000Z', ...active,
  },
  history: [], ...extra,
});

describe('manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifest(manifest()).active.snapshotId).toBe(ID);
  });

  it.each([
    ['snapshots/../../etc'], ['../snapshots/ps1-0123456789abcdef'], ['/abs/path'], ['snapshots/ps1-0123456789abcdef/..'], ['snapshots\\ps1-0123456789abcdef'],
  ])('rejects path traversal / non-canonical paths: %s', (path) => {
    expect(() => validateManifest(manifest({ path }))).toThrow(PrivacyViolation);
  });

  it('rejects file names outside the snapshot root or not matching their kind', () => {
    for (const name of ['../group.json', 'sub/group.json', 'GROUP.json', 'players.json']) {
      expect(() => validateManifest(manifest({ files: [{ kind: 'group', name, sha256: 'a'.repeat(64), bytes: 1 }] }))).toThrow(PrivacyViolation);
    }
  });

  it('rejects ids that are not content-derived ids, a path that disagrees with the id, duplicates and unknown fields', () => {
    expect(() => validateManifest(manifest({ snapshotId: '2026-10-01', path: 'snapshots/2026-10-01' }))).toThrow(PrivacyViolation);
    expect(() => validateManifest(manifest({ path: 'snapshots/ps1-ffffffffffffffff' }))).toThrow(PrivacyViolation);
    const dup = { kind: 'group', name: 'group.json', sha256: 'a'.repeat(64), bytes: 1 };
    expect(() => validateManifest(manifest({ files: [dup, dup] }))).toThrow(PrivacyViolation);
    expect(() => validateManifest(manifest({}, { databaseUrl: 'x' }))).toThrow(PrivacyViolation);
    expect(() => validateManifest(manifest({ note: 'hello' }))).toThrow(PrivacyViolation);
    expect(() => validateManifest(manifest({}, { history: ['../x'] }))).toThrow(PrivacyViolation);
  });

  it('rejects unsupported versions', () => {
    expect(() => validateManifest({ ...manifest(), manifestVersion: 'manifest-v0' })).toThrow(PrivacyViolation);
    expect(() => validateManifest(manifest({ snapshotVersion: 'public-snapshot-v1' }))).toThrow(PrivacyViolation);
  });
});
