import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresCanonicalRepository, SqlClient } from '@vsa/canonical-data';
import { DEMO_CONSENTS, IngestService } from '@vsa/collector';
import { FakeProviderAdapter } from '@vsa/source-adapters';
import { FAKE_MATCHES, normalizeFakeMatch } from '@vsa/source-adapters/fake';
import { demoResolver, freshDatabase, OBSERVED_AT, seedDemoRoster } from './helpers.ts';

describe('PostgresCanonicalRepository (embedded PostgreSQL)', () => {
  let sql: SqlClient;
  let repository: PostgresCanonicalRepository;
  beforeEach(async () => { ({ sql, repository } = await freshDatabase()); await seedDemoRoster(repository); });
  afterEach(async () => { await sql.close(); });

  const count = async (table: string) => Number((await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]!.n);

  it('round-trips a canonical match exactly (including private spatial evidence)', async () => {
    const match = normalizeFakeMatch(FAKE_MATCHES[0]!, demoResolver, OBSERVED_AT);
    await repository.saveMatch(match);
    const [back] = await repository.listMatchesForMembers(['member-nova']);
    expect(back).toEqual(match);
  });

  it('saveMatch is idempotent (re-saving replaces, never duplicates)', async () => {
    const match = normalizeFakeMatch(FAKE_MATCHES[1]!, demoResolver, OBSERVED_AT);
    await repository.saveMatch(match);
    const before = await Promise.all(['matches', 'match_participants', 'rounds', 'events', 'match_teams'].map(count));
    await repository.saveMatch(match);
    expect(await Promise.all(['matches', 'match_participants', 'rounds', 'events', 'match_teams'].map(count))).toEqual(before);
    expect(await repository.hasMatch('fake', FAKE_MATCHES[1]!.fakeMatchId)).toBe(true);
    expect(await repository.hasMatch('fake', 'fake-match-ref-9999')).toBe(false);
  });

  it('rejects non-canonical input before touching the database', async () => {
    const match = normalizeFakeMatch(FAKE_MATCHES[2]!, demoResolver, OBSERVED_AT);
    await expect(repository.saveMatch({ ...match, matchKey: 'not-canonical' })).rejects.toThrow();
    expect(await count('matches')).toBe(0);
  });

  it('round-trips control metadata (group, members, consent)', async () => {
    expect((await repository.getGroup('group-demo'))?.name).toBe('Demo Squad');
    expect((await repository.listMembers('group-demo')).map((m) => m.displayName).sort()).toEqual(['Juno', 'Kite', 'Nova', 'Pike', 'Rook', 'Vex']);
    expect(await repository.listConsents('group-demo')).toEqual([...DEMO_CONSENTS].sort((a, b) => a.memberId.localeCompare(b.memberId)));
  });

  it('ingest stores every fake match once, records ingest state and links only consenting members', async () => {
    const noCollection = DEMO_CONSENTS.map((c) => (c.memberId === 'member-kite' ? { ...c, dataCollectionAllowed: false } : c));
    for (const c of noCollection) await repository.upsertConsent(c);
    const summary = await new IngestService(repository, new FakeProviderAdapter(), () => OBSERVED_AT).ingestGroup('group-demo');
    expect(summary).toMatchObject({ accountsConsidered: 6, accountsSkippedNoConsent: 1, matchesStored: 10 });
    expect(await count('provider_ingest_state')).toBe(5);
    const linked = (await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM match_participants WHERE member_id='member-kite'`)).rows[0]!.n;
    expect(Number(linked)).toBe(0);
    const again = await new IngestService(repository, new FakeProviderAdapter(), () => OBSERVED_AT).ingestGroup('group-demo');
    expect(again.matchesStored).toBe(0);
    expect(await count('matches')).toBe(10);
  });
});
