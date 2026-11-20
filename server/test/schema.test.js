// Tests the real database schema on PGlite: actual PostgreSQL compiled to WebAssembly.
// It runs inside Node, so `npm test` works without installing or starting a Postgres server.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

let db;

// Start Postgres and run the migrations once (slow), then run every test inside a
// transaction that gets rolled back (fast). Each test still starts with empty tables.
beforeAll(async () => {
  db = createDb(); // PGlite in memory
  await runMigrations(db);
});
beforeEach(async () => {
  await db.exec('BEGIN');
});
afterEach(async () => {
  await db.exec('ROLLBACK');
});

/** Insert a user with one taxable and one Roth account, plus a few lots. Returns their ids. */
async function seed() {
  const { rows: [user] } = await db.query(
    `INSERT INTO users (email, password_hash) VALUES ('siang@example.com', 'hash') RETURNING id`
  );
  const { rows: [taxable] } = await db.query(
    `INSERT INTO accounts (user_id, broker, name, account_type, drip_enabled)
     VALUES ($1, 'FIDELITY', 'Fidelity Brokerage', 'TAXABLE', false) RETURNING id`,
    [user.id]
  );
  const { rows: [roth] } = await db.query(
    `INSERT INTO accounts (user_id, broker, name, account_type, drip_enabled)
     VALUES ($1, 'VANGUARD', 'Vanguard Roth IRA', 'ROTH_IRA', true) RETURNING id`,
    [user.id]
  );
  // VTI and BND are already in the securities table (migration 003 seeds common funds).
  await db.query(
    `INSERT INTO user_securities (user_id, ticker, asset_class) VALUES ($1, 'VTI', 'US_EQUITY'), ($1, 'BND', 'BONDS')`,
    [user.id]
  );
  await db.query(
    `INSERT INTO lots (account_id, ticker, shares, cost_per_share, acquired_on) VALUES
       ($1, 'VTI', 10, 200, '2023-03-01'),
       ($1, 'VTI', 5.5, 320, '2025-12-01'),
       ($2, 'VTI', 4, 250, '2024-06-15'),
       ($2, 'BND', 20, 72.5, '2024-06-15')`,
    [taxable.id, roth.id]
  );
  return { userId: user.id, taxableId: taxable.id, rothId: roth.id };
}

describe('schema', () => {
  it('loads into a real Postgres without errors', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'account_holdings',
      'accounts',
      'lots',
      'price_cache',
      'schema_migrations',
      'securities',
      'sessions',
      'target_allocations',
      'transactions',
      'user_holdings',
      'user_securities',
      'users',
    ]);
  });

  it('account_holdings: one row per account + ticker, with cost basis from the lots', async () => {
    const { taxableId } = await seed();
    const { rows } = await db.query(
      `SELECT shares::float AS shares, total_cost_basis::float AS cost, lot_count::int AS lots
       FROM account_holdings WHERE account_id = $1 AND ticker = 'VTI'`,
      [taxableId]
    );
    // 10 x 200 + 5.5 x 320 = 2000 + 1760
    expect(rows).toEqual([{ shares: 15.5, cost: 3760, lots: 2 }]);
  });

  it('user_holdings: merges the same ticker across accounts (for the rebalancer)', async () => {
    const { userId } = await seed();
    const { rows } = await db.query(
      `SELECT ticker, asset_class, shares::float AS shares, total_cost_basis::float AS cost
       FROM user_holdings WHERE user_id = $1 ORDER BY ticker`,
      [userId]
    );
    expect(rows).toEqual([
      { ticker: 'BND', asset_class: 'BONDS', shares: 20, cost: 1450 },
      { ticker: 'VTI', asset_class: 'US_EQUITY', shares: 19.5, cost: 4760 },
    ]);
  });

  it('NUMERIC keeps decimals exact (no float rounding errors)', async () => {
    const { rows } = await db.query(`SELECT (0.1::numeric + 0.2::numeric)::text AS exact, (0.1::float8 + 0.2::float8)::text AS float`);
    expect(rows[0].exact).toBe('0.3');
    expect(rows[0].float).not.toBe('0.3');
  });

  it('deleting a user deletes their accounts, lots and targets too', async () => {
    const { userId } = await seed();
    await db.query(`INSERT INTO target_allocations (user_id, asset_class, target_weight) VALUES ($1, 'BONDS', 0.2)`, [userId]);
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
    for (const table of ['accounts', 'lots', 'target_allocations', 'user_securities']) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0].n, table).toBe(0);
    }
  });
});

