import { resolve } from 'node:path';
import { applyMigrations, createSqlClient } from '@vsa/canonical-data';
import { runDemoPipeline } from './pipeline.ts';

/**
 * Collector CLI (Node 24 runs this TypeScript directly).
 *   snapshot-demo --out <dir>   offline demo: fake provider → canonical store → analytics → snapshot → publish
 *   migrate                     apply canonical migrations to DATABASE_URL (local PostgreSQL 18)
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
} else {
  process.stderr.write('usage: node apps/collector/src/cli.ts <snapshot-demo --out <dir> | migrate>\n');
  process.exit(2);
}
