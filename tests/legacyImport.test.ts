import { describe, expect, it } from 'vitest';
import { BASIC_PLAYER_STATS_ALGORITHM, buildProductAnalytics, computeBasicPlayerStats, resolveAgent, summarizeObservations } from '@vsa/analytics';
import type { PostgresCanonicalRepository, SqlClient } from '@vsa/canonical-data';
import { ConsentState } from '@vsa/contracts/control';
import { buildPublicSnapshot } from '@vsa/exporter';
import {
  canonicalDatasetFingerprint, IMPORT_GROUP, LegacyAccountRow, LegacyEvidenceImportAdapter, normalizeHenrikV4Match, planIdentities, RebuildStagingSource,
  NormalizationError, sanitize, sanitizeKey, sanitizeString, SourceConflictError, v2AccountId, v2MemberId,
} from '@vsa/legacy-importer';
import { freshDatabase, withTempDir } from './helpers.ts';
import { createLegacyStaging, FIXTURE_ACCOUNTS, JETT, MIKS, mid, payload, pu, UNKNOWN_AGENT } from './legacyFixture.ts';

const quiet = () => {};
async function importInto(target: PostgresCanonicalRepository | null, staging?: { sql: SqlClient }, options: Parameters<LegacyEvidenceImportAdapter['run']>[0] = {}) {
  const source = staging ?? (await createLegacyStaging());
  const report = await new LegacyEvidenceImportAdapter(new RebuildStagingSource(source.sql), target).run({ log: quiet, now: () => '2026-10-08T01:00:00.000Z', ...options });
  return { report, source };
}
const resolve = (ref: string) => (ref === pu(1) ? { memberId: 'member-alpha', accountId: 'account-alpha' } : null);

describe('legacy source boundary', () => {
  it('refuses a source session that is not read-only, and the real source rejects writes', async () => {
    const { sql } = await createLegacyStaging();
    await expect(sql.query('CREATE TABLE rebuild_staging.probe (x int)')).rejects.toThrow(/read-only/u);
    await sql.query('SET default_transaction_read_only = off');
    await expect(new RebuildStagingSource(sql).verifyReadOnly()).rejects.toThrow(/not read-only/u);
    await sql.close();
  });

  it('parses legacy rows strictly (malformed rows fail closed) and checks source versions', async () => {
    expect(() => LegacyAccountRow.parse({ account_public_id: 'not-a-uuid', member_public_id: 'x', community_name: 'A', is_primary: true, provider_puuid: null })).toThrow();
    const { sql } = await createLegacyStaging();
    expect(await new RebuildStagingSource(sql).versions()).toEqual({ rebuild_staging: 'rebuild-staging-v1', rank_staging: 'rank-staging-v1' });
    await sql.close();
  });
});

