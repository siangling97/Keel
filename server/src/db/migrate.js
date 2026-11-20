// Runs the SQL files in db/migrations in order, once each.
// A schema_migrations table remembers which ones already ran, so it's safe to run on every deploy.
//
// CLI: npm run db:migrate   (uses DATABASE_URL, or the local PGlite database if it isn't set)

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);

/**
 * @param {import('./index.js').Db} db
 * @returns {Promise<string[]>} names of the migrations that ran now
 */
export async function runMigrations(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const { rows } = await db.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));

  const ran = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
    // Each migration and its bookkeeping row succeed or fail together.
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    ran.push(file);
  }
  return ran;
}

// Run from the command line.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadConfig, loadEnvFile } = await import('../config.js');
  const { createDb } = await import('./index.js');
  loadEnvFile();
  const config = loadConfig();
  const db = createDb(config);
  const ran = await runMigrations(db);
  console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
  await db.close();
}
