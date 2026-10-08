import { applyMigrations, createPostgresClient, PostgresCanonicalRepository } from '@vsa/canonical-data';
import { canonicalDatasetFingerprint } from './fingerprint.ts';
import { NormalizationError } from './henrikV4.ts';
import { IMPORT_GROUP } from './identity.ts';
import { LegacyEvidenceImportAdapter } from './importer.ts';
import { SOURCE_SYSTEM } from './legacySchema.ts';
import { createSafeLogger } from './safeLog.ts';
import { RebuildStagingSource } from './source.ts';

/**
 * npm run import:legacy -- [--source legacy-rebuild-staging] [--source-url <url>] [--database-url <url>] [--dry-run] [--resume]
 *   source URL : --source-url or LEGACY_SOURCE_URL   (opened READ ONLY)
 *   target URL : --database-url or DATABASE_URL      (a fresh local PostgreSQL 18 database named valorant_analytics_v2*)
 * Connection strings are never printed. Output is aggregate-only.
 */
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const log = createSafeLogger();

const sourceSystem = value('--source') ?? SOURCE_SYSTEM;
if (sourceSystem !== SOURCE_SYSTEM) throw new Error(`unsupported --source (supported: ${SOURCE_SYSTEM})`);
const sourceUrl = value('--source-url') ?? process.env.LEGACY_SOURCE_URL;
const targetUrl = value('--database-url') ?? process.env.DATABASE_URL;
const dryRun = flag('--dry-run');
if (!sourceUrl) throw new Error('LEGACY_SOURCE_URL (or --source-url) is required');
if (!dryRun && !targetUrl) throw new Error('DATABASE_URL (or --database-url) is required unless --dry-run');

const endpoint = (url: string) => { const u = new URL(url); return { host: u.hostname, port: u.port || '5432', database: u.pathname.replace(/^\//u, '') }; };
const src = endpoint(sourceUrl);
if (!/^valorant_rebuild_staging[a-z0-9_]*$/u.test(src.database)) throw new Error('the legacy source must be the private rebuild staging database');
if (targetUrl) {
  const dst = endpoint(targetUrl);
  if (!/^valorant_analytics_v2[a-z0-9_]*$/u.test(dst.database)) throw new Error('the target must be a V2 database named valorant_analytics_v2*');
  if (dst.host === src.host && dst.port === src.port && dst.database === src.database) throw new Error('source and target must differ');
}

const sourceDb = createPostgresClient(sourceUrl, { readOnly: true, applicationName: 'vsa-v2-legacy-import' });
const targetDb = !dryRun && targetUrl ? createPostgresClient(targetUrl, { applicationName: 'vsa-v2-legacy-import' }) : null;
try {
  let repository: PostgresCanonicalRepository | null = null;
  if (targetDb) {
    log('target_migrations', { applied: await applyMigrations(targetDb) });
    repository = new PostgresCanonicalRepository(targetDb);
  }
  const report = await new LegacyEvidenceImportAdapter(new RebuildStagingSource(sourceDb), repository).run({ dryRun, resume: flag('--resume'), log });
  const fingerprint = repository ? await canonicalDatasetFingerprint(repository, IMPORT_GROUP.groupId) : null;
  log('import_report', { ...report, fingerprint: fingerprint?.fingerprint ?? null, canonicalMatches: fingerprint?.matches ?? null });
} catch (error) {
  // Only the error class and its (sanitized) message — never a stack, payload or connection detail.
  const issues = error instanceof NormalizationError ? error.issues.map((i) => `${i.path.replaceAll('[]', '_').toLowerCase()}:${i.code}`) : [];
  log('import_failed', { error: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : 'unknown', issues });
  process.exitCode = 1;
} finally {
  await sourceDb.close();
  if (targetDb) await targetDb.close();
}
