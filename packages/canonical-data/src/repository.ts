import { CanonicalMatch, RankContext, type CanonicalEvent } from '@vsa/contracts/canonical';
import { ConsentState, Group, GroupMember, SourceAccount } from '@vsa/contracts/control';
import type { SqlClient, SqlExecutor } from './sql.ts';

/** Write side: used by the collector's ingest service. */
export interface CanonicalWriteRepository {
  upsertGroup(group: Group): Promise<void>;
  upsertMember(member: GroupMember): Promise<void>;
  upsertSourceAccount(account: SourceAccount): Promise<void>;
  upsertConsent(consent: ConsentState): Promise<void>;
  /** Idempotent: re-saving the same canonical match replaces it exactly. */
  saveMatch(match: CanonicalMatch): Promise<void>;
  saveRankContext(contexts: readonly RankContext[]): Promise<void>;
  recordIngestState(state: { providerId: string; accountId: string; nextCursor: string | null; matchesSeen: number; at: string; error: string | null }): Promise<void>;
  recordPublication(state: { snapshotId: string; snapshotVersion: string; manifestVersion: string; publisher: string; publishedAt: string }): Promise<void>;
}

/** Read side: used by analytics orchestration and the exporter's inputs. Analytics itself never sees SQL. */
export interface CanonicalReadRepository {
  getGroup(groupId: string): Promise<Group | null>;
  listMembers(groupId: string): Promise<GroupMember[]>;
  listSourceAccounts(groupId: string): Promise<SourceAccount[]>;
  listConsents(groupId: string): Promise<ConsentState[]>;
  hasMatch(providerId: string, providerRecordRef: string): Promise<boolean>;
  listMatchesForMembers(memberIds: readonly string[]): Promise<CanonicalMatch[]>;
}

export type CanonicalRepository = CanonicalWriteRepository & CanonicalReadRepository;

