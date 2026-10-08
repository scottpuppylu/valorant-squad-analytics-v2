import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, createPostgresClient, createSqlClient, PostgresCanonicalRepository } from '@vsa/canonical-data';
import { buildPrivateReport, privateOutputDir } from './privateReport.ts';
import { runDemoPipeline } from './pipeline.ts';

/**
 * Collector CLI (Node 24 runs this TypeScript directly).
 *   snapshot-demo --out <dir>   offline demo: fake provider → canonical store → analytics → snapshot → publish
 *   migrate                     apply canonical migrations to DATABASE_URL (local PostgreSQL 18)
 *   private-report --group <id> [--out <dir under .private/>]
 *                               PRIVATE operator report over DATABASE_URL (opened READ ONLY); never a public snapshot
 * Output is aggregate-only; the connection string is never printed.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const command = process.argv[2];
if (command === 'snapshot-demo') {
  const outDir = resolve(arg('--out') ?? 'apps/web/public/public-data');
  const summary = await runDemoPipeline({ outDir });
  process.stdout.write(`${JSON.stringify({ event: 'snapshot_demo', ...summary, outDir }, null, 2)}\n`);
} else if (command === 'migrate') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for `migrate` (local PostgreSQL 18; see infra/local).');
  const sql = createSqlClient({ databaseUrl: process.env.DATABASE_URL });
  try {
    process.stdout.write(`${JSON.stringify({ event: 'migrate', database: sql.kind, applied: await applyMigrations(sql) })}\n`);
  } finally {
    await sql.close();
  }
} else if (command === 'private-report') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for `private-report` (local PostgreSQL 18).');
  const groupId = arg('--group');
  if (!groupId) throw new Error('--group <groupId> is required');
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const outDir = privateOutputDir(repoRoot, arg('--out'));
  const sql = createPostgresClient(process.env.DATABASE_URL, { readOnly: true, applicationName: 'vsa-v2-private-report' });
  try {
    const result = await buildPrivateReport(new PostgresCanonicalRepository(sql), groupId, outDir);
    process.stdout.write(`${JSON.stringify({ event: 'private_report', ...result, outDir: result.findings.length ? null : 'written under .private/' })}\n`);
    if (result.findings.length) process.exitCode = 1;
  } finally {
    await sql.close();
  }
} else {
  process.stderr.write('usage: node apps/collector/src/cli.ts <snapshot-demo --out <dir> | migrate | private-report --group <id>>\n');
  process.exit(2);
}
