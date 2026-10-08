import { createHash } from 'node:crypto';
import { CanonicalMatch, type CanonicalEvent, type CanonicalParticipant, type CanonicalRound, type CanonicalRoundParticipant } from '@vsa/contracts/canonical';
import type { EvidenceStatus, GameMode } from '@vsa/contracts/common';
import { CANONICAL_SCHEMA_VERSION } from '@vsa/contracts/versions';
import { canonicalMatchKey, canonicalParticipantKey } from '@vsa/source-adapters';

/**
 * Henrik v4 match document (as stored in legacy private staging) → CanonicalMatch.
 *
 * A port (REQUIRES_ADAPTATION, docs/LEGACY_PORT_AUDIT.md #17) of the ACCEPTED legacy rules at release 1a4c790:
 *   server/evidence/normalizeHenrikEvidence.ts — statuses, kill validity, participants (incl. kill-only), round participants
 *   server/evidence/positionEvidence.ts       — explicit-evidence round side, provider plant-site label, lossless points
 *   server/evidence/seasonEvidence.ts         — season id / short validation
 *   src/utils/gameMode.ts                     — queue label interpretation
 * Differences (intended): provider identities never enter canonical data (participant / team keys are derived and
 * match-scoped); deathmatch team ids (= player ids) are derived keys; canonical keeps every mode.
 */
export const HENRIK_PROVIDER_ID = 'henrik';
export const HENRIK_PAYLOAD_VERSION = 'henrik-v4';
export const LEGACY_IMPORT_NORMALIZER_VERSION = 'legacy-henrik-v4-import-v1';

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const asRecords = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const asText = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const nn = (value: unknown): number | null => asNumber(value) ?? null;
const point = (value: unknown): { x: number; y: number } | null => {
  if (!isRecord(value)) return null;
  const x = asNumber(value.x); const y = asNumber(value.y);
  return x !== undefined && y !== undefined ? { x, y } : null;
};
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SIMPLE_TEAM_LABEL = /^[A-Za-z][A-Za-z0-9_]{0,15}$/u;

function recordsEvidence(container: Json, field: string): { status: EvidenceStatus; records: Json[] } {
  if (!(field in container)) return { status: 'missing', records: [] };
  const value = container[field];
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) return { status: 'unavailable', records: [] };
  return { status: 'observed', records: value };
}

function numericObjectEvidence(container: Json, field: string, keys: readonly string[]): { status: EvidenceStatus; value?: Json } {
  if (!(field in container)) return { status: 'missing' };
  const value = container[field];
  if (!isRecord(value)) return { status: 'unavailable' };
  const statuses = keys.map((key) => (!(key in value) ? 'missing' : asNumber(value[key]) === undefined ? 'unavailable' : 'observed'));
  if (statuses.every((s) => s === 'observed')) return { status: 'observed', value };
  if (statuses.every((s) => s === 'missing')) return { status: 'missing', value };
  return { status: 'unavailable', value };
}

function objectStatus(container: Json, field: string): 'present' | 'absent' | 'missing' | 'unavailable' {
  if (!(field in container)) return 'missing';
  if (container[field] === null) return 'absent';
  return isRecord(container[field]) ? 'present' : 'unavailable';
}

function asset(value: unknown): { status: EvidenceStatus; id: string | null; name: string | null } {
  if (value === undefined) return { status: 'missing', id: null, name: null };
  if (!isRecord(value)) return { status: 'unavailable', id: null, name: null };
  const id = asText(value.id) ?? null; const name = asText(value.name) ?? null;
  return id || name ? { status: 'observed', id, name } : { status: 'missing', id: null, name: null };
}

/** Queue → normalized mode (legacy normalizeGameMode label rules, extended to keep every mode distinguishable). */
export function normalizeMode(queueId: string | undefined, queueName: string | undefined): GameMode {
  const id = (queueId ?? '').toLowerCase(); const label = (queueName ?? queueId ?? '').toLowerCase();
  const byId: Record<string, GameMode> = { competitive: 'competitive', unrated: 'unrated', premier: 'premier', swiftplay: 'swiftplay', spikerush: 'spike-rush',
    deathmatch: 'deathmatch', hurm: 'team-deathmatch', ggteam: 'escalation', onefa: 'replication', snowball: 'snowball', custom: 'custom' };
  if (byId[id]) return byId[id]!;
  if (label.includes('competitive')) return 'competitive';
  if (label.includes('premier')) return 'premier';
  if (label.includes('unrated')) return 'unrated';
  if (label.includes('custom')) return 'custom';
  return label || id ? 'other' : 'unknown';
}

