import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, createEmbeddedClient, PostgresCanonicalRepository, type SqlClient } from '@vsa/canonical-data';
import { DEMO_CONSENTS, DEMO_GROUP, DEMO_MEMBERS, DEMO_SOURCE_ACCOUNTS } from '@vsa/collector';

/** Deterministic test clock values (never wall clock). */
export const OBSERVED_AT = '2026-10-01T12:00:00.000Z';
export const ACTIVATED_AT = '2026-10-01T12:30:00.000Z';

export async function freshDatabase(): Promise<{ sql: SqlClient; repository: PostgresCanonicalRepository }> {
  const sql = createEmbeddedClient();
  await applyMigrations(sql);
  return { sql, repository: new PostgresCanonicalRepository(sql) };
}

export async function seedDemoRoster(repository: PostgresCanonicalRepository, consents = DEMO_CONSENTS): Promise<void> {
  await repository.upsertGroup(DEMO_GROUP);
  for (const m of DEMO_MEMBERS) await repository.upsertMember(m);
  for (const a of DEMO_SOURCE_ACCOUNTS) await repository.upsertSourceAccount(a);
  for (const c of consents) await repository.upsertConsent(c);
}

export async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'vsa-v2-'));
  try { return await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Identity resolver over the demo roster (fake provider refs → internal ids). */
export const demoResolver = (ref: string) => {
  const account = DEMO_SOURCE_ACCOUNTS.find((a) => a.providerAccountRef === ref);
  return account ? { memberId: account.memberId, accountId: account.accountId } : null;
};
