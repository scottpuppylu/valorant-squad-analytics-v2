import { createHash } from 'node:crypto';
import { createEmbeddedClient, type SqlClient } from '@vsa/canonical-data';

/**
 * SYNTHETIC legacy private staging (rebuild-staging-v1 + rank-staging-v1 table shapes, as audited). Every identifier is
 * fictional. After seeding, the session is switched to read-only — exactly like the real source.
 */
export const pu = (n: number) => `legacy-fixture-puuid-${String(n).padStart(4, '0')}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
export const mid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const MIKS = '7c8a4701-4de6-9355-b254-e09bc2a34b72';
export const UNKNOWN_AGENT = '773f0c78-4486-752b-68ef-4585d7f4b848';
export const JETT = 'add6443a-41bd-e414-f6ad-e58d267f4e95';

export interface FixtureAccount { account: number; member: number; name: string; primary: boolean; puuid: number | null }
export const FIXTURE_ACCOUNTS: FixtureAccount[] = [
  { account: 1, member: 1, name: 'Alpha', primary: true, puuid: 1 },
  { account: 2, member: 1, name: 'Alpha', primary: false, puuid: 2 }, // multi-account member
  { account: 3, member: 2, name: 'Bravo', primary: true, puuid: 3 },
  { account: 4, member: 3, name: 'Charlie', primary: true, puuid: 4 },
];

type Json = Record<string, unknown>;
export function payload(n: number, opts: { queue?: [string, string]; teams?: 'two' | 'ffa'; startedAt?: string; unknownRoundKill?: boolean } = {}): Json {
  const [qid, qname] = opts.queue ?? ['competitive', 'Competitive'];
  const ffa = opts.teams === 'ffa';
  const ids = [1, 3, 4, 90 + n, 95 + n, 2];
  const team = (i: number) => (ffa ? pu(ids[i]!) : i < 3 ? 'Blue' : 'Red'); // deathmatch: team id = player id
  const players = ids.map((p, i) => ({
    puuid: pu(p), team_id: team(i), agent: { id: i === 0 ? MIKS : i === 4 ? UNKNOWN_AGENT : JETT, name: i === 0 ? 'Miks' : i === 4 ? 'Unknown' : 'Jett' },
    stats: { kills: 5 + i, deaths: 4, assists: 2, score: 3000 + i, headshots: 3, bodyshots: 10, legshots: 1, damage: { dealt: 1500 + 10 * i, received: 1400 } },
    ability_casts: { ability1: 3, ability2: 2, grenade: 4, ultimate: 1 },
    economy: { loadout_value: { overall: 50000, average: 3900.5 }, spent: { overall: 48000, average: 3700.25 } },
  }));
  const rounds = [0, 1, 2].map((id) => ({
    id, winning_team: ffa ? null : id === 2 ? 'Red' : 'Blue', winning_team_role: ffa ? 'FreeForAll' : id === 1 ? 'Defender' : 'Attacker', result: id === 1 ? 'Defuse' : 'Elimination',
    plant: id === 1 ? { site: 'B', location: { x: 1111.5, y: -2222.25 }, player: { puuid: pu(90 + n), team: 'Red' }, round_time_in_ms: 40000 } : null,
    defuse: id === 1 ? { location: { x: 1333.5, y: -2444.25 }, player: { puuid: pu(1), team: 'Blue' }, round_time_in_ms: 70000 } : null,
    stats: ids.slice(0, 3).map((p) => ({ player: { puuid: pu(p) }, stats: { kills: 1, score: 200 }, economy: { loadout_value: 3900, remaining: 800, weapon: { id: 'w-vandal', name: 'Vandal' }, armor: { id: 'a-heavy', name: 'Heavy Shields' } } })),
  }));
  const kill = (round: number, t: number, killer: number, victim: number, extra: Json = {}) => ({
    round, time_in_round_in_ms: t, time_in_match_in_ms: round * 100000 + t, killer: { puuid: pu(killer), team: 'Blue' }, victim: { puuid: pu(victim), team: 'Red' },
    assistants: [{ puuid: pu(3) }], weapon: { id: 'w-vandal', name: 'Vandal' }, location: { x: 5000.375 + round, y: 6000.625 + t / 1000 },
    player_locations: [
      { player: { puuid: pu(killer) }, location: { x: 4000.375, y: 4100.625 }, view_radians: 1.5 },
      { player: { puuid: pu(killer) }, location: { x: 1.0, y: 2.0 }, view_radians: 0.1 }, // duplicate: first row wins
      { player: { puuid: pu(4) }, location: { x: 4200.375, y: 4300.625 }, view_radians: 2.5 },
      { player: { puuid: pu(999) }, location: { x: 9.0, y: 9.0 } }, // non-roster: dropped
      { player: {}, location: { x: 1, y: 1 } }, // invalid: dropped
    ], ...extra,
  });
  const kills = [kill(0, 10000, 1, 90 + n), kill(0, 20000, 3, 95 + n), kill(1, 15000, 4, 90 + n), kill(2, 5000, 90 + n, 1),
    { ...kill(2, 9000, 1, 777), killer: { puuid: pu(1), team: 'Blue' }, victim: { puuid: pu(777), team: 'Red' } }]; // kill-only participant
  if (opts.unknownRoundKill) kills.push(kill(9, 1000, 1, 90 + n));
  return {
    metadata: { match_id: mid(n), map: { id: 'map-uuid-ascent', name: 'Ascent' }, queue: { id: qid, name: qname }, season: { id: uuid(500), short: 'e9a3' },
      started_at: opts.startedAt ?? new Date(Date.UTC(2026, 0, 1 + n, 12)).toISOString().replace('.000Z', '.5Z'), game_length_in_ms: 1_800_000 },
    players,
    teams: ffa ? ids.map((_, i) => ({ team_id: team(i), won: i === 0, rounds: { won: i === 0 ? 1 : 0, lost: i === 0 ? 0 : 1 } }))
      : [{ team_id: 'Blue', won: true, rounds: { won: 2, lost: 1 } }, { team_id: 'Red', won: false, rounds: { won: 1, lost: 2 } }],
    rounds, kills,
  };
}

export interface FixtureOptions { matches?: Json[]; accounts?: FixtureAccount[]; rank?: boolean }

export async function createLegacyStaging(options: FixtureOptions = {}): Promise<{ sql: SqlClient; payloads: Json[] }> {
  const sql = createEmbeddedClient();
  const payloads = options.matches ?? [
    payload(1), payload(2), payload(3, { queue: ['swiftplay', 'Swiftplay'] }), payload(4, { queue: ['deathmatch', 'Deathmatch'], teams: 'ffa' }),
    payload(5, { queue: ['', 'Custom Game'] }), payload(6, { unknownRoundKill: true }),
  ];
  for (const stmt of [
    'CREATE SCHEMA rebuild_staging', 'CREATE SCHEMA rank_staging',
    'CREATE TABLE rebuild_staging.meta (key text PRIMARY KEY, value text NOT NULL)', 'CREATE TABLE rank_staging.meta (key text PRIMARY KEY, value text NOT NULL)',
    `CREATE TABLE rebuild_staging.accounts (account_public_id uuid PRIMARY KEY, member_public_id uuid NOT NULL, community_name text NOT NULL, game_name text NOT NULL,
      tag text NOT NULL, is_primary boolean NOT NULL, affinity text, provider_puuid text, resolved_at timestamptz)`,
    `CREATE TABLE rebuild_staging.matches (provider_match_id text PRIMARY KEY, match_ref text NOT NULL, first_discovered_at timestamptz NOT NULL, started_at timestamptz,
      mode text, map_name text, season_short text, detail_affinity text NOT NULL, hydration_status text NOT NULL, hydration_attempts integer NOT NULL, last_error text, hydrated_at timestamptz)`,
    `CREATE TABLE rebuild_staging.match_payloads (provider_match_id text PRIMARY KEY, source text NOT NULL, payload jsonb NOT NULL, payload_sha256 text NOT NULL, fetched_at timestamptz NOT NULL)`,
    `CREATE TABLE rank_staging.rank_evidence (evidence_key text PRIMARY KEY, account_public_id uuid NOT NULL, kind text NOT NULL, source text NOT NULL, effective_at timestamptz NOT NULL,
      first_ingested_at timestamptz NOT NULL, last_ingested_at timestamptz NOT NULL, observation_count integer NOT NULL, season_id text, season_short text, provider_tier_id integer,
      provider_tier_name text, rr integer, provider_elo integer, rr_change integer, match_ref text, queue text, normalized_tier_key text, tier_ordinal integer,
      tier_model_version text NOT NULL, extra jsonb NOT NULL)`,
  ]) await sql.query(stmt);
  await sql.query(`INSERT INTO rebuild_staging.meta VALUES ('schema_version','rebuild-staging-v1')`);
  await sql.query(`INSERT INTO rank_staging.meta VALUES ('schema_version','rank-staging-v1')`);
  for (const a of options.accounts ?? FIXTURE_ACCOUNTS) {
    await sql.query(`INSERT INTO rebuild_staging.accounts VALUES ($1,$2,$3,'Fixture','TAG',$4,'ap',$5,now())`,
      [uuid(a.account), uuid(100 + a.member), a.name, a.primary, a.puuid === null ? null : pu(a.puuid)]);
  }
  for (const p of payloads) {
    const id = (p.metadata as Json).match_id as string;
    const text = JSON.stringify(p);
    await sql.query(`INSERT INTO rebuild_staging.matches VALUES ($1,$2,now(),$3,'m','Ascent','e9a3','ap','hydrated',1,null,now())`, [id, `ref-${id}`, (p.metadata as Json).started_at]);
    await sql.query(`INSERT INTO rebuild_staging.match_payloads VALUES ($1,'v4_history',$2::jsonb,$3,'2026-10-07T12:00:00.000Z')`, [id, text, createHash('sha256').update(text).digest('hex')]);
  }
  if (options.rank !== false) {
    const first = payloads[0]!; const firstId = (first.metadata as Json).match_id as string; const firstStart = (first.metadata as Json).started_at as string;
    const rank = (key: string, account: number, kind: string, at: string, tier: number, matchRef: string | null, elo: number | null) => sql.query(
      `INSERT INTO rank_staging.rank_evidence VALUES ($1,$2,$3,'henrik:test',$4,now(),now(),1,null,'e9a3',$5,'Tier',10,$6,null,$7,'competitive','tier',$5,'valorant-tier-order-v1','{}'::jsonb)`,
      [key, uuid(account), kind, at, tier, elo, matchRef]);
    await rank('rk-snap', 1, 'match_snapshot', firstStart, 14, `ref-${firstId}`, null);
    // history row of the SAME match, effective 1 s before its start (the real-data pattern): must never be its own context
    await rank('rk-hist-own', 3, 'history', new Date(Date.parse(firstStart) - 1000).toISOString(), 99, `ref-${firstId}`, 9999);
    await rank('rk-hist-old', 3, 'history', '2025-12-01T00:00:00.000Z', 12, null, 1210);
    await rank('rk-current', 3, 'current', '2026-10-07T15:00:00.000Z', 21, null, 1810);
    await rank('rk-peak', 3, 'peak', '2026-10-07T15:00:00.000Z', 24, null, null);
    await rank('rk-orphan', 3, 'history', '2025-11-01T00:00:00.000Z', 11, 'ref-not-staged', 1100);
  }
  await sql.query('SET default_transaction_read_only = on');
  return { sql, payloads };
}
