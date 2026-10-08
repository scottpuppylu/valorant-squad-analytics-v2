import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlClient } from './sql.ts';

/**
 * Migration runner. Ported (REQUIRES_ADAPTATION) from legacy `server/db/migrations.ts` at release 1a4c790:
 * same file pattern, statement-breakpoint split, unique-version check and one transaction per migration;
 * adapted to the V2 SqlClient boundary. Idempotent: an applied version is never re-run.
 */
export interface Migration { version: string; name: string; statements: string[] }

const migrationPattern = /^(\d{4})_([a-z0-9_]+)\.sql$/u;
export const CANONICAL_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function loadMigrations(directory: string = CANONICAL_MIGRATIONS_DIR): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((name) => migrationPattern.test(name)).sort();
  const migrations = await Promise.all(names.map(async (name) => {
    const match = migrationPattern.exec(name);
    if (!match) throw new Error(`Invalid migration filename: ${name}`);
    const source = await readFile(join(directory, name), 'utf8');
    const statements = source.split(/^\s*-- statement-breakpoint\s*$/gmu).map((s) => s.trim()).filter(Boolean);
    return { version: match[1]!, name: basename(name), statements };
  }));
  if (new Set(migrations.map((m) => m.version)).size !== migrations.length) throw new Error('Migration versions must be unique.');
  return migrations;
}

export async function applyMigrations(client: SqlClient, migrations?: Migration[]): Promise<string[]> {
  const list = migrations ?? (await loadMigrations());
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const newlyApplied: string[] = [];
  for (const migration of list) {
    if (applied.has(migration.version)) continue;
    await client.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.query(statement);
      await tx.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [migration.version, migration.name]);
    });
    newlyApplied.push(migration.version);
  }
  return newlyApplied;
}
