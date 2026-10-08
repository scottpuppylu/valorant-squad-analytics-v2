import { CanonicalMatch, RankContext, type CanonicalEvent } from '@vsa/contracts/canonical';
import { ConsentState, Group, GroupMember, SourceAccount } from '@vsa/contracts/control';
import type { SqlClient, SqlExecutor } from './sql.ts';

/** Import checkpoint for one source record (written in the SAME transaction as its canonical match). */
export interface ImportRecord { sourceSystem: string; sourceRefHash: string; sourcePayloadSha256: string; normalizerVersion: string; importedAt: string }

/** Write side: collector ingest and the legacy importer. */
export interface CanonicalWriteRepository {
  upsertGroup(group: Group): Promise<void>;
  upsertMember(member: GroupMember): Promise<void>;
  upsertSourceAccount(account: SourceAccount): Promise<void>;
  upsertConsent(consent: ConsentState): Promise<void>;
  /** Atomic and idempotent: re-saving the same canonical match replaces it exactly (optionally with its import checkpoint). */
  saveMatch(match: CanonicalMatch, importRecord?: ImportRecord): Promise<void>;
  saveRankContext(contexts: readonly RankContext[]): Promise<void>;
  recordIngestState(state: { providerId: string; accountId: string; nextCursor: string | null; matchesSeen: number; at: string; error: string | null }): Promise<void>;
  recordPublication(state: { snapshotId: string; snapshotVersion: string; manifestVersion: string; publisher: string; publishedAt: string }): Promise<void>;
  /** Erase every precise position attributable to the member (snapshots, their kill locations, their plant / defuse locations). */
  erasePositionTelemetryForMember(memberId: string): Promise<PositionErasureSummary>;
}

export interface PositionErasureSummary { participants: number; snapshotsDeleted: number; eventLocationsCleared: number; plantLocationsCleared: number; defuseLocationsCleared: number }

/** Read side. Analytics itself never sees SQL. */
export interface CanonicalReadRepository {
  getGroup(groupId: string): Promise<Group | null>;
  listMembers(groupId: string): Promise<GroupMember[]>;
  listSourceAccounts(groupId: string): Promise<SourceAccount[]>;
  listConsents(groupId: string): Promise<ConsentState[]>;
  hasMatch(providerId: string, providerRecordRef: string): Promise<boolean>;
  getImportRecord(sourceSystem: string, sourceRefHash: string): Promise<{ matchKey: string; sourcePayloadSha256: string; normalizerVersion: string } | null>;
  listMatchKeys(): Promise<string[]>;
  /** Keys of every stored match with at least one of the members; deterministic order (start time, key). */
  listMatchKeysForMembers(memberIds: readonly string[]): Promise<string[]>;
  getMatches(matchKeys: readonly string[]): Promise<CanonicalMatch[]>;
  listMatchesForMembers(memberIds: readonly string[]): Promise<CanonicalMatch[]>;
  listRankContext(memberIds: readonly string[]): Promise<RankContext[]>;
  /** Rank context valid AT a match: its own match-time snapshot, else the latest strictly-earlier history row. Never current / peak / seasonal. */
  rankContextForMatch(memberId: string, matchKey: string, startedAt: string): Promise<RankContext | null>;
}

export type CanonicalRepository = CanonicalWriteRepository & CanonicalReadRepository;

const iso = (value: unknown): string => (value instanceof Date ? value : new Date(String(value))).toISOString();
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value));
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : num(value));
const strOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const jsonArray = (value: unknown): string[] => (Array.isArray(value) ? value : JSON.parse(String(value))) as string[];
const pointOf = (x: unknown, y: unknown) => (x === null || x === undefined ? null : { x: num(x), y: num(y) });
const assetOf = (id: unknown, name: unknown) => (id === null && name === null ? null : { id: strOrNull(id), name: strOrNull(name) });

