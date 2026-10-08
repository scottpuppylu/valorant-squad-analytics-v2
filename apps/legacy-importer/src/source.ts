import type { SqlClient } from '@vsa/canonical-data';
import { EXPECTED_SOURCE_VERSIONS, LegacyAccountRow, LegacyMatchRow, LegacyRankRow } from './legacySchema.ts';

/** What the importer needs from a legacy source. Implementations are READ ONLY. */
export interface LegacyEvidenceSource {
  verifyReadOnly(): Promise<void>;
  versions(): Promise<Record<string, string>>;
  accounts(): Promise<LegacyAccountRow[]>;
  matchCount(): Promise<number>;
  /** Keyset pages ordered by provider match id (deterministic, bounded memory). */
  matchPage(afterProviderMatchId: string | null, limit: number): Promise<LegacyMatchRow[]>;
  /** Private staging-internal match reference → provider match id (rank evidence joins on it). */
  matchRefIndex(): Promise<Map<string, string>>;
  rankRows(): Promise<LegacyRankRow[]>;
}

/**
 * The private rebuild staging database (PostgreSQL 18). The session must be read-only (`default_transaction_read_only`);
 * this is verified before ANY read and enforced by PostgreSQL itself, so a write is impossible even by mistake.
 */
export class RebuildStagingSource implements LegacyEvidenceSource {
  private readonly db: SqlClient;
  constructor(db: SqlClient) {
    this.db = db;
  }

  async verifyReadOnly(): Promise<void> {
    const row = (await this.db.query<{ ro: string }>(`SELECT current_setting('default_transaction_read_only') AS ro`)).rows[0];
    if (row?.ro !== 'on') throw new Error('legacy source session is not read-only; refusing to read');
  }

  async versions(): Promise<Record<string, string>> {
    const rows = (await this.db.query<{ schema: string; value: string }>(
      `SELECT 'rebuild_staging' AS schema, value FROM rebuild_staging.meta WHERE key='schema_version'
       UNION ALL SELECT 'rank_staging', value FROM rank_staging.meta WHERE key='schema_version'`)).rows;
    const versions = Object.fromEntries(rows.map((r) => [r.schema, r.value]));
    for (const [schema, expected] of Object.entries(EXPECTED_SOURCE_VERSIONS)) {
      if (versions[schema] !== expected) throw new Error(`unexpected legacy source version for ${schema}`);
    }
    return versions;
  }

  async accounts(): Promise<LegacyAccountRow[]> {
    const { rows } = await this.db.query(`SELECT account_public_id::text, member_public_id::text, community_name, is_primary, provider_puuid
      FROM rebuild_staging.accounts ORDER BY account_public_id`);
    return rows.map((r) => LegacyAccountRow.parse(r));
  }

  async matchCount(): Promise<number> {
    return Number((await this.db.query<{ n: string }>('SELECT count(*)::text AS n FROM rebuild_staging.match_payloads')).rows[0]!.n);
  }

  async matchPage(after: string | null, limit: number): Promise<LegacyMatchRow[]> {
    const { rows } = await this.db.query(`SELECT provider_match_id, payload_sha256, fetched_at, payload FROM rebuild_staging.match_payloads
      WHERE ($1::text IS NULL OR provider_match_id > $1) ORDER BY provider_match_id LIMIT $2`, [after, limit]);
    return rows.map((r) => LegacyMatchRow.parse(r));
  }

  async matchRefIndex(): Promise<Map<string, string>> {
    const { rows } = await this.db.query<{ match_ref: string; provider_match_id: string }>('SELECT match_ref, provider_match_id FROM rebuild_staging.matches');
    return new Map(rows.map((r) => [String(r.match_ref), String(r.provider_match_id)]));
  }

  async rankRows(): Promise<LegacyRankRow[]> {
    const { rows } = await this.db.query(`SELECT evidence_key, account_public_id::text, kind, source, effective_at, season_short, provider_tier_id, provider_tier_name, rr,
      provider_elo, rr_change, match_ref, queue, normalized_tier_key, tier_ordinal, tier_model_version FROM rank_staging.rank_evidence ORDER BY evidence_key`);
    return rows.map((r) => LegacyRankRow.parse(r));
  }
}