const iso = (value: unknown): string => (value instanceof Date ? value : new Date(String(value))).toISOString();
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value));
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : num(value));
const jsonArray = (value: unknown): string[] => (Array.isArray(value) ? value : JSON.parse(String(value))) as string[];

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
    await this.db.query(`INSERT INTO source_accounts (account_id, member_id, provider_id, provider_account_ref, linked_at) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (account_id) DO UPDATE SET member_id=EXCLUDED.member_id`,
    [a.accountId, a.memberId, a.providerId, a.providerAccountRef, a.linkedAt]);
  }

  async upsertConsent(input: ConsentState): Promise<void> {
    const c = ConsentState.parse(input);
    await this.db.query(`INSERT INTO consent_state (member_id, identity_connected, data_collection_allowed, group_visibility_allowed,
      public_derived_analytics_allowed, policy_version, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (member_id) DO UPDATE SET identity_connected=EXCLUDED.identity_connected, data_collection_allowed=EXCLUDED.data_collection_allowed,
      group_visibility_allowed=EXCLUDED.group_visibility_allowed, public_derived_analytics_allowed=EXCLUDED.public_derived_analytics_allowed,
      policy_version=EXCLUDED.policy_version, updated_at=EXCLUDED.updated_at`,
    [c.memberId, c.identityConnected, c.dataCollectionAllowed, c.groupVisibilityAllowed, c.publicDerivedAnalyticsAllowed, c.policyVersion, c.updatedAt]);
  }

  async saveMatch(input: CanonicalMatch): Promise<void> {
    const m = CanonicalMatch.parse(input);
    await this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO matches (match_key, schema_version, provider_id, provider_version, normalizer_version, provider_record_ref, observed_at,
        history_completeness, evidence_quality, has_rounds, has_events, has_damage, map_id, map_name, mode, started_at, duration_seconds, rank_context_refs)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
        ON CONFLICT (match_key) DO UPDATE SET schema_version=EXCLUDED.schema_version, provider_version=EXCLUDED.provider_version,
        normalizer_version=EXCLUDED.normalizer_version, observed_at=EXCLUDED.observed_at, history_completeness=EXCLUDED.history_completeness,
        evidence_quality=EXCLUDED.evidence_quality, has_rounds=EXCLUDED.has_rounds, has_events=EXCLUDED.has_events, has_damage=EXCLUDED.has_damage,
        map_id=EXCLUDED.map_id, map_name=EXCLUDED.map_name, mode=EXCLUDED.mode, started_at=EXCLUDED.started_at,
        duration_seconds=EXCLUDED.duration_seconds, rank_context_refs=EXCLUDED.rank_context_refs`,
      [m.matchKey, m.schemaVersion, m.source.providerId, m.source.providerVersion, m.source.normalizerVersion, m.source.providerRecordRef, m.source.observedAt,
        m.evidence.historyCompleteness, m.evidence.evidenceQuality, m.evidence.hasRounds, m.evidence.hasEvents, m.evidence.hasDamage,
        m.mapId, m.mapName, m.mode, m.startedAt, m.durationSeconds, JSON.stringify(m.rankContextRefs)]);
      for (const table of ['match_teams', 'match_participants', 'rounds', 'events']) await tx.query(`DELETE FROM ${table} WHERE match_key=$1`, [m.matchKey]);
      for (const t of m.teams) await tx.query('INSERT INTO match_teams (match_key, team_key, rounds_won, won) VALUES ($1,$2,$3,$4)', [m.matchKey, t.teamKey, t.roundsWon, t.won]);
      for (const p of m.participants) {
        await tx.query(`INSERT INTO match_participants (match_key, participant_key, team_key, member_id, account_id, agent_id, agent_name, kills, deaths, assists, damage_dealt, score)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [m.matchKey, p.participantKey, p.teamKey, p.memberId, p.accountId, p.agentId, p.agentName, p.stats.kills, p.stats.deaths, p.stats.assists, p.stats.damageDealt, p.stats.score]);
      }
      for (const r of m.rounds) await tx.query('INSERT INTO rounds (match_key, round_number, winning_team_key, attacking_team_key) VALUES ($1,$2,$3,$4)', [m.matchKey, r.roundNumber, r.winningTeamKey, r.attackingTeamKey]);
      for (const e of m.events) await insertEvent(tx, m.matchKey, e);
    });
  }

  async saveRankContext(contexts: readonly RankContext[]): Promise<void> {
    for (const input of contexts) {
      const r = RankContext.parse(input);
      await this.db.query(`INSERT INTO rank_context (rank_context_id, member_id, kind, observed_at, tier_id, tier_name, provider_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (rank_context_id) DO UPDATE SET observed_at=EXCLUDED.observed_at, tier_id=EXCLUDED.tier_id, tier_name=EXCLUDED.tier_name`,
      [r.rankContextId, r.memberId, r.kind, r.observedAt, r.tierId, r.tierName, r.providerId]);
    }
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

  async getGroup(groupId: string): Promise<Group | null> {
    const row = (await this.db.query('SELECT group_id, slug, name, visibility, created_at FROM groups WHERE group_id=$1', [groupId])).rows[0];
    return row ? Group.parse({ groupId: row.group_id, slug: row.slug, name: row.name, visibility: row.visibility, createdAt: iso(row.created_at) }) : null;
  }

  async listMembers(groupId: string): Promise<GroupMember[]> {
    const { rows } = await this.db.query('SELECT member_id, group_id, display_name, status, joined_at FROM group_members WHERE group_id=$1 ORDER BY member_id', [groupId]);
    return rows.map((r) => GroupMember.parse({ memberId: r.member_id, groupId: r.group_id, displayName: r.display_name, status: r.status, joinedAt: iso(r.joined_at) }));
  }

  async listSourceAccounts(groupId: string): Promise<SourceAccount[]> {
    const { rows } = await this.db.query(`SELECT a.account_id, a.member_id, a.provider_id, a.provider_account_ref, a.linked_at FROM source_accounts a
      JOIN group_members m ON m.member_id=a.member_id WHERE m.group_id=$1 ORDER BY a.account_id`, [groupId]);
    return rows.map((r) => SourceAccount.parse({ accountId: r.account_id, memberId: r.member_id, providerId: r.provider_id, providerAccountRef: r.provider_account_ref, linkedAt: iso(r.linked_at) }));
  }

  async listConsents(groupId: string): Promise<ConsentState[]> {
    const { rows } = await this.db.query(`SELECT c.* FROM consent_state c JOIN group_members m ON m.member_id=c.member_id WHERE m.group_id=$1 ORDER BY c.member_id`, [groupId]);
    return rows.map((r) => ConsentState.parse({ memberId: r.member_id, identityConnected: r.identity_connected, dataCollectionAllowed: r.data_collection_allowed,
      groupVisibilityAllowed: r.group_visibility_allowed, publicDerivedAnalyticsAllowed: r.public_derived_analytics_allowed, policyVersion: r.policy_version, updatedAt: iso(r.updated_at) }));
  }

  async hasMatch(providerId: string, providerRecordRef: string): Promise<boolean> {
    const { rows } = await this.db.query('SELECT 1 AS present FROM matches WHERE provider_id=$1 AND provider_record_ref=$2', [providerId, providerRecordRef]);
    return rows.length > 0;
  }

  /** Every stored match with at least one of the members; deterministic order (start time, key). */
  async listMatchesForMembers(memberIds: readonly string[]): Promise<CanonicalMatch[]> {
    if (memberIds.length === 0) return [];
    const keys = (await this.db.query<{ match_key: string }>(`SELECT DISTINCT p.match_key, m.started_at FROM match_participants p JOIN matches m ON m.match_key=p.match_key
      WHERE p.member_id = ANY($1::text[]) ORDER BY m.started_at, p.match_key`, [memberIds])).rows.map((r) => r.match_key);
    if (keys.length === 0) return [];
    const [matches, teams, participants, rounds, events] = await Promise.all([
      this.db.query('SELECT * FROM matches WHERE match_key = ANY($1::text[])', [keys]),
      this.db.query('SELECT * FROM match_teams WHERE match_key = ANY($1::text[]) ORDER BY match_key, team_key', [keys]),
      this.db.query('SELECT * FROM match_participants WHERE match_key = ANY($1::text[]) ORDER BY match_key, participant_key', [keys]),
      this.db.query('SELECT * FROM rounds WHERE match_key = ANY($1::text[]) ORDER BY match_key, round_number', [keys]),
      this.db.query('SELECT * FROM events WHERE match_key = ANY($1::text[]) ORDER BY match_key, event_key', [keys]),
    ]);
    const by = <R extends Record<string, unknown>>(rows: R[]) => {
      const map = new Map<string, R[]>();
      for (const row of rows) map.set(String(row.match_key), [...(map.get(String(row.match_key)) ?? []), row]);
      return map;
    };
    const [tBy, pBy, rBy, eBy] = [by(teams.rows), by(participants.rows), by(rounds.rows), by(events.rows)];
    const rowByKey = new Map(matches.rows.map((r) => [String(r.match_key), r]));
    return keys.map((key) => {
      const r = rowByKey.get(key)!;
      return CanonicalMatch.parse({
        schemaVersion: r.schema_version, matchKey: key,
        source: { providerId: r.provider_id, providerVersion: r.provider_version, normalizerVersion: r.normalizer_version, providerRecordRef: r.provider_record_ref, observedAt: iso(r.observed_at) },
        evidence: { historyCompleteness: r.history_completeness, evidenceQuality: r.evidence_quality, hasRounds: r.has_rounds, hasEvents: r.has_events, hasDamage: r.has_damage },
        mapId: r.map_id, mapName: r.map_name, mode: r.mode, startedAt: iso(r.started_at), durationSeconds: numOrNull(r.duration_seconds),
        teams: (tBy.get(key) ?? []).map((t) => ({ teamKey: t.team_key, roundsWon: num(t.rounds_won), won: t.won })),
        participants: (pBy.get(key) ?? []).map((p) => ({ participantKey: p.participant_key, teamKey: p.team_key, memberId: p.member_id, accountId: p.account_id,
          agentId: p.agent_id, agentName: p.agent_name,
          stats: { kills: num(p.kills), deaths: num(p.deaths), assists: num(p.assists), damageDealt: numOrNull(p.damage_dealt), score: numOrNull(p.score) } })),
        rounds: (rBy.get(key) ?? []).map((x) => ({ roundNumber: num(x.round_number), winningTeamKey: x.winning_team_key, attackingTeamKey: x.attacking_team_key })),
        events: (eBy.get(key) ?? []).map((e) => ({ eventKey: e.event_key, roundNumber: num(e.round_number), timeInRoundMs: num(e.time_in_round_ms), type: e.event_type,
          actorParticipantKey: e.actor_participant_key, targetParticipantKey: e.target_participant_key, assistantParticipantKeys: jsonArray(e.assistant_participant_keys),
          spatial: e.location_x === null ? null : { locationX: num(e.location_x), locationY: num(e.location_y), viewRadians: numOrNull(e.view_radians) } })),
        rankContextRefs: jsonArray(r.rank_context_refs),
      });
    });
  }
}

async function insertEvent(tx: SqlExecutor, matchKey: string, e: CanonicalEvent): Promise<void> {
  await tx.query(`INSERT INTO events (match_key, event_key, round_number, time_in_round_ms, event_type, actor_participant_key, target_participant_key,
    assistant_participant_keys, location_x, location_y, view_radians) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
  [matchKey, e.eventKey, e.roundNumber, e.timeInRoundMs, e.type, e.actorParticipantKey, e.targetParticipantKey, JSON.stringify(e.assistantParticipantKeys),
    e.spatial?.locationX ?? null, e.spatial?.locationY ?? null, e.spatial?.viewRadians ?? null]);
}
