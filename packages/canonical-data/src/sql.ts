import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

/** The minimal SQL boundary. Everything above it is ordinary PostgreSQL; nothing above it knows the driver. */
export interface SqlResult<R> { rows: R[]; rowCount: number }
export interface SqlExecutor {
  query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlResult<R>>;
}
export interface SqlClient extends SqlExecutor {
  readonly kind: 'postgresql' | 'embedded-pglite';
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Real PostgreSQL (local PostgreSQL 18) via `pg`. The connection string is never logged. */
export function createPostgresClient(connectionString: string): SqlClient {
  const pool = new pg.Pool({ connectionString, max: 4 });
  return {
    kind: 'postgresql',
    async query(sql, params = []) {
      const result = await pool.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await work({
          async query(sql, params = []) {
            const result = await client.query(sql, params);
            return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
          },
        });
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Embedded PostgreSQL (PGlite, in-memory unless a data dir is given): tests and the zero-setup demo. */
export function createEmbeddedClient(dataDir?: string): SqlClient {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  const wrap = (executor: { query: PGlite['query'] }): SqlExecutor => ({
    async query(sql, params = []) {
      const result = await executor.query(sql, params);
      return { rows: result.rows as never[], rowCount: result.affectedRows ?? result.rows.length };
    },
  });
  return {
    kind: 'embedded-pglite',
    ...wrap(db),
    transaction: (work) => db.transaction((tx) => work(wrap(tx))),
    close: () => db.close(),
  };
}

/** DATABASE_URL → local PostgreSQL; otherwise embedded PGlite. No cloud database is ever required. */
export function createSqlClient(options: { databaseUrl?: string | undefined } = {}): SqlClient {
  return options.databaseUrl ? createPostgresClient(options.databaseUrl) : createEmbeddedClient();
}
