import { BASIC_PLAYER_STATS_ALGORITHM, BASIC_PLAYER_STATS_DESCRIPTION, computeBasicPlayerStats, summarizeObservations } from '@vsa/analytics';
import { applyMigrations, createSqlClient, PostgresCanonicalRepository, type SqlClient } from '@vsa/canonical-data';
import { MANIFEST_VERSION } from '@vsa/contracts/versions';
import { LocalFilesystemPublisher } from '@vsa/distribution';
import { buildPublicSnapshot } from '@vsa/exporter';
import { FakeProviderAdapter } from '@vsa/source-adapters';
import { DEMO_CONSENTS, DEMO_GROUP, DEMO_MEMBERS, DEMO_SOURCE_ACCOUNTS } from './demoRoster.ts';
import { IngestService } from './ingest.ts';

export interface DemoPipelineOptions {
  outDir: string;
  /** Defaults to DATABASE_URL (local PostgreSQL) or an embedded PGlite database. */
  sql?: SqlClient;
  now?: () => string;
  activatedAt?: string;
}

export interface DemoPipelineSummary {
  database: SqlClient['kind'];
  migrationsApplied: string[];
  matchesStored: number;
  matchesConsidered: number;
  membersTotal: number;
  membersPublished: number;
  snapshotId: string;
  reusedExistingSnapshot: boolean;
}

/**
 * FakeProvider → canonical ingest (PostgreSQL semantics) → basic analytics → public exporter → LocalFilesystemPublisher.
 * No cloud, no provider network, no Vercel, no Neon. Prints/returns aggregates only (never a connection string).
 */
export async function runDemoPipeline(options: DemoPipelineOptions): Promise<DemoPipelineSummary> {
  const sql = options.sql ?? createSqlClient({ databaseUrl: process.env.DATABASE_URL });
  const ownsClient = options.sql === undefined;
  try {
    const migrationsApplied = await applyMigrations(sql);
    const repository = new PostgresCanonicalRepository(sql);
    await repository.upsertGroup(DEMO_GROUP);
    for (const member of DEMO_MEMBERS) await repository.upsertMember(member);
    for (const account of DEMO_SOURCE_ACCOUNTS) await repository.upsertSourceAccount(account);
    for (const consent of DEMO_CONSENTS) await repository.upsertConsent(consent);

    const ingest = await new IngestService(repository, new FakeProviderAdapter(), options.now).ingestGroup(DEMO_GROUP.groupId);

    const members = await repository.listMembers(DEMO_GROUP.groupId);
    const consents = await repository.listConsents(DEMO_GROUP.groupId);
    const memberIds = members.map((m) => m.memberId);
    const matches = await repository.listMatchesForMembers(memberIds);
    const analysis = computeBasicPlayerStats(matches, memberIds);
    const snapshot = buildPublicSnapshot({
      group: DEMO_GROUP, members, consents, analysis,
      algorithms: [{ algorithmId: BASIC_PLAYER_STATS_ALGORITHM, description: BASIC_PLAYER_STATS_DESCRIPTION }],
      observations: summarizeObservations(matches, memberIds),
      provenanceSummary: 'Synthetic demo data from the offline fake provider (provider-visible history; not a complete career).',
    });
    const publisher = new LocalFilesystemPublisher(options.outDir);
    const published = await publisher.publish(snapshot, options.activatedAt ? { activatedAt: options.activatedAt } : {});
    await repository.recordPublication({ snapshotId: published.snapshotId, snapshotVersion: snapshot.snapshotVersion, manifestVersion: MANIFEST_VERSION,
      publisher: publisher.publisherId, publishedAt: published.manifest.active.activatedAt });
    const groupDoc = JSON.parse(snapshot.files.find((f) => f.kind === 'group')!.content) as { members: unknown[] };
    return {
      database: sql.kind, migrationsApplied, matchesStored: ingest.matchesStored, matchesConsidered: analysis.matchesConsidered,
      membersTotal: members.length, membersPublished: groupDoc.members.length, snapshotId: published.snapshotId, reusedExistingSnapshot: published.reusedExistingSnapshot,
    };
  } finally {
    if (ownsClient) await sql.close();
  }
}
