import pg from 'pg';
import { config, hasDatabase } from './config.js';

/**
 * Postgres money arrives as BIGINT. node-postgres hands BIGINT back as a
 * string by default so that values above 2^53 survive the trip, and that is
 * the right default — but every amount in this app is kobo well inside the
 * safe integer range, and a string where a number is expected produces
 * "50000" + 1000 === "500001000". Parsed once, here, rather than at each
 * call site where one missed cast becomes a wrong balance.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`BIGINT ${value} exceeds safe integer range`);
  }
  return parsed;
});

// NUMERIC likewise: durations and check scores are small decimals.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!hasDatabase()) {
    throw new Error('DATABASE_URL is not set — point it at the Railway Postgres instance');
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      // Railway terminates TLS with its own chain; verification is off for the
      // managed instance the same way their own docs connect to it.
      ssl: config.databaseUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Runs `fn` inside a transaction, rolling back on any throw.
 *
 * Money moves in pairs — a hold against a refund, a payout against a fee — and
 * a half-applied pair is worse than a failed one.
 */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}
