import { describe, expect, it } from 'vitest';
import { runDemoPipeline } from '@vsa/collector';
import { scanPublicData } from '../scripts/privacyScan.ts';
import { ACTIVATED_AT, OBSERVED_AT, withTempDir } from './helpers.ts';

describe('end-to-end vertical slice (no cloud, no provider network, embedded PostgreSQL)', () => {
  it('fake provider → canonical store → analytics → exporter → local publisher → manifest', () => withTempDir(async (root) => {
    const first = await runDemoPipeline({ outDir: root, now: () => OBSERVED_AT, activatedAt: ACTIVATED_AT });
    expect(first).toMatchObject({ database: 'embedded-pglite', migrationsApplied: ['0001'], matchesStored: 10, matchesConsidered: 8, membersTotal: 6, membersPublished: 5, reusedExistingSnapshot: false });
    const scan = await scanPublicData(root);
    expect(scan.files).toBe(4);
    expect(scan.findings).toEqual([]);
  }));

  it('is deterministic: a rebuild from scratch yields the same content-derived snapshot', () => withTempDir(async (root) => {
    const a = await runDemoPipeline({ outDir: root, now: () => OBSERVED_AT });
    const b = await runDemoPipeline({ outDir: root, now: () => '2027-01-01T00:00:00.000Z' }); // private observedAt differs; public content must not
    expect(b.snapshotId).toBe(a.snapshotId);
    expect(b.reusedExistingSnapshot).toBe(true);
  }));
});