describe('schema rules reject bad data', () => {
  /**
   * Expect a SQL statement to be rejected by the database.
   * A failed statement breaks the whole transaction in Postgres, so we wrap it in a savepoint
   * and roll back to it. Then the next statement in the same test still runs normally.
   */
  async function rejects(sql, params) {
    await db.exec('SAVEPOINT before_bad_data');
    await expect(db.query(sql, params)).rejects.toThrow();
    await db.exec('ROLLBACK TO SAVEPOINT before_bad_data');
  }

  it('every table has row level security on (locks out Supabase\'s automatic web API)', async () => {
    const { rows } = await db.query(
      `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY relname`
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('running the migrations again changes nothing', async () => {
    expect(await runMigrations(db)).toEqual([]);
  });

  it('account names are unique per user, ignoring upper/lower case', async () => {
    const { userId } = await seed();
    await rejects(
      `INSERT INTO accounts (user_id, broker, name, account_type) VALUES ($1, 'OTHER', 'FIDELITY BROKERAGE', 'TAXABLE')`,
      [userId]
    );
  });

  it('emails are unique, ignoring upper/lower case', async () => {
    await seed();
    await rejects(`INSERT INTO users (email, password_hash) VALUES ('SIANG@example.com', 'x')`);
  });

  it('account type must be a known value', async () => {
    const { userId } = await seed();
    await rejects(
      `INSERT INTO accounts (user_id, broker, name, account_type) VALUES ($1, 'FIDELITY', 'X', 'SAVINGS')`,
      [userId]
    );
  });

  it('a lot must have more than 0 shares and a cost of $0 or more', async () => {
    const { taxableId } = await seed();
    await rejects(`INSERT INTO lots (account_id, ticker, shares, cost_per_share, acquired_on) VALUES ($1, 'VTI', 0, 100, '2025-01-01')`, [taxableId]);
    await rejects(`INSERT INTO lots (account_id, ticker, shares, cost_per_share, acquired_on) VALUES ($1, 'VTI', 1, -5, '2025-01-01')`, [taxableId]);
  });

  it('a lot must point to a known ticker', async () => {
    const { taxableId } = await seed();
    await rejects(`INSERT INTO lots (account_id, ticker, shares, cost_per_share, acquired_on) VALUES ($1, 'NOPE', 1, 1, '2025-01-01')`, [taxableId]);
  });

  it('tickers are stored normalized (upper case)', async () => {
    await rejects(`INSERT INTO securities (ticker) VALUES ('brk-b')`);
  });

  it('a BUY must say how many shares and at what price', async () => {
    const { taxableId } = await seed();
    await rejects(
      `INSERT INTO transactions (account_id, ticker, type, trade_date, amount) VALUES ($1, 'VTI', 'BUY', '2026-11-01', 500)`,
      [taxableId]
    );
  });

  it('a target weight must be between 0 and 1 (55 instead of 0.55 is rejected)', async () => {
    const { userId } = await seed();
    await rejects(`INSERT INTO target_allocations (user_id, asset_class, target_weight) VALUES ($1, 'BONDS', 55)`, [userId]);
  });

  it('asset class names look like US_EQUITY', async () => {
    const { userId } = await seed();
    await rejects(`INSERT INTO target_allocations (user_id, asset_class, target_weight) VALUES ($1, 'us equity', 0.5)`, [userId]);
  });
});
