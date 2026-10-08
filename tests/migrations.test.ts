import { describe, expect, it } from 'vitest';
import { applyMigrations, createEmbeddedClient, loadMigrations } from '@vsa/canonical-data';

const REQUIRED_TABLES = ['groups', 'group_members', 'source_accounts', 'consent_state', 'matches', 'match_teams', 'match_participants', 'rounds', 'events',
  'rank_context', 'analysis_artifacts', 'publication_state', 'provider_ingest_state', 'round_participants', 'event_player_snapshots', 'import_state'];

describe('canonical migrations', () => {
  it('start at a fresh 0001 (no legacy numbering)', async () => {
    expect((await loadMigrations()).map((m) => m.version)).toEqual(['0001', '0002']);
  });

  it('apply once, then are a no-op; every required domain table exists', async () => {
    const sql = createEmbeddedClient();
    try {
      expect(await applyMigrations(sql)).toEqual(['0001', '0002']);
      expect(await applyMigrations(sql)).toEqual([]);
      const tables = (await sql.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map((r) => r.table_name);
      for (const t of REQUIRED_TABLES) expect(tables).toContain(t);
      expect((await sql.query('SELECT version FROM schema_migrations')).rows).toHaveLength(2);
    } finally { await sql.close(); }
  });

  it('enforces canonical invariants in the schema itself', async () => {
    const sql = createEmbeddedClient();
    try {
      await applyMigrations(sql);
      const base = `INSERT INTO matches (match_key, schema_version, provider_id, provider_version, normalizer_version, provider_record_ref, observed_at,
        history_completeness, evidence_quality, has_damage, map_id, map_name, mode, started_at) VALUES
        ($1,'canonical-schema-v2','fake','v','n','r',now(),$2,'basic',false,'m','M',$3,now())`;
      await expect(sql.query(base, ['bad-key', 'unknown', 'competitive'])).rejects.toThrow();
      await expect(sql.query(base, [`cm_${'a'.repeat(24)}`, 'lifetime', 'competitive'])).rejects.toThrow(); // no "lifetime" completeness
      await expect(sql.query(base, [`cm_${'a'.repeat(24)}`, 'unknown', 'ranked-elo'])).rejects.toThrow();
      await sql.query(base, [`cm_${'a'.repeat(24)}`, 'unknown', 'competitive']);
    } finally { await sql.close(); }
  });
});