/** Explicit-evidence round side (legacy deriveRoundSide): all sources must agree; any conflict → unknown. */
export function deriveRoundSide(input: { teamKeys: readonly string[]; winningTeam: string | null; winningTeamRole: unknown; planterTeam: string | null; defuserTeam: string | null }) {
  const role = input.winningTeamRole === 'Attacker' || input.winningTeamRole === 'Defender' ? input.winningTeamRole : undefined;
  const winningTeamRole = role === 'Attacker' ? 'attacker' as const : role === 'Defender' ? 'defender' as const : null;
  const teams = [...new Set(input.teamKeys)].sort();
  const unknown = { winningTeamRole, attackingTeamKey: null, sideSource: null, conflict: false };
  if (teams.length !== 2) return unknown;
  const other = (team: string) => (team === teams[0] ? teams[1]! : teams[0]!);
  const candidates: { team: string; source: 'winning_team_role' | 'plant' | 'defuse' }[] = [];
  if (role && input.winningTeam && teams.includes(input.winningTeam)) candidates.push({ team: role === 'Attacker' ? input.winningTeam : other(input.winningTeam), source: 'winning_team_role' });
  if (input.planterTeam && teams.includes(input.planterTeam)) candidates.push({ team: input.planterTeam, source: 'plant' });
  if (input.defuserTeam && teams.includes(input.defuserTeam)) candidates.push({ team: other(input.defuserTeam), source: 'defuse' });
  if (!candidates.length) return unknown;
  if (candidates.some((c) => c.team !== candidates[0]!.team)) return { ...unknown, conflict: true };
  return { winningTeamRole, attackingTeamKey: candidates[0]!.team, sideSource: candidates[0]!.source, conflict: false };
}

export interface NormalizeContext {
  /** provider account ref → internal ids (tracked members only). */
  resolveIdentity: (providerAccountRef: string) => { memberId: string; accountId: string } | null;
  observedAt: string;
  acquisitionSource: string;
}

export interface NormalizeDiagnostics {
  killsInUnknownRounds: number;
  invalidKills: number;
  snapshotsDropped: { duplicate: number; nonRoster: number; invalid: number };
  sideConflicts: number;
  killOnlyParticipants: number;
  /** Negative credit values (observed only in Custom Game): withheld as null, the economy block marked unavailable. */
  economyOutOfDomain: number;
}

