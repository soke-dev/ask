import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool } from './db.js';

/**
 * Applies every unapplied .sql file in migrations/, in filename order.
 *
 * Each file runs inside its own transaction together with the row that records
 * it, so a migration cannot be marked applied unless it actually applied.
 * Postgres supports transactional DDL, which is what makes that possible.
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function run(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename,
    ),
  );

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log(`Up to date — ${files.length} migration(s) already applied.`);
    return;
  }

  for (const file of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied  ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`FAILED   ${file}`);
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(`\nDone. ${pending.length} migration(s) applied.`);
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