describe('identity, multi-account and consent', () => {
  const rows = FIXTURE_ACCOUNTS.map((a) => LegacyAccountRow.parse({ account_public_id: `10000000-0000-4000-8000-${String(a.account).padStart(12, '0')}`,
    member_public_id: `10000000-0000-4000-8000-${String(100 + a.member).padStart(12, '0')}`, community_name: a.name, is_primary: a.primary, provider_puuid: a.puuid ? pu(a.puuid) : null }));

  it('derives V2 ids independent of provider ids and legacy keys; keeps multi-account linkage explicit', () => {
    const plan = planIdentities(rows);
    expect(plan.members.map((m) => m.displayName)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    const alpha = plan.members.find((m) => m.displayName === 'Alpha')!;
    expect(alpha.memberId).toBe(v2MemberId(rows[0]!.member_public_id));
    expect(alpha.memberId).not.toContain(rows[0]!.member_public_id);
    const alphaAccounts = plan.accounts.filter((a) => a.memberId === alpha.memberId);
    expect(alphaAccounts.map((a) => a.isPrimary).sort()).toEqual([false, true]);
    expect(alphaAccounts.map((a) => a.accountId)).toContain(v2AccountId(rows[1]!.account_public_id));
    for (const a of plan.accounts) expect(a.accountId).not.toContain(a.providerAccountRef.slice(0, 20));
  });

  it('flags identity collisions instead of guessing (two primaries; one provider id on two accounts)', () => {
    expect(planIdentities([rows[0]!, { ...rows[1]!, is_primary: true }]).collisions).toContain('member has more than one primary account');
    expect(planIdentities([rows[0]!, { ...rows[2]!, provider_puuid: rows[0]!.provider_puuid }]).collisions).toContain('one provider identity is linked to more than one account');
  });

  it('never infers consent: every imported member requires reconciliation and grants nothing', async () => {
    const { sql, repository } = await freshDatabase();
    const { report } = await importInto(repository);
    expect(report.consentInferredFromEvidence).toBe(false);
    const consents = await repository.listConsents(IMPORT_GROUP.groupId);
    expect(consents).toHaveLength(3);
    for (const c of consents) expect(c).toMatchObject({ status: 'requires-reconciliation', identityConnected: false, dataCollectionAllowed: false,
      groupVisibilityAllowed: false, publicDerivedAnalyticsAllowed: false });
    expect(() => ConsentState.parse({ ...consents[0]!, publicDerivedAnalyticsAllowed: true })).toThrow();
    await sql.close();
  });

  it('does not downgrade an explicit V2 consent on re-import', async () => {
    const { sql, repository } = await freshDatabase();
    await importInto(repository);
    const [first] = await repository.listConsents(IMPORT_GROUP.groupId);
    await repository.upsertConsent({ ...first!, status: 'explicit', source: 'control-plane', identityConnected: true, dataCollectionAllowed: true, policyVersion: 'p1' });
    await importInto(repository);
    expect((await repository.listConsents(IMPORT_GROUP.groupId)).find((c) => c.memberId === first!.memberId)).toMatchObject({ status: 'explicit', dataCollectionAllowed: true });
    await sql.close();
  });

  it('links matches of BOTH accounts of a multi-account member to the one member (no flattening errors)', async () => {
    const { sql, repository } = await freshDatabase();
    await importInto(repository);
    const alpha = (await repository.listMembers(IMPORT_GROUP.groupId)).find((m) => m.displayName === 'Alpha')!;
    const [m1] = await repository.listMatchesForMembers([alpha.memberId]);
    const mine = m1!.participants.filter((p) => p.memberId === alpha.memberId);
    expect(mine).toHaveLength(2); // both of Alpha's accounts played this match
    expect(new Set(mine.map((p) => p.accountId)).size).toBe(2);
    const stats = computeBasicPlayerStats([m1!], [alpha.memberId]).players[0]!;
    expect(stats.metrics.matchesPlayed).toBe(0); // a member twice in one match is withheld, never summed
    await sql.close();
  });
});

describe('match / round / event / position normalization', () => {
  const { match, diagnostics } = normalizeHenrikV4Match(payload(1), { resolveIdentity: resolve, observedAt: '2026-10-07T12:00:00.000Z', acquisitionSource: 'test' });

  it('keeps provenance, completeness and every mode; never carries provider ids', () => {
    expect(match.source).toMatchObject({ providerId: 'henrik', providerVersion: 'henrik-v4', normalizerVersion: 'legacy-henrik-v4-import-v1', acquisition: 'legacy-import' });
    expect(match.evidence).toMatchObject({ historyCompleteness: 'provider-visible', rounds: 'observed', kills: 'observed', hasDamage: true, hasPositions: true });
    expect(match.startedAt).toMatch(/\.500Z$/u);
    const text = JSON.stringify({ ...match, source: { ...match.source, providerRecordRef: '' }, season: { ...match.season, ref: null } });
    expect(text).not.toContain('legacy-fixture-puuid');
    expect(text).not.toContain(mid(1));
    for (const [queue, mode] of [[['swiftplay', 'Swiftplay'], 'swiftplay'], [['deathmatch', 'Deathmatch'], 'deathmatch'], [['', 'Custom Game'], 'custom'], [['newmap', 'Summit'], 'other'], [['hurm', 'Team Deathmatch'], 'team-deathmatch']] as const) {
      const m = normalizeHenrikV4Match(payload(2, { queue: [...queue] as [string, string] }), { resolveIdentity: resolve, observedAt: '2026-10-07T12:00:00.000Z', acquisitionSource: 't' }).match;
      expect(m.mode).toBe(mode);
      expect(m.queue.name).toBe(queue[1]);
    }
  });

  it('derives deathmatch team keys (player ids are never team keys)', () => {
    const dm = normalizeHenrikV4Match(payload(4, { queue: ['deathmatch', 'Deathmatch'], teams: 'ffa' }), { resolveIdentity: resolve, observedAt: '2026-10-07T12:00:00.000Z', acquisitionSource: 't' }).match;
    expect(dm.teams.every((t) => /^tm_[0-9a-f]{12}$/u.test(t.teamKey))).toBe(true);
    expect(JSON.stringify(dm.teams)).not.toContain('legacy-fixture-puuid');
    expect(dm.rounds.every((r) => r.attackingTeamKey === null && r.winningTeamRole === null)).toBe(true); // FreeForAll is not side evidence
  });

  it('participants: roster with full stats, kill-only participants without stats', () => {
    expect(match.participants).toHaveLength(7);
    expect(diagnostics.killOnlyParticipants).toBe(1);
    const killOnly = match.participants.find((p) => p.stats.status === 'missing')!;
    expect(killOnly.stats.kills).toBeNull();
    const roster = match.participants.find((p) => p.memberId === 'member-alpha')!;
    expect(roster.stats).toMatchObject({ status: 'observed', kills: 5, damageDealt: 1500, damageReceived: 1400, headshots: 3 });
    expect(roster.economy).toMatchObject({ status: 'observed', loadoutValueAverage: 3900.5 });
  });

  it('rounds: explicit side (role / plant / defuse), provider plant site, objective actors and round participants', () => {
    const [r0, r1, r2] = match.rounds;
    expect(r0).toMatchObject({ roundNumber: 0, winningTeamKey: 'blue', winningTeamRole: 'attacker', attackingTeamKey: 'blue', sideSource: 'winning_team_role' });
    expect(r1!.plant).toMatchObject({ status: 'present', site: 'B', timeInRoundMs: 40000, location: { x: 1111.5, y: -2222.25 } });
    expect(r1).toMatchObject({ attackingTeamKey: 'red', winningTeamRole: 'defender', result: 'Defuse' });
    expect(r1!.defuse.status).toBe('present');
    expect(r2!.plant.status).toBe('absent');
    expect(r0!.participants).toHaveLength(3);
    expect(r0!.participants[0]).toMatchObject({ economy: { status: 'observed', loadoutValue: 3900, remainingCredits: 800 }, weapon: { status: 'observed', name: 'Vandal' } });
  });

  it('events: order, sequence within round, assists, weapon and location preserved', () => {
    expect(match.events.map((e) => [e.roundNumber, e.sequence])).toEqual([[0, 0], [0, 1], [1, 0], [2, 0], [2, 1]]);
    expect(match.events[0]).toMatchObject({ timeInRoundMs: 10000, timeInMatchMs: 10000, weapon: { name: 'Vandal' }, location: { x: 5000.375 } });
    expect(match.events.every((e) => e.assistantParticipantKeys.length === 1)).toBe(true);
  });

  it('positions: first snapshot per player wins; non-roster and invalid snapshots are dropped', () => {
    expect(match.events[0]!.playerSnapshots.map((s) => s.location)).toEqual([{ x: 4000.375, y: 4100.625 }, { x: 4200.375, y: 4300.625 }]);
    // 5 kills × 1 duplicate killer row, plus one kill whose victim also appears twice → 6 duplicates.
    expect(diagnostics.snapshotsDropped).toEqual({ duplicate: 6, nonRoster: 5, invalid: 5 });
  });

  it('a kill in a round absent from the payload marks kill evidence unavailable (accepted rule) and is reported', () => {
    const r = normalizeHenrikV4Match(payload(6, { unknownRoundKill: true }), { resolveIdentity: resolve, observedAt: '2026-10-07T12:00:00.000Z', acquisitionSource: 't' });
    expect(r.match.evidence.kills).toBe('unavailable');
    expect(r.diagnostics.killsInUnknownRounds).toBe(1);
    expect(r.match.events).toHaveLength(5);
  });

  it('agent identity is kept as given; unknown ids stay UNKNOWN and Miks is a Controller', () => {
    const ids = match.participants.map((p) => p.agentId);
    expect(ids).toContain(UNKNOWN_AGENT);
    expect(resolveAgent({ id: UNKNOWN_AGENT, name: 'Unknown' }).status).toBe('unknown');
    expect(resolveAgent({ id: UNKNOWN_AGENT, name: 'Jett' })).toMatchObject({ status: 'unknown', reason: 'unknown_id' }); // never guessed from the name
    const miks = resolveAgent({ id: MIKS, name: 'Miks' });
    expect(miks.status === 'known' && miks.definition.role).toBe('Controller');
    expect(resolveAgent({ id: JETT }).status).toBe('known');
  });
});

describe('import runs', () => {
  it('imports every source match atomically with checkpoints and reconciles counts', async () => {
    const { sql, repository } = await freshDatabase();
    const { report } = await importInto(repository);
    expect(report.matches).toMatchObject({ sourceRows: 6, processed: 6, inserted: 6, rewritten: 0, conflicts: 0 });
    expect(report.diagnostics.killsInUnknownRounds).toBe(1);
    expect((await repository.listMatchKeys())).toHaveLength(6);
    const count = async (t: string) => Number((await sql.query<{ n: string }>(`SELECT count(*)::text n FROM ${t}`)).rows[0]!.n);
    expect(await count('import_state')).toBe(6);
    const expectedSnapshots = (await createLegacyStaging()).payloads.reduce((total, p) => total + normalizeHenrikV4Match(p,
      { resolveIdentity: () => null, observedAt: '2026-10-07T12:00:00.000Z', acquisitionSource: 't' }).match.events.reduce((n, e) => n + e.playerSnapshots.length, 0), 0);
    expect(await count('event_player_snapshots')).toBe(expectedSnapshots);
    expect(report.rank).toEqual({ sourceRows: 6, imported: 6, unresolvedAccount: 0, matchRefUnresolved: 1 });
    await sql.close();
  });

  it('is idempotent: a second full run creates nothing new and the fingerprint is identical', async () => {
    const { sql, repository } = await freshDatabase();
    const staging = await createLegacyStaging();
    await importInto(repository, staging);
    const first = await canonicalDatasetFingerprint(repository, IMPORT_GROUP.groupId);
    const { report } = await importInto(repository, staging);
    expect(report.matches).toMatchObject({ inserted: 0, rewritten: 6 });
    expect(await canonicalDatasetFingerprint(repository, IMPORT_GROUP.groupId)).toEqual(first);
    expect(first.fingerprint).toMatch(/^cdfp-v1:[0-9a-f]{64}$/u);
    await sql.close();
  });

  it('the fingerprint is group-scoped: data of another group in the same store never changes it', async () => {
    const alone = await freshDatabase();
    await importInto(alone.repository);
    const shared = await freshDatabase();
    const { runDemoPipeline } = await import('@vsa/collector');
    await withTempDir((dir) => runDemoPipeline({ outDir: dir, sql: shared.sql, now: () => '2026-10-01T12:00:00.000Z', activatedAt: '2026-10-01T12:30:00.000Z' }));
    await importInto(shared.repository);
    expect(await canonicalDatasetFingerprint(shared.repository, IMPORT_GROUP.groupId)).toEqual(await canonicalDatasetFingerprint(alone.repository, IMPORT_GROUP.groupId));
    await alone.sql.close(); await shared.sql.close();
  });

  it('restarts after a crash and resumes to exactly the same dataset as a clean import', async () => {
    const clean = await freshDatabase();
    await importInto(clean.repository);
    const expected = await canonicalDatasetFingerprint(clean.repository, IMPORT_GROUP.groupId);
    const crashed = await freshDatabase();
    const staging = await createLegacyStaging();
    await importInto(crashed.repository, staging, { maxMatches: 2, pageSize: 1 }); // simulated crash after 2 committed matches
    expect(await crashed.repository.listMatchKeys()).toHaveLength(2);
    const { report } = await importInto(crashed.repository, staging, { resume: true });
    expect(report.matches).toMatchObject({ resumedSkips: 2, inserted: 4 });
    expect(await canonicalDatasetFingerprint(crashed.repository, IMPORT_GROUP.groupId)).toEqual(expected);
    await clean.sql.close(); await crashed.sql.close();
  });

  it('a changed source record is a conflict: nothing is silently overwritten', async () => {
    const { sql, repository } = await freshDatabase();
    await importInto(repository);
    const before = await canonicalDatasetFingerprint(repository, IMPORT_GROUP.groupId);
    const changed = await createLegacyStaging({ matches: [{ ...payload(1), players: (payload(1).players as unknown[]).slice(0, 5) }] });
    await expect(importInto(repository, changed)).rejects.toThrow(SourceConflictError);
    expect(await canonicalDatasetFingerprint(repository, IMPORT_GROUP.groupId)).toEqual(before);
    await sql.close();
  });

  it('a payload whose own match id disagrees with its source key is refused', async () => {
    const bad = payload(7); (bad.metadata as Record<string, unknown>).match_id = mid(8);
    const staging = await createLegacyStaging({ matches: [bad] });
    await staging.sql.query('SET default_transaction_read_only = off');
    await staging.sql.query(`UPDATE rebuild_staging.match_payloads SET provider_match_id=$1`, [mid(7)]);
    await staging.sql.query('SET default_transaction_read_only = on');
    const { sql, repository } = await freshDatabase();
    await expect(importInto(repository, staging)).rejects.toThrow(SourceConflictError);
    await sql.close();
  });

  it('dry-run validates and plans without a target and writes nothing', async () => {
    const { report } = await importInto(null, undefined, { dryRun: true });
    expect(report).toMatchObject({ dryRun: true, matches: { processed: 6, inserted: 0 }, identity: { members: 3, accounts: 4, multiAccountMembers: 1 } });
  });

  it('logs are aggregate-only: no provider ids, match ids, connection strings or coordinates', async () => {
    const lines: string[] = [];
    const { createSafeLogger } = await import('@vsa/legacy-importer');
    const { sql, repository } = await freshDatabase();
    await importInto(repository, undefined, { log: createSafeLogger((l) => lines.push(l)) });
    const text = lines.join('\n');
    for (const forbidden of ['legacy-fixture-puuid', mid(1), '5000.375', '4000.375', 'postgres']) expect(text).not.toContain(forbidden);
    expect(text).toContain('Alpha');
    expect(sanitizeString('postgres://u:p@h/db')).toBe('[redacted]');
    expect(sanitizeString(pu(1))).toBe('[redacted]');
    expect(sanitizeString(mid(1))).toBe('[redacted]');
    expect(sanitizeString('Name#TAG')).toBe('[redacted]');
    expect(sanitizeString('測試員')).toBe('測試員'); // synthetic CJK community name
    // field names are identifiers: kept when code-like, redacted when they look like data
    expect(sanitizeKey('snapshotsDroppedDuplicate')).toBe('snapshotsDroppedDuplicate');
    expect(sanitizeKey(pu(1))).toBe('[redacted]');
    expect(sanitizeKey(mid(1))).toBe('[redacted]');
    expect(sanitize({ consentInferredFromEvidence: false, [mid(2)]: 1 })).toEqual({ consentInferredFromEvidence: false, '[redacted]': 1 });
    await sql.close();
  });
});

describe('out-of-domain provider values', () => {
  it('negative credits are withheld as null (economy unavailable), counted, never clamped', () => {
    const p = payload(1, { queue: ['', 'Custom Game'] }) as { players: Record<string, unknown>[] };
    p.players[0]!.economy = { loadout_value: { overall: 50000, average: 3900.5 }, spent: { overall: -1081738, average: -20000.5 } };
    const { match, diagnostics } = normalizeHenrikV4Match(p, { resolveIdentity: () => null, observedAt: '2026-10-07T12:00:00.000Z', acquisitionSource: 't' });
    expect(diagnostics.economyOutOfDomain).toBe(2);
    const economy = match.participants[0]!.economy;
    expect(economy).toMatchObject({ status: 'unavailable', loadoutValueTotal: 50000, spentTotal: null, spentAverage: null });
  });

  it('canonical validation failures carry paths and codes only, never input values', () => {
    const p = payload(1) as { metadata: Record<string, unknown> };
    p.metadata.started_at = 'not-a-date';
    let error: unknown;
    try { normalizeHenrikV4Match(p, { resolveIdentity: () => null, observedAt: '2026-10-07T12:00:00.000Z', acquisitionSource: 't' }); } catch (e) { error = e; }
    expect(error).toBeDefined();
    const text = JSON.stringify({ message: (error as Error).message, issues: error instanceof NormalizationError ? error.issues : null });
    for (const forbidden of ['legacy-fixture-puuid', mid(1), '5000.375', 'not-a-date']) expect(text).not.toContain(forbidden);
  });
});

describe('rank evidence and time safety', () => {
  it('rank context at a match never uses future rows, its own outcome row, or current / peak values', async () => {
    const { sql, repository } = await freshDatabase();
    await importInto(repository);
    const members = await repository.listMembers(IMPORT_GROUP.groupId);
    const alpha = members.find((m) => m.displayName === 'Alpha')!; const bravo = members.find((m) => m.displayName === 'Bravo')!;
    const keys = await repository.listMatchKeys();
    const [first] = await repository.getMatches([keys[0]!]);
    // Alpha: the match's own pre-match snapshot.
    expect((await repository.rankContextForMatch(alpha.memberId, first!.matchKey, first!.startedAt))?.kind).toBe('match-snapshot');
    // Bravo: its own history row (effective 1 s before start, carrying that match's outcome) is excluded → the older prior row.
    const ctx = await repository.rankContextForMatch(bravo.memberId, first!.matchKey, first!.startedAt);
    expect(ctx).toMatchObject({ kind: 'history', providerTierId: 12, providerElo: 1210 });
    // Every resolved row is strictly earlier than the match unless it is that match's own snapshot.
    let leaks = 0;
    for (const m of await repository.getMatches(keys)) for (const member of members) {
      const c = await repository.rankContextForMatch(member.memberId, m.matchKey, m.startedAt);
      if (c && !(c.kind === 'match-snapshot' && c.matchKey === m.matchKey) && !(c.effectiveAt < m.startedAt && c.matchKey !== m.matchKey)) leaks += 1;
      if (c && (c.kind === 'current' || c.kind === 'peak' || c.kind === 'seasonal')) leaks += 1;
    }
    expect(leaks).toBe(0);
    await sql.close();
  });
});

describe('position privacy and public safety of imported data', () => {
  it('erases one member’s precise positions without destroying shared match evidence', async () => {
    const { sql, repository } = await freshDatabase();
    await importInto(repository);
    const charlie = (await repository.listMembers(IMPORT_GROUP.groupId)).find((m) => m.displayName === 'Charlie')!;
    const alpha = (await repository.listMembers(IMPORT_GROUP.groupId)).find((m) => m.displayName === 'Alpha')!;
    const before = await repository.listMatchesForMembers([charlie.memberId]);
    const summary = await repository.erasePositionTelemetryForMember(alpha.memberId);
    expect(summary.snapshotsDeleted).toBeGreaterThan(0);
    expect(summary.defuseLocationsCleared).toBe(6);
    const after = await repository.listMatchesForMembers([charlie.memberId]);
    expect(after.length).toBe(before.length);
    const alphaKeys = new Set(after.flatMap((m) => m.participants.filter((p) => p.memberId === alpha.memberId).map((p) => `${m.matchKey}|${p.participantKey}`)));
    for (const m of after) {
      for (const e of m.events) {
        expect(e.playerSnapshots.some((s) => alphaKeys.has(`${m.matchKey}|${s.participantKey}`))).toBe(false);
        if (alphaKeys.has(`${m.matchKey}|${e.actorParticipantKey}`) || alphaKeys.has(`${m.matchKey}|${e.targetParticipantKey}`)) expect(e.location).toBeNull();
      }
      expect(m.events.length).toBe(before.find((b) => b.matchKey === m.matchKey)!.events.length);
      expect(m.rounds.find((r) => r.roundNumber === 1)!.plant.location).not.toBeNull(); // the planter is not Alpha: kept
    }
    const charlieSnapshots = after.flatMap((m) => m.events.flatMap((e) => e.playerSnapshots)).length;
    expect(charlieSnapshots).toBeGreaterThan(0);
    await sql.close();
  });

  it('a snapshot exported from imported data withholds every member without explicit public consent', async () => {
    const { sql, repository } = await freshDatabase();
    await importInto(repository);
    const members = await repository.listMembers(IMPORT_GROUP.groupId);
    const ids = members.map((m) => m.memberId);
    const matches = await repository.listMatchesForMembers(ids);
    const snapshot = buildPublicSnapshot({ group: IMPORT_GROUP, members, consents: await repository.listConsents(IMPORT_GROUP.groupId), analysis: computeBasicPlayerStats(matches, ids),
      algorithms: [{ algorithmId: BASIC_PLAYER_STATS_ALGORITHM, description: 'basic' }], observations: summarizeObservations(matches, ids), provenanceSummary: 'private test',
      product: buildProductAnalytics([], matches) });
    const text = snapshot.files.map((f) => f.content).join('\n');
    expect(JSON.parse(snapshot.files.find((f) => f.kind === 'group')!.content).members).toEqual([]);
    for (const forbidden of ['Alpha', 'legacy-fixture-puuid', mid(1), 'member-', 'account-', '5000.375']) expect(text).not.toContain(forbidden);
    await sql.close();
  });
});