export function normalizeHenrikV4Match(payload: Json, ctx: NormalizeContext): { match: CanonicalMatch; diagnostics: NormalizeDiagnostics } {
  const metadata = isRecord(payload.metadata) ? payload.metadata : undefined;
  const matchId = asText(metadata?.match_id);
  if (!metadata || !matchId) throw new Error('payload has no metadata.match_id');
  const matchKey = canonicalMatchKey(HENRIK_PROVIDER_ID, matchId);
  const pkey = (puuid: string) => canonicalParticipantKey(matchKey, puuid);
  /**
   * Opaque, match-scoped team key. Only short simple labels (Red / Blue / Team_3) are kept (lowercased); anything else —
   * uuid-shaped ids (deathmatch: a player id) or any long / unusual value — becomes a derived key. Never truncated.
   */
  const teamKeyOf = (raw: unknown): string => {
    const text = asText(raw);
    if (!text) return 'unknown';
    return SIMPLE_TEAM_LABEL.test(text) && !UUID_SHAPED.test(text) ? text.toLowerCase() : `tm_${sha(`canonical-team-key-v1:${matchKey}:${text}`).slice(0, 12)}`;
  };
  const ref = (value: unknown): string | undefined => (isRecord(value) ? asText(value.puuid) : undefined);
  const diagnostics: NormalizeDiagnostics = { killsInUnknownRounds: 0, invalidKills: 0, snapshotsDropped: { duplicate: 0, nonRoster: 0, invalid: 0 }, sideConflicts: 0, killOnlyParticipants: 0, economyOutOfDomain: 0 };
  /** Credits are never negative; an out-of-domain provider value is withheld (fail closed), never clamped. */
  const credits = (value: unknown): number | null | undefined => {
    const n = asNumber(value);
    if (n !== undefined && n < 0) { diagnostics.economyOutOfDomain += 1; return null; }
    return n;
  };

  const roundEvidence = recordsEvidence(payload, 'rounds');
  const killEvidence = recordsEvidence(payload, 'kills');
  const roundNumbers = new Set(roundEvidence.records.map((round, index) => asNumber(round.id) ?? index));
  for (const kill of killEvidence.records) {
    const invalid = !ref(kill.killer) || !ref(kill.victim) || asNumber(kill.time_in_round_in_ms) === undefined
      || recordsEvidence(kill, 'assistants').status !== 'observed' || asRecords(kill.assistants).some((a) => !asText(a.puuid));
    if (invalid) diagnostics.invalidKills += 1;
    else if (!roundNumbers.has(asNumber(kill.round) ?? -1)) diagnostics.killsInUnknownRounds += 1;
    if (invalid || !roundNumbers.has(asNumber(kill.round) ?? -1)) killEvidence.status = 'unavailable';
  }

  const participants: CanonicalParticipant[] = [];
  const known = new Set<string>();
  for (const player of asRecords(payload.players)) {
    const puuid = asText(player.puuid);
    if (!puuid || known.has(puuid)) continue;
    known.add(puuid);
    const stats = isRecord(player.stats) ? player.stats : undefined;
    const damage = isRecord(stats?.damage) ? stats.damage : undefined;
    const agent = isRecord(player.agent) ? player.agent : undefined;
    const ability = numericObjectEvidence(player, 'ability_casts', ['ability1', 'ability2', 'grenade', 'ultimate']);
    const economy = isRecord(player.economy) ? player.economy : undefined;
    const loadout = economy ? numericObjectEvidence(economy, 'loadout_value', ['overall', 'average']) : undefined;
    const spent = economy ? numericObjectEvidence(economy, 'spent', ['overall', 'average']) : undefined;
    const economyValues = [credits(loadout?.value?.overall), credits(loadout?.value?.average), credits(spent?.value?.overall), credits(spent?.value?.average)] as const;
    const economyStatus: EvidenceStatus = !('economy' in player) ? 'missing'
      : !economy || loadout?.status === 'unavailable' || spent?.status === 'unavailable' || economyValues.includes(null) ? 'unavailable'
        : loadout?.status === 'observed' && spent?.status === 'observed' ? 'observed' : 'missing';
    const identity = ctx.resolveIdentity(puuid);
    participants.push({
      participantKey: pkey(puuid), teamKey: teamKeyOf(player.team_id), memberId: identity?.memberId ?? null, accountId: identity?.accountId ?? null,
      agentId: asText(agent?.id) ?? null, agentName: asText(agent?.name) ?? null,
      stats: { status: stats ? 'observed' : 'missing', kills: nn(stats?.kills), deaths: nn(stats?.deaths), assists: nn(stats?.assists), score: nn(stats?.score),
        damageDealt: nn(damage?.dealt), damageReceived: nn(damage?.received), headshots: nn(stats?.headshots), bodyshots: nn(stats?.bodyshots), legshots: nn(stats?.legshots) },
      abilityCasts: { status: ability.status, ability1: nn(ability.value?.ability1), ability2: nn(ability.value?.ability2), grenade: nn(ability.value?.grenade), ultimate: nn(ability.value?.ultimate) },
      economy: { status: economyStatus, loadoutValueTotal: economyValues[0] ?? null, loadoutValueAverage: economyValues[1] ?? null, spentTotal: economyValues[2] ?? null,
        spentAverage: economyValues[3] ?? null },
    });
  }
  // Kill-referenced players outside the roster become stat-less participants (legacy rule); snapshots never create participants.
  for (const kill of killEvidence.records) {
    for (const value of [kill.killer, kill.victim, ...asRecords(kill.assistants)]) {
      if (!isRecord(value)) continue;
      const puuid = asText(value.puuid);
      if (!puuid || known.has(puuid)) continue;
      known.add(puuid);
      diagnostics.killOnlyParticipants += 1;
      const identity = ctx.resolveIdentity(puuid);
      participants.push({ participantKey: pkey(puuid), teamKey: teamKeyOf(value.team), memberId: identity?.memberId ?? null, accountId: identity?.accountId ?? null,
        agentId: null, agentName: null,
        stats: { status: 'missing', kills: null, deaths: null, assists: null, score: null, damageDealt: null, damageReceived: null, headshots: null, bodyshots: null, legshots: null },
        abilityCasts: { status: 'missing', ability1: null, ability2: null, grenade: null, ultimate: null },
        economy: { status: 'missing', loadoutValueTotal: null, loadoutValueAverage: null, spentTotal: null, spentAverage: null } });
    }
  }
  const rosterKeys = new Set(participants.map((p) => p.participantKey));
  const teamKeys = [...new Set(participants.map((p) => p.teamKey).filter((t) => t !== 'unknown'))];

  const events: CanonicalEvent[] = [];
  const rounds: CanonicalRound[] = roundEvidence.records.map((round, roundIndex) => {
    const number = asNumber(round.id) ?? roundIndex;
    const plant = isRecord(round.plant) ? round.plant : undefined;
    const defuse = isRecord(round.defuse) ? round.defuse : undefined;
    const participantEvidence = recordsEvidence(round, 'stats');
    const roundParticipants: CanonicalRoundParticipant[] = [];
    for (const item of participantEvidence.records) {
      const player = isRecord(item.player) ? item.player : item;
      const puuid = asText(player.puuid);
      if (!puuid) { participantEvidence.status = 'unavailable'; continue; }
      const stats = isRecord(item.stats) ? item.stats : undefined;
      const economy = isRecord(item.economy) ? item.economy : undefined;
      const loadout = credits(economy?.loadout_value); const remaining = credits(economy?.remaining);
      const weapon = asset(economy?.weapon); const armor = asset(economy?.armor);
      roundParticipants.push({ participantKey: pkey(puuid),
        stats: { status: stats ? 'observed' : 'missing', kills: nn(stats?.kills), score: nn(stats?.score) },
        economy: { status: loadout === null || remaining === null ? 'unavailable' : loadout !== undefined || remaining !== undefined ? 'observed' : 'missing',
          loadoutValue: loadout ?? null, remainingCredits: remaining ?? null },
        weapon, armor });
    }
    // Kills of this round, in source order; sequence = index within the round (legacy rule).
    const roundKills = killEvidence.records.filter((kill) => asNumber(kill.round) === number);
    let sequence = 0;
    for (const kill of roundKills) {
      const killer = ref(kill.killer); const victim = ref(kill.victim); const time = asNumber(kill.time_in_round_in_ms);
      if (!killer || !victim || time === undefined) { sequence += 1; continue; }
      const snapshots = new Map<string, { participantKey: string; location: { x: number; y: number }; viewRadians: number | null }>();
      for (const item of asRecords(kill.player_locations)) {
        const puuid = asText(isRecord(item.player) ? item.player.puuid : undefined);
        const location = point(item.location);
        if (!puuid || !location) { diagnostics.snapshotsDropped.invalid += 1; continue; }
        const key = pkey(puuid);
        if (snapshots.has(key)) { diagnostics.snapshotsDropped.duplicate += 1; continue; }
        if (!rosterKeys.has(key)) { diagnostics.snapshotsDropped.nonRoster += 1; continue; }
        snapshots.set(key, { participantKey: key, location, viewRadians: nn(item.view_radians) });
      }
      const weapon = asset(kill.weapon);
      events.push({
        eventKey: `r${number}e${sequence}`, roundNumber: number, sequence, timeInRoundMs: time, timeInMatchMs: nn(kill.time_in_match_in_ms), type: 'kill',
        actorParticipantKey: pkey(killer), targetParticipantKey: pkey(victim),
        assistantParticipantKeys: asRecords(kill.assistants).flatMap((a) => { const id = asText(a.puuid); return id ? [pkey(id)] : []; }),
        weapon: weapon.status === 'observed' ? { id: weapon.id, name: weapon.name } : null,
        location: point(kill.location),
        playerSnapshots: [...snapshots.values()],
      });
      sequence += 1;
    }
    const side = deriveRoundSide({ teamKeys, winningTeam: asText(round.winning_team) ? teamKeyOf(round.winning_team) : null, winningTeamRole: round.winning_team_role,
      planterTeam: isRecord(plant?.player) && asText(plant.player.team) ? teamKeyOf(plant.player.team) : null,
      defuserTeam: isRecord(defuse?.player) && asText(defuse.player.team) ? teamKeyOf(defuse.player.team) : null });
    if (side.conflict) diagnostics.sideConflicts += 1;
    const site = typeof plant?.site === 'string' && plant.site.trim() !== '' ? plant.site.trim() : null;
    return {
      roundNumber: number, winningTeamKey: asText(round.winning_team) ? teamKeyOf(round.winning_team) : null, result: asText(round.result) ?? null,
      winningTeamRole: side.winningTeamRole, attackingTeamKey: side.attackingTeamKey, sideSource: side.sideSource,
      plant: { status: objectStatus(round, 'plant'), participantKey: ref(plant?.player) ? pkey(ref(plant?.player)!) : null, timeInRoundMs: nn(plant?.round_time_in_ms), site,
        location: point(plant?.location) },
      defuse: { status: objectStatus(round, 'defuse'), participantKey: ref(defuse?.player) ? pkey(ref(defuse?.player)!) : null, timeInRoundMs: nn(defuse?.round_time_in_ms),
        location: point(defuse?.location) },
      participantsStatus: participantEvidence.status,
      participants: roundParticipants,
    };
  });

  const map = isRecord(metadata.map) ? metadata.map : undefined;
  const queue = isRecord(metadata.queue) ? metadata.queue : undefined;
  const season = isRecord(metadata.season) ? metadata.season : undefined;
  const seasonId = typeof season?.id === 'string' ? season.id.trim().toLowerCase() : undefined;
  const seasonShort = typeof season?.short === 'string' ? season.short.trim().toLowerCase() : undefined;
  const startedAtText = asText(metadata.started_at);
  if (!startedAtText || Number.isNaN(Date.parse(startedAtText))) throw new Error('payload has no valid metadata.started_at');
  const hasDamage = participants.some((p) => p.stats.damageDealt !== null);
  const hasPositions = events.some((e) => e.location !== null || e.playerSnapshots.length > 0) || rounds.some((r) => r.plant.location !== null || r.defuse.location !== null);
  const match = {
    schemaVersion: CANONICAL_SCHEMA_VERSION, matchKey,
    source: { providerId: HENRIK_PROVIDER_ID, providerVersion: HENRIK_PAYLOAD_VERSION, normalizerVersion: LEGACY_IMPORT_NORMALIZER_VERSION, providerRecordRef: matchId,
      observedAt: ctx.observedAt, acquisition: 'legacy-import' as const, acquisitionSource: ctx.acquisitionSource },
    evidence: { historyCompleteness: 'provider-visible' as const,
      evidenceQuality: roundEvidence.status === 'observed' && killEvidence.status === 'observed' && hasDamage ? 'complete' as const
        : roundEvidence.status === 'observed' || killEvidence.status === 'observed' ? 'partial' as const : 'basic' as const,
      rounds: roundEvidence.status, kills: killEvidence.status, hasDamage, hasPositions },
    mapId: asText(map?.id) ?? null, mapName: asText(map?.name) ?? null,
    mode: normalizeMode(asText(queue?.id), asText(queue?.name)),
    queue: { id: asText(queue?.id) ?? null, name: asText(queue?.name) ?? null },
    season: { key: seasonShort && /^[a-z0-9][a-z0-9:_-]{0,15}$/u.test(seasonShort) ? seasonShort : null,
      ref: seasonId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(seasonId) ? seasonId : null },
    startedAt: new Date(startedAtText).toISOString(),
    durationMs: nn(metadata.game_length_in_ms),
    teams: asRecords(payload.teams).map((team) => ({ teamKey: teamKeyOf(team.team_id), roundsWon: nn(isRecord(team.rounds) ? team.rounds.won : undefined),
      roundsLost: nn(isRecord(team.rounds) ? team.rounds.lost : undefined), won: typeof team.won === 'boolean' ? team.won : null })),
    participants, rounds, events,
  };
  const parsed = CanonicalMatch.safeParse(match);
  if (!parsed.success) throw new NormalizationError(parsed.error.issues);
  return { match: parsed.data, diagnostics };
}

/** Canonical validation failure. Carries only issue paths (array indices collapsed) and codes — never input values. */
export class NormalizationError extends Error {
  readonly issues: { path: string; code: string }[];
  constructor(issues: readonly { path: readonly PropertyKey[]; code: string }[]) {
    const summary = [...new Set(issues.map((i) => `${i.path.map((k) => (typeof k === 'number' ? '[]' : String(k))).join('.')}:${i.code}`))].slice(0, 10);
    super(`canonical validation failed: ${summary.join(', ')}`);
    this.name = 'NormalizationError';
    this.issues = summary.map((entry) => { const [path, code] = entry.split(':'); return { path: path!, code: code! }; });
  }
}