/** Multi-row insert via unnest (one statement per chunk; avoids per-row round trips). */
async function insertRows(tx: SqlExecutor, table: string, columns: readonly (readonly [string, string])[], rows: readonly unknown[][], chunkSize = 2000): Promise<void> {
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const arrays = columns.map((_, c) => chunk.map((row) => row[c] ?? null));
    const select = columns.map(([, type], i) => `$${i + 1}::${type}[]`).join(', ');
    await tx.query(`INSERT INTO ${table} (${columns.map(([name]) => name).join(', ')}) SELECT * FROM unnest(${select})`, arrays);
  }
}

const RANK_COLUMNS = [['rank_context_id', 'text'], ['member_id', 'text'], ['account_id', 'text'], ['kind', 'text'], ['effective_at', 'timestamptz'], ['match_key', 'text'],
  ['provider_id', 'text'], ['source_endpoint', 'text'], ['provider_tier_id', 'int'], ['provider_tier_name', 'text'], ['rr', 'int'], ['rr_change', 'int'], ['provider_elo', 'int'],
  ['season_key', 'text'], ['queue', 'text'], ['normalized_tier_key', 'text'], ['tier_ordinal', 'int'], ['tier_model_version', 'text']] as const;

export class PostgresCanonicalRepository implements CanonicalRepository {
  private readonly db: SqlClient;
  constructor(db: SqlClient) {
    this.db = db;
  }

  async upsertGroup(input: Group): Promise<void> {
    const g = Group.parse(input);
    await this.db.query(`INSERT INTO groups (group_id, slug, name, visibility, created_at) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (group_id) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name, visibility=EXCLUDED.visibility`,
    [g.groupId, g.slug, g.name, g.visibility, g.createdAt]);
  }

  async upsertMember(input: GroupMember): Promise<void> {
    const m = GroupMember.parse(input);
    await this.db.query(`INSERT INTO group_members (member_id, group_id, display_name, status, joined_at) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (member_id) DO UPDATE SET display_name=EXCLUDED.display_name, status=EXCLUDED.status`,
    [m.memberId, m.groupId, m.displayName, m.status, m.joinedAt]);
  }

  async upsertSourceAccount(input: SourceAccount): Promise<void> {
    const a = SourceAccount.parse(input);
    await this.db.query(`INSERT INTO source_accounts (account_id, member_id, provider_id, provider_account_ref, is_primary, linked_at) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (account_id) DO UPDATE SET member_id=EXCLUDED.member_id, is_primary=EXCLUDED.is_primary`,
    [a.accountId, a.memberId, a.providerId, a.providerAccountRef, a.isPrimary, a.linkedAt]);
  }

  async upsertConsent(input: ConsentState): Promise<void> {
    const c = ConsentState.parse(input);
    await this.db.query(`INSERT INTO consent_state (member_id, consent_status, consent_source, identity_connected, data_collection_allowed, group_visibility_allowed,
      public_derived_analytics_allowed, policy_version, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (member_id) DO UPDATE SET consent_status=EXCLUDED.consent_status, consent_source=EXCLUDED.consent_source,
      identity_connected=EXCLUDED.identity_connected, data_collection_allowed=EXCLUDED.data_collection_allowed,
      group_visibility_allowed=EXCLUDED.group_visibility_allowed, public_derived_analytics_allowed=EXCLUDED.public_derived_analytics_allowed,
      policy_version=EXCLUDED.policy_version, updated_at=EXCLUDED.updated_at`,
    [c.memberId, c.status, c.source, c.identityConnected, c.dataCollectionAllowed, c.groupVisibilityAllowed, c.publicDerivedAnalyticsAllowed, c.policyVersion, c.updatedAt]);
  }

