import { describe, expect, it } from 'vitest';
import { applyMigrations, createPostgresClient, createSqlClient, PostgresCanonicalRepository } from '@vsa/canonical-data';
import { runDemoPipeline } from '@vsa/collector';
import { canonicalDatasetFingerprint, IMPORT_GROUP, LegacyEvidenceImportAdapter, RebuildStagingSource } from '@vsa/legacy-importer';
import { ACTIVATED_AT, freshDatabase, OBSERVED_AT, withTempDir } from './helpers.ts';
import { createLegacyStaging } from './legacyFixture.ts';

/**
 * Optional real PostgreSQL 18 smoke test. Runs only when VSA_PG18_URL points at a DISPOSABLE, EMPTY local database
 * (e.g. a throwaway postgres:18 container on 127.0.0.1). Never point it at a database you care about.
 */
const url = process.env.VSA_PG18_URL;

describe.skipIf(!url)('PostgreSQL 18 integration (opt-in)', () => {
  it('runs on PostgreSQL 18, migrates idempotently, and produces the same snapshot as embedded PGlite', () => withTempDir(async (root) => {
    const sql = createPostgresClient(url!);
    try {
      const version = (await sql.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]!.server_version_num;
      expect(Number(version)).toBeGreaterThanOrEqual(180000);
      const pg = await runDemoPipeline({ outDir: `${root}/pg`, sql, now: () => OBSERVED_AT, activatedAt: ACTIVATED_AT });
      expect(await applyMigrations(sql)).toEqual([]);
      const embedded = await runDemoPipeline({ outDir: `${root}/pglite`, sql: createSqlClient(), now: () => OBSERVED_AT, activatedAt: ACTIVATED_AT });
      expect(pg.snapshotId).toBe(embedded.snapshotId);
      expect(pg).toMatchObject({ database: 'postgresql', matchesConsidered: 62, membersPublished: 6 });
    } finally {
      await sql.close();
    }
  }));

  it('imports synthetic legacy evidence into PostgreSQL 18 atomically and idempotently, with the PGlite fingerprint and member erasure', async () => {
    const sql = createPostgresClient(url!);
    const run = async (repository: PostgresCanonicalRepository) => {
      const staging = await createLegacyStaging();
      try {
        return await new LegacyEvidenceImportAdapter(new RebuildStagingSource(staging.sql), repository).run({ log: () => {}, now: () => '2026-10-08T01:00:00.000Z' });
      } finally { await staging.sql.close(); }
    };
    try {
      await applyMigrations(sql);
      const repository = new PostgresCanonicalRepository(sql);
      const first = await run(repository);
      const second = await run(repository);
      expect(second.matches.inserted).toBe(0);
      expect(second.matches.conflicts).toBe(0);
      const pgPrint = await canonicalDatasetFingerprint(repository, IMPORT_GROUP.groupId);
      const embedded = await freshDatabase();
      await run(embedded.repository);
      expect(pgPrint).toEqual(await canonicalDatasetFingerprint(embedded.repository, IMPORT_GROUP.groupId));
      await embedded.sql.close();
      expect(first.matches.inserted).toBe(pgPrint.matches);
      const alpha = (await repository.listMembers(IMPORT_GROUP.groupId)).find((m) => m.displayName === 'Alpha')!;
      expect((await repository.erasePositionTelemetryForMember(alpha.memberId)).snapshotsDeleted).toBeGreaterThan(0);
      expect((await repository.erasePositionTelemetryForMember(alpha.memberId)).snapshotsDeleted).toBe(0); // idempotent
      expect((await canonicalDatasetFingerprint(repository, IMPORT_GROUP.groupId)).matches).toBe(pgPrint.matches); // evidence kept
    } finally {
      await sql.close();
    }
  });
});
