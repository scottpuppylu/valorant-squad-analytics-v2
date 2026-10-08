import { describe, expect, it } from 'vitest';
import { applyMigrations, createPostgresClient, createSqlClient } from '@vsa/canonical-data';
import { runDemoPipeline } from '@vsa/collector';
import { ACTIVATED_AT, OBSERVED_AT, withTempDir } from './helpers.ts';

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
      expect(pg).toMatchObject({ database: 'postgresql', matchesConsidered: 8, membersPublished: 5 });
    } finally {
      await sql.close();
    }
  }));
});
