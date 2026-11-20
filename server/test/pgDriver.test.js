// Production talks to Postgres through the `pg` driver, not PGlite. This runs the real `pg` code
// path against PGlite's network server (it speaks the same wire protocol as a real Postgres), so
// the type parsing, transactions and TLS settings used in production are tested too.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import request from 'supertest';
import { createDb, tlsOptions, withoutSslParams } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { createSampleMarketData } from '../src/market/sampleMarketData.js';
import { loadConfig } from '../src/config.js';

const PORT = 54329;
let pglite, server, db;

beforeAll(async () => {
  pglite = await PGlite.create();
  server = new PGLiteSocketServer({ db: pglite, port: PORT, host: '127.0.0.1' });
  await server.start();
  // PGlite's server takes one connection at a time, so the pool gets one (production uses 5).
  db = createDb({ databaseUrl: `postgres://postgres@127.0.0.1:${PORT}/postgres`, databasePoolMax: 1 });
  await runMigrations(db);
});

afterAll(async () => {
  await db?.close();
  await server?.stop();
  await pglite?.close();
});

describe('the pg driver (production code path)', () => {
  it('returns the same JavaScript types as PGlite: numbers for ids and money, strings for dates', async () => {
    const { rows } = await db.query(
      `SELECT 9007199254740::bigint AS id, 123.456789::numeric(20,6) AS money, '2026-11-19'::date AS day, count(*) AS n FROM (VALUES (1)) v`
    );
    expect(rows[0]).toEqual({ id: 9007199254740, money: 123.456789, day: '2026-11-19', n: 1 });
  });

  it('transactions roll back on error', async () => {
    await db.exec(`CREATE TABLE IF NOT EXISTS tx_check (n int)`);
    await expect(
      db.transaction(async (tx) => {
        await tx.query('INSERT INTO tx_check VALUES (1)');
        throw new Error('stop');
      })
    ).rejects.toThrow('stop');
    const { rows } = await db.query('SELECT count(*)::int AS n FROM tx_check');
    expect(rows[0].n).toBe(0);
  });

  it('the whole app works over pg: sign up, add a lot, see holdings', async () => {
    const config = { isProduction: false, bcryptRounds: 4, sessionDays: 7, authRateLimit: 0, trustProxy: false, secureCookies: false };
    const app = createApp({ db, config, marketData: createSampleMarketData() });
    const agent = request.agent(app);

    expect((await agent.get('/api/health')).body).toEqual({ ok: true, database: 'ok' });
    expect((await agent.post('/api/auth/register').send({ email: 'pg@example.com', password: 'a long enough password' })).status).toBe(201);
    const accountId = (await agent.post('/api/accounts').send({ name: 'B', accountType: 'TAXABLE' })).body.account.id;
    const lot = await agent.post('/api/lots').send({ accountId, ticker: 'VTI', shares: 2.5, costPerShare: 200, acquiredOn: '2024-01-02', assetClass: 'US_EQUITY' });
    expect(lot.body.lot).toMatchObject({ shares: 2.5, costPerShare: 200, acquiredOn: '2024-01-02' });
    expect((await agent.get('/api/portfolio/holdings')).body.totals.currentValue).toBe(750);
  });
});

describe('production settings', () => {
  it('a database that is down makes the health check say so (503), without details', async () => {
    const down = createDb({ databaseUrl: 'postgres://postgres@127.0.0.1:1/postgres' });
    const config = { bcryptRounds: 4, sessionDays: 7, authRateLimit: 0 };
    const app = createApp({ db: down, config, marketData: createSampleMarketData() });
    const quiet = console.error;
    console.error = () => {};
    try {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ ok: false, database: 'unreachable' });
    } finally {
      console.error = quiet;
      await down.close();
    }
  });

  it('TLS: always verifies the certificate; verify-ca only skips the hostname check', () => {
    expect(tlsOptions(undefined)).toEqual({});
    const full = tlsOptions('PEM');
    expect(full.ssl).toEqual({ ca: 'PEM' });
    expect(full.ssl.rejectUnauthorized).toBeUndefined(); // Node's default: verify
    const caOnly = tlsOptions('PEM', 'verify-ca');
    expect(caOnly.ssl.ca).toBe('PEM');
    expect(caOnly.ssl.checkServerIdentity()).toBeUndefined();
  });

  it('removes sslmode from the URL so it cannot override our TLS settings', () => {
    expect(withoutSslParams('postgres://u:p@host:6543/postgres?sslmode=require&application_name=keel')).toBe(
      'postgres://u:p@host:6543/postgres?application_name=keel'
    );
  });

  it('on Vercel, production settings switch on even without NODE_ENV', () => {
    const config = loadConfig({ VERCEL: '1', DATABASE_URL: 'postgres://x' });
    expect(config).toMatchObject({ isProduction: true, secureCookies: true, trustProxy: true });
    expect(() => loadConfig({ VERCEL: '1' })).toThrow(/DATABASE_URL must be set/);
  });
});
