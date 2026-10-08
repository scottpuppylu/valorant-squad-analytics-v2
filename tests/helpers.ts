import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, createEmbeddedClient, PostgresCanonicalRepository, type SqlClient } from '@vsa/canonical-data';
import { buildProductAnalytics } from '@vsa/analytics';
import { DEMO_CONSENTS, DEMO_GROUP, DEMO_MEMBERS, DEMO_SOURCE_ACCOUNTS } from '@vsa/collector';
import type { ConsentState } from '@vsa/contracts/control';
import { PRODUCT_CONTRACT_VERSION, type ProductAnalytics } from '@vsa/contracts/product';
import { visibleMemberIds } from '@vsa/exporter';
import { FAKE_MATCHES, normalizeFakeMatch } from '@vsa/source-adapters/fake';

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

/** The synthetic demo matches normalized with the demo roster (deterministic). */
export const demoMatches = () => FAKE_MATCHES.map((p) => normalizeFakeMatch(p, demoResolver, OBSERVED_AT));

const productCache = new Map<string, ProductAnalytics>();
/** Product read models over the VISIBLE demo population for these consents (memoized; pure and deterministic). */
export function demoProduct(consents: readonly ConsentState[] = DEMO_CONSENTS): ProductAnalytics {
  const visible = visibleMemberIds(DEMO_MEMBERS, consents);
  const key = visible.join(',');
  if (!productCache.has(key)) productCache.set(key, buildProductAnalytics(visible, demoMatches(), [], { teamMaps: ['Ascent'] }));
  return productCache.get(key)!;
}

/** A product read model for an empty population (nothing public). */
export function emptyProduct(): ProductAnalytics {
  return {
    productContractVersion: PRODUCT_CONTRACT_VERSION,
    coverage: { firstMatchAt: null, lastMatchAt: null, matchesObserved: 0, competitiveMatches: 0 },
    profiles: [],
    sharedMatch: { version: 'shared-match-rating-v1', evidenceVersion: 'shared-match-evidence-v1', neutralSigma: 0.2, shrinkK: 8, minMatches: 5, members: [], pairs: [],
      coverage: { possiblePairs: 0, pairsWithShared: 0, pairUnits: 0, scoredUnits: 0, minShared: null, medianShared: null, maxShared: null } },
    teamBuilder: { v1Version: 'team-composition-v1', v2Version: 'team-composition-v2', fitVersion: 'team-fit-hierarchy-v1', maps: [], emittableAttack: [], emittableDefense: [], withheldLabels: [], results: [] },
  };
}
