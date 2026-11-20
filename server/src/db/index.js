// One small database interface, two engines behind it:
//   * Production: real PostgreSQL through `pg`, using DATABASE_URL (e.g. Supabase on Vercel).
//   * Local dev and tests: PGlite, real Postgres compiled to WebAssembly. No install needed.
//
// The rest of the app only uses db.query(), db.exec() and db.transaction(), so it never
// knows which one it's talking to.
//
// Both are set up to return the same JavaScript types:
//   BIGINT (ids, counts) -> number      (safe: ids won't pass 2^53)
//   NUMERIC (money)      -> number      (exact in the database; math is rounded to cents in the engines)
//   DATE                 -> "YYYY-MM-DD" string. By default `pg` turns a DATE into a JavaScript Date at
//                           LOCAL midnight, which shifts it by a day in some time zones.

import pg from 'pg';

const INT8 = 20;
const NUMERIC = 1700;
const DATE = 1082;

const toNumber = (value) => (value === null ? null : Number(value));
const keepString = (value) => value;

/**
 * @typedef {Object} Db
 * @property {(text: string, params?: unknown[]) => Promise<{ rows: any[] }>} query
 * @property {(sql: string) => Promise<void>} exec   run several statements (migrations)
 * @property {<T>(fn: (tx: Db) => Promise<T>) => Promise<T>} transaction
 * @property {() => Promise<void>} close
 */

/**
 * @param {{ databaseUrl?: string, databaseCaCert?: string, pgliteDataDir?: string }} options
 *   databaseUrl set   -> PostgreSQL through `pg`
 *   otherwise         -> PGlite, saved in pgliteDataDir (or in memory if not set)
 * @returns {Db}
 */
export function createDb({ databaseUrl, databaseCaCert, databaseSslMode, databasePoolMax = 5, pgliteDataDir } = {}) {
  return databaseUrl
    ? createPgDb(databaseUrl, databaseCaCert, databaseSslMode, databasePoolMax)
    : createPgliteDb(pgliteDataDir);
}

/**
 * TLS settings for `pg`.
 *   verify-full (default): the server's certificate must be signed by our CA AND match the hostname.
 *   verify-ca: signed by our CA, hostname not checked. This is what Supabase's own CLI uses for its
 *              poolers. Still safe against impostors: a fake server can't get a Supabase-signed cert.
 * We never use rejectUnauthorized: false, which would accept any certificate.
 */
export function tlsOptions(caCert, sslMode = 'verify-full') {
  if (!caCert) return {};
  return {
    ssl: {
      ca: caCert,
      ...(sslMode === 'verify-ca' ? { checkServerIdentity: () => undefined } : {}),
    },
  };
}

/** `pg` lets ?sslmode= in the URL override the ssl option, so remove it when we set TLS ourselves. */
export function withoutSslParams(connectionString) {
  const url = new URL(connectionString);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) url.searchParams.delete(key);
  return url.toString();
}

function createPgDb(rawConnectionString, caCert, sslMode, poolMax) {
  const connectionString = caCert ? withoutSslParams(rawConnectionString) : rawConnectionString;
  const types = {
    getTypeParser(oid, format) {
      if (oid === INT8 || oid === NUMERIC) return toNumber;
      if (oid === DATE) return keepString;
      return pg.types.getTypeParser(oid, format);
    },
  };
  const pool = new pg.Pool({
    connectionString,
    types,
    max: poolMax, // serverless: keep it small (default 5) and let the provider's pooler do the rest
    // With DATABASE_CA_CERT set, the connection is encrypted and the server is verified.
    // Without it, `sslmode` in DATABASE_URL decides (fine for a local Postgres).
    ...tlsOptions(caCert, sslMode),
  });

  const wrap = (client) => ({
    query: (text, params) => client.query(text, params),
    exec: async (sql) => {
      await client.query(sql);
    },
  });

  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ ...wrap(client), transaction: (inner) => inner(wrap(client)) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

function createPgliteDb(dataDir) {
  // PGlite is a dev/test tool (a devDependency), so it's loaded only when it's actually used.
  // Production never imports it, and its WebAssembly files stay out of the server bundle.
  const ready = import('@electric-sql/pglite').then(
    ({ PGlite, types }) =>
      new PGlite({
        ...(dataDir ? { dataDir } : {}), // no folder = in memory (tests)
        parsers: {
          [types.INT8]: toNumber,
          [types.NUMERIC]: toNumber,
          [types.DATE]: keepString,
        },
      })
  );

  const wrap = (conn) => ({
    query: (text, params) => conn.query(text, params),
    exec: async (sql) => {
      await conn.exec(sql);
    },
  });

  return {
    query: async (text, params) => (await ready).query(text, params),
    exec: async (sql) => {
      await (await ready).exec(sql);
    },
    transaction: async (fn) =>
      (await ready).transaction((tx) => fn({ ...wrap(tx), transaction: (inner) => inner(wrap(tx)) })),
    close: async () => (await ready).close(),
  };
}