  async saveMatch(input: CanonicalMatch, importRecord?: ImportRecord): Promise<void> {
    const m = CanonicalMatch.parse(input);
    await this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO matches (match_key, schema_version, provider_id, provider_version, normalizer_version, provider_record_ref, observed_at,
        acquisition, acquisition_source, history_completeness, evidence_quality, rounds_status, kills_status, has_damage, has_positions,
        map_id, map_name, mode, queue_id, queue_name, season_key, season_ref, started_at, duration_ms)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        ON CONFLICT (match_key) DO UPDATE SET schema_version=EXCLUDED.schema_version, provider_version=EXCLUDED.provider_version,
        normalizer_version=EXCLUDED.normalizer_version, observed_at=EXCLUDED.observed_at, acquisition=EXCLUDED.acquisition, acquisition_source=EXCLUDED.acquisition_source,
        history_completeness=EXCLUDED.history_completeness, evidence_quality=EXCLUDED.evidence_quality, rounds_status=EXCLUDED.rounds_status,
        kills_status=EXCLUDED.kills_status, has_damage=EXCLUDED.has_damage, has_positions=EXCLUDED.has_positions, map_id=EXCLUDED.map_id, map_name=EXCLUDED.map_name,
        mode=EXCLUDED.mode, queue_id=EXCLUDED.queue_id, queue_name=EXCLUDED.queue_name, season_key=EXCLUDED.season_key, season_ref=EXCLUDED.season_ref,
        started_at=EXCLUDED.started_at, duration_ms=EXCLUDED.duration_ms`,
      [m.matchKey, m.schemaVersion, m.source.providerId, m.source.providerVersion, m.source.normalizerVersion, m.source.providerRecordRef, m.source.observedAt,
        m.source.acquisition, m.source.acquisitionSource, m.evidence.historyCompleteness, m.evidence.evidenceQuality, m.evidence.rounds, m.evidence.kills,
        m.evidence.hasDamage, m.evidence.hasPositions, m.mapId, m.mapName, m.mode, m.queue.id, m.queue.name, m.season.key, m.season.ref, m.startedAt, m.durationMs]);
      // Children are replaced wholesale (cascades remove round participants and player snapshots).
      for (const table of ['match_teams', 'match_participants', 'rounds', 'events']) await tx.query(`DELETE FROM ${table} WHERE match_key=$1`, [m.matchKey]);
      const k = m.matchKey;
      await insertRows(tx, 'match_teams', [['match_key', 'text'], ['team_key', 'text'], ['rounds_won', 'int'], ['rounds_lost', 'int'], ['won', 'boolean']],
        m.teams.map((t) => [k, t.teamKey, t.roundsWon, t.roundsLost, t.won]));
      await insertRows(tx, 'match_participants', [['match_key', 'text'], ['participant_key', 'text'], ['team_key', 'text'], ['member_id', 'text'], ['account_id', 'text'],
        ['agent_id', 'text'], ['agent_name', 'text'], ['stats_status', 'text'], ['kills', 'int'], ['deaths', 'int'], ['assists', 'int'], ['score', 'int'], ['damage_dealt', 'int'],
        ['damage_received', 'int'], ['headshots', 'int'], ['bodyshots', 'int'], ['legshots', 'int'], ['ability_status', 'text'], ['ability1_casts', 'int'], ['ability2_casts', 'int'],
        ['grenade_casts', 'int'], ['ultimate_casts', 'int'], ['economy_status', 'text'], ['loadout_value_total', 'int'], ['loadout_value_average', 'float8'], ['spent_total', 'int'],
        ['spent_average', 'float8']],
      m.participants.map((p) => [k, p.participantKey, p.teamKey, p.memberId, p.accountId, p.agentId, p.agentName, p.stats.status, p.stats.kills, p.stats.deaths, p.stats.assists,
        p.stats.score, p.stats.damageDealt, p.stats.damageReceived, p.stats.headshots, p.stats.bodyshots, p.stats.legshots, p.abilityCasts.status, p.abilityCasts.ability1,
        p.abilityCasts.ability2, p.abilityCasts.grenade, p.abilityCasts.ultimate, p.economy.status, p.economy.loadoutValueTotal, p.economy.loadoutValueAverage,
        p.economy.spentTotal, p.economy.spentAverage]));
      await insertRows(tx, 'rounds', [['match_key', 'text'], ['round_number', 'int'], ['winning_team_key', 'text'], ['attacking_team_key', 'text'], ['result', 'text'],
        ['winning_team_role', 'text'], ['side_source', 'text'], ['plant_status', 'text'], ['plant_participant_key', 'text'], ['plant_time_ms', 'int'], ['plant_site', 'text'],
        ['plant_location_x', 'float8'], ['plant_location_y', 'float8'], ['defuse_status', 'text'], ['defuse_participant_key', 'text'], ['defuse_time_ms', 'int'],
        ['defuse_location_x', 'float8'], ['defuse_location_y', 'float8'], ['participants_status', 'text']],
      m.rounds.map((r) => [k, r.roundNumber, r.winningTeamKey, r.attackingTeamKey, r.result, r.winningTeamRole, r.sideSource, r.plant.status, r.plant.participantKey,
        r.plant.timeInRoundMs, r.plant.site, r.plant.location?.x, r.plant.location?.y, r.defuse.status, r.defuse.participantKey, r.defuse.timeInRoundMs,
        r.defuse.location?.x, r.defuse.location?.y, r.participantsStatus]));
      await insertRows(tx, 'round_participants', [['match_key', 'text'], ['round_number', 'int'], ['participant_key', 'text'], ['stats_status', 'text'], ['kills', 'int'],
        ['score', 'int'], ['economy_status', 'text'], ['loadout_value', 'int'], ['remaining_credits', 'int'], ['weapon_status', 'text'], ['weapon_id', 'text'], ['weapon_name', 'text'],
        ['armor_status', 'text'], ['armor_id', 'text'], ['armor_name', 'text']],
      m.rounds.flatMap((r) => r.participants.map((p) => [k, r.roundNumber, p.participantKey, p.stats.status, p.stats.kills, p.stats.score, p.economy.status, p.economy.loadoutValue,
        p.economy.remainingCredits, p.weapon.status, p.weapon.id, p.weapon.name, p.armor.status, p.armor.id, p.armor.name])));
      await insertRows(tx, 'events', [['match_key', 'text'], ['event_key', 'text'], ['round_number', 'int'], ['sequence', 'int'], ['time_in_round_ms', 'int'], ['time_in_match_ms', 'int8'],
        ['event_type', 'text'], ['actor_participant_key', 'text'], ['target_participant_key', 'text'], ['assistant_participant_keys', 'jsonb'], ['weapon_id', 'text'],
        ['weapon_name', 'text'], ['location_x', 'float8'], ['location_y', 'float8']],
      m.events.map((e: CanonicalEvent) => [k, e.eventKey, e.roundNumber, e.sequence, e.timeInRoundMs, e.timeInMatchMs, e.type, e.actorParticipantKey, e.targetParticipantKey,
        JSON.stringify(e.assistantParticipantKeys), e.weapon?.id, e.weapon?.name, e.location?.x, e.location?.y]));
      await insertRows(tx, 'event_player_snapshots', [['match_key', 'text'], ['event_key', 'text'], ['participant_key', 'text'], ['location_x', 'float8'], ['location_y', 'float8'],
        ['view_radians', 'float8']],
      m.events.flatMap((e) => e.playerSnapshots.map((s) => [k, e.eventKey, s.participantKey, s.location.x, s.location.y, s.viewRadians])));
      if (importRecord) {
        await tx.query(`INSERT INTO import_state (source_system, source_ref_hash, match_key, source_payload_sha256, normalizer_version, imported_at) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (source_system, source_ref_hash) DO UPDATE SET match_key=EXCLUDED.match_key, source_payload_sha256=EXCLUDED.source_payload_sha256,
          normalizer_version=EXCLUDED.normalizer_version, imported_at=EXCLUDED.imported_at`,
        [importRecord.sourceSystem, importRecord.sourceRefHash, k, importRecord.sourcePayloadSha256, importRecord.normalizerVersion, importRecord.importedAt]);
      }
    });
  }

  async saveRankContext(contexts: readonly RankContext[]): Promise<void> {
    const rows = contexts.map((input) => {
      const r = RankContext.parse(input);
      return [r.rankContextId, r.memberId, r.accountId, r.kind, r.effectiveAt, r.matchKey, r.providerId, r.sourceEndpoint, r.providerTierId, r.providerTierName, r.rr, r.rrChange,
        r.providerElo, r.seasonKey, r.queue, r.normalizedTierKey, r.tierOrdinal, r.tierModelVersion];
    });
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += 2000) {
        const chunk = rows.slice(i, i + 2000);
        await tx.query(`DELETE FROM rank_context WHERE rank_context_id = ANY($1::text[])`, [chunk.map((r) => r[0])]);
        await insertRows(tx, 'rank_context', RANK_COLUMNS, chunk);
      }
    });
  }

  async recordIngestState(s: { providerId: string; accountId: string; nextCursor: string | null; matchesSeen: number; at: string; error: string | null }): Promise<void> {
    await this.db.query(`INSERT INTO provider_ingest_state (provider_id, account_id, next_cursor, matches_seen, last_success_at, last_error) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (provider_id, account_id) DO UPDATE SET next_cursor=EXCLUDED.next_cursor, matches_seen=EXCLUDED.matches_seen,
      last_success_at=COALESCE(EXCLUDED.last_success_at, provider_ingest_state.last_success_at), last_error=EXCLUDED.last_error`,
    [s.providerId, s.accountId, s.nextCursor, s.matchesSeen, s.error ? null : s.at, s.error]);
  }

  async recordPublication(s: { snapshotId: string; snapshotVersion: string; manifestVersion: string; publisher: string; publishedAt: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE publication_state SET status='superseded' WHERE status='active' AND snapshot_id <> $1`, [s.snapshotId]);
      await tx.query(`INSERT INTO publication_state (snapshot_id, snapshot_version, manifest_version, publisher, status, published_at) VALUES ($1,$2,$3,$4,'active',$5)
        ON CONFLICT (snapshot_id) DO UPDATE SET status='active', published_at=EXCLUDED.published_at`,
      [s.snapshotId, s.snapshotVersion, s.manifestVersion, s.publisher, s.publishedAt]);
    });
  }

  async erasePositionTelemetryForMember(memberId: string): Promise<PositionErasureSummary> {
    return this.db.transaction(async (tx) => {
      const mine = `SELECT match_key, participant_key FROM match_participants WHERE member_id = $1`;
      const participants = Number((await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${mine}) p`, [memberId])).rows[0]!.n);
      const snapshots = await tx.query(`DELETE FROM event_player_snapshots s USING (${mine}) p WHERE s.match_key=p.match_key AND s.participant_key=p.participant_key`, [memberId]);
      const events = await tx.query(`UPDATE events e SET location_x=NULL, location_y=NULL FROM (${mine}) p WHERE e.match_key=p.match_key
        AND (e.actor_participant_key=p.participant_key OR e.target_participant_key=p.participant_key) AND e.location_x IS NOT NULL`, [memberId]);
      const plants = await tx.query(`UPDATE rounds r SET plant_location_x=NULL, plant_location_y=NULL FROM (${mine}) p WHERE r.match_key=p.match_key
        AND r.plant_participant_key=p.participant_key AND r.plant_location_x IS NOT NULL`, [memberId]);
      const defuses = await tx.query(`UPDATE rounds r SET defuse_location_x=NULL, defuse_location_y=NULL FROM (${mine}) p WHERE r.match_key=p.match_key
        AND r.defuse_participant_key=p.participant_key AND r.defuse_location_x IS NOT NULL`, [memberId]);
      return { participants, snapshotsDeleted: snapshots.rowCount, eventLocationsCleared: events.rowCount, plantLocationsCleared: plants.rowCount, defuseLocationsCleared: defuses.rowCount };
    });
  }

  async getGroup(groupId: string): Promise<Group | null> {
    const row = (await this.db.query('SELECT group_id, slug, name, visibility, created_at FROM groups WHERE group_id=$1', [groupId])).rows[0];
    return row ? Group.parse({ groupId: row.group_id, slug: row.slug, name: row.name, visibility: row.visibility, createdAt: iso(row.created_at) }) : null;
  }

  async listMembers(groupId: string): Promise<GroupMember[]> {
    const { rows } = await this.db.query('SELECT member_id, group_id, display_name, status, joined_at FROM group_members WHERE group_id=$1 ORDER BY member_id', [groupId]);
    return rows.map((r) => GroupMember.parse({ memberId: r.member_id, groupId: r.group_id, displayName: r.display_name, status: r.status, joinedAt: iso(r.joined_at) }));
  }

  async listSourceAccounts(groupId: string): Promise<SourceAccount[]> {
    const { rows } = await this.db.query(`SELECT a.account_id, a.member_id, a.provider_id, a.provider_account_ref, a.is_primary, a.linked_at FROM source_accounts a
      JOIN group_members m ON m.member_id=a.member_id WHERE m.group_id=$1 ORDER BY a.account_id`, [groupId]);
    return rows.map((r) => SourceAccount.parse({ accountId: r.account_id, memberId: r.member_id, providerId: r.provider_id, providerAccountRef: r.provider_account_ref,
      isPrimary: r.is_primary, linkedAt: iso(r.linked_at) }));
  }

  async listConsents(groupId: string): Promise<ConsentState[]> {
    const { rows } = await this.db.query(`SELECT c.* FROM consent_state c JOIN group_members m ON m.member_id=c.member_id WHERE m.group_id=$1 ORDER BY c.member_id`, [groupId]);
    return rows.map((r) => ConsentState.parse({ memberId: r.member_id, status: r.consent_status, source: r.consent_source, identityConnected: r.identity_connected,
      dataCollectionAllowed: r.data_collection_allowed, groupVisibilityAllowed: r.group_visibility_allowed, publicDerivedAnalyticsAllowed: r.public_derived_analytics_allowed,
      policyVersion: r.policy_version, updatedAt: iso(r.updated_at) }));
  }

  async hasMatch(providerId: string, providerRecordRef: string): Promise<boolean> {
    const { rows } = await this.db.query('SELECT 1 AS present FROM matches WHERE provider_id=$1 AND provider_record_ref=$2', [providerId, providerRecordRef]);
    return rows.length > 0;
  }

  async getImportRecord(sourceSystem: string, sourceRefHash: string) {
    const row = (await this.db.query('SELECT match_key, source_payload_sha256, normalizer_version FROM import_state WHERE source_system=$1 AND source_ref_hash=$2',
      [sourceSystem, sourceRefHash])).rows[0];
    return row ? { matchKey: String(row.match_key), sourcePayloadSha256: String(row.source_payload_sha256), normalizerVersion: String(row.normalizer_version) } : null;
  }

  async listMatchKeys(): Promise<string[]> {
    return (await this.db.query<{ match_key: string }>('SELECT match_key FROM matches ORDER BY started_at, match_key')).rows.map((r) => r.match_key);
  }

  async listMatchKeysForMembers(memberIds: readonly string[]): Promise<string[]> {
    if (memberIds.length === 0) return [];
    return (await this.db.query<{ match_key: string }>(`SELECT DISTINCT p.match_key, m.started_at FROM match_participants p JOIN matches m ON m.match_key=p.match_key
      WHERE p.member_id = ANY($1::text[]) ORDER BY m.started_at, p.match_key`, [memberIds])).rows.map((r) => r.match_key);
  }

  /** Every stored match with at least one of the members; deterministic order (start time, key). */
  async listMatchesForMembers(memberIds: readonly string[]): Promise<CanonicalMatch[]> {
    return this.getMatches(await this.listMatchKeysForMembers(memberIds));
  }

  async getMatches(matchKeys: readonly string[]): Promise<CanonicalMatch[]> {
    const keys = [...matchKeys];
    if (keys.length === 0) return [];
    const q = (sql: string) => this.db.query(sql, [keys]);
    const [matches, teams, participants, rounds, roundParticipants, events, snapshots] = await Promise.all([
      q('SELECT * FROM matches WHERE match_key = ANY($1::text[])'),
      q('SELECT * FROM match_teams WHERE match_key = ANY($1::text[]) ORDER BY match_key, team_key'),
      q('SELECT * FROM match_participants WHERE match_key = ANY($1::text[]) ORDER BY match_key, participant_key'),
      q('SELECT * FROM rounds WHERE match_key = ANY($1::text[]) ORDER BY match_key, round_number'),
      q('SELECT * FROM round_participants WHERE match_key = ANY($1::text[]) ORDER BY match_key, round_number, participant_key'),
      q('SELECT * FROM events WHERE match_key = ANY($1::text[]) ORDER BY match_key, round_number, sequence, event_key'),
      q('SELECT * FROM event_player_snapshots WHERE match_key = ANY($1::text[]) ORDER BY match_key, event_key, participant_key'),
    ]);
    const by = <R extends Record<string, unknown>>(rows: R[], key: (r: R) => string) => {
      const map = new Map<string, R[]>();
      for (const row of rows) { const k = key(row); const list = map.get(k); if (list) list.push(row); else map.set(k, [row]); }
      return map;
    };
    const mk = (r: Record<string, unknown>) => String(r.match_key);
    const [tBy, pBy, rBy, eBy] = [by(teams.rows, mk), by(participants.rows, mk), by(rounds.rows, mk), by(events.rows, mk)];
    const rpBy = by(roundParticipants.rows, (r) => `${r.match_key}|${r.round_number}`);
    const sBy = by(snapshots.rows, (r) => `${r.match_key}|${r.event_key}`);
    const rowByKey = new Map(matches.rows.map((r) => [String(r.match_key), r]));
    return keys.flatMap((key) => {
      const r = rowByKey.get(key);
      if (!r) return [];
      return [CanonicalMatch.parse({
        schemaVersion: r.schema_version, matchKey: key,
        source: { providerId: r.provider_id, providerVersion: r.provider_version, normalizerVersion: r.normalizer_version, providerRecordRef: r.provider_record_ref,
          observedAt: iso(r.observed_at), acquisition: r.acquisition, acquisitionSource: r.acquisition_source },
        evidence: { historyCompleteness: r.history_completeness, evidenceQuality: r.evidence_quality, rounds: r.rounds_status, kills: r.kills_status,
          hasDamage: r.has_damage, hasPositions: r.has_positions },
        mapId: strOrNull(r.map_id), mapName: strOrNull(r.map_name), mode: r.mode, queue: { id: strOrNull(r.queue_id), name: strOrNull(r.queue_name) },
        season: { key: strOrNull(r.season_key), ref: strOrNull(r.season_ref) }, startedAt: iso(r.started_at), durationMs: numOrNull(r.duration_ms),
        teams: (tBy.get(key) ?? []).map((t) => ({ teamKey: t.team_key, roundsWon: numOrNull(t.rounds_won), roundsLost: numOrNull(t.rounds_lost), won: t.won })),
        participants: (pBy.get(key) ?? []).map((p) => ({ participantKey: p.participant_key, teamKey: p.team_key, memberId: p.member_id, accountId: p.account_id,
          agentId: p.agent_id, agentName: p.agent_name,
          stats: { status: p.stats_status, kills: numOrNull(p.kills), deaths: numOrNull(p.deaths), assists: numOrNull(p.assists), score: numOrNull(p.score),
            damageDealt: numOrNull(p.damage_dealt), damageReceived: numOrNull(p.damage_received), headshots: numOrNull(p.headshots), bodyshots: numOrNull(p.bodyshots),
            legshots: numOrNull(p.legshots) },
          abilityCasts: { status: p.ability_status, ability1: numOrNull(p.ability1_casts), ability2: numOrNull(p.ability2_casts), grenade: numOrNull(p.grenade_casts),
            ultimate: numOrNull(p.ultimate_casts) },
          economy: { status: p.economy_status, loadoutValueTotal: numOrNull(p.loadout_value_total), loadoutValueAverage: numOrNull(p.loadout_value_average),
            spentTotal: numOrNull(p.spent_total), spentAverage: numOrNull(p.spent_average) } })),
        rounds: (rBy.get(key) ?? []).map((x) => ({ roundNumber: num(x.round_number), winningTeamKey: strOrNull(x.winning_team_key), result: strOrNull(x.result),
          winningTeamRole: x.winning_team_role ?? null, attackingTeamKey: strOrNull(x.attacking_team_key), sideSource: x.side_source ?? null,
          plant: { status: x.plant_status, participantKey: strOrNull(x.plant_participant_key), timeInRoundMs: numOrNull(x.plant_time_ms), site: strOrNull(x.plant_site),
            location: pointOf(x.plant_location_x, x.plant_location_y) },
          defuse: { status: x.defuse_status, participantKey: strOrNull(x.defuse_participant_key), timeInRoundMs: numOrNull(x.defuse_time_ms),
            location: pointOf(x.defuse_location_x, x.defuse_location_y) },
          participantsStatus: x.participants_status,
          participants: (rpBy.get(`${key}|${x.round_number}`) ?? []).map((p) => ({ participantKey: p.participant_key,
            stats: { status: p.stats_status, kills: numOrNull(p.kills), score: numOrNull(p.score) },
            economy: { status: p.economy_status, loadoutValue: numOrNull(p.loadout_value), remainingCredits: numOrNull(p.remaining_credits) },
            weapon: { status: p.weapon_status, id: strOrNull(p.weapon_id), name: strOrNull(p.weapon_name) },
            armor: { status: p.armor_status, id: strOrNull(p.armor_id), name: strOrNull(p.armor_name) } })) })),
        events: (eBy.get(key) ?? []).map((e) => ({ eventKey: e.event_key, roundNumber: num(e.round_number), sequence: num(e.sequence), timeInRoundMs: num(e.time_in_round_ms),
          timeInMatchMs: numOrNull(e.time_in_match_ms), type: e.event_type, actorParticipantKey: e.actor_participant_key, targetParticipantKey: e.target_participant_key,
          assistantParticipantKeys: jsonArray(e.assistant_participant_keys), weapon: assetOf(e.weapon_id ?? null, e.weapon_name ?? null),
          location: pointOf(e.location_x, e.location_y),
          playerSnapshots: (sBy.get(`${key}|${e.event_key}`) ?? []).map((s) => ({ participantKey: s.participant_key, location: { x: num(s.location_x), y: num(s.location_y) },
            viewRadians: numOrNull(s.view_radians) })) })),
      })];
    });
  }

  async listRankContext(memberIds: readonly string[]): Promise<RankContext[]> {
    const { rows } = await this.db.query(`SELECT * FROM rank_context WHERE member_id = ANY($1::text[]) ORDER BY member_id, effective_at, rank_context_id`, [memberIds]);
    return rows.map(rankRow);
  }

  async rankContextForMatch(memberId: string, matchKey: string, startedAt: string): Promise<RankContext | null> {
    const own = (await this.db.query(`SELECT * FROM rank_context WHERE member_id=$1 AND kind='match-snapshot' AND match_key=$2 ORDER BY rank_context_id LIMIT 1`,
      [memberId, matchKey])).rows[0];
    if (own) return rankRow(own);
    // A history row records the OUTCOME of its own match (its effective time can precede that match's start by ~1 s), so the
    // row belonging to this match is excluded explicitly in addition to the strict time bound: no future leakage.
    const prior = (await this.db.query(`SELECT * FROM rank_context WHERE member_id=$1 AND kind='history' AND effective_at < $2::timestamptz
      AND (match_key IS NULL OR match_key <> $3) ORDER BY effective_at DESC, rank_context_id LIMIT 1`, [memberId, startedAt, matchKey])).rows[0];
    return prior ? rankRow(prior) : null;
  }
}

function rankRow(r: Record<string, unknown>): RankContext {
  return RankContext.parse({ rankContextId: r.rank_context_id, memberId: r.member_id, accountId: r.account_id, kind: r.kind, effectiveAt: iso(r.effective_at),
    matchKey: strOrNull(r.match_key), providerId: r.provider_id, sourceEndpoint: r.source_endpoint, providerTierId: numOrNull(r.provider_tier_id),
    providerTierName: strOrNull(r.provider_tier_name), rr: numOrNull(r.rr), rrChange: numOrNull(r.rr_change), providerElo: numOrNull(r.provider_elo),
    seasonKey: strOrNull(r.season_key), queue: strOrNull(r.queue), normalizedTierKey: strOrNull(r.normalized_tier_key), tierOrdinal: numOrNull(r.tier_ordinal),
    tierModelVersion: r.tier_model_version });
}
