// All SQL for a user's portfolio lives here.
//
// Security rule: EVERY query is limited to the logged-in user's data (user_id = $1, or a join to
// accounts that checks it). Asking for someone else's account id gives "not found", exactly like an
// id that doesn't exist, so ids can't be probed. (This bug class is called IDOR.)

import { HttpError, notFound } from '../http/errors.js';

const ACCOUNT_COLUMNS = `id, broker, name, account_type AS "accountType", drip_enabled AS "dripEnabled"`;

// ---------------------------------------------------------------- accounts

export async function listAccounts(db, userId) {
  const { rows } = await db.query(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id = $1 ORDER BY id`, [userId]);
  return rows;
}

export async function createAccount(db, userId, { name, accountType, broker, dripEnabled }) {
  try {
    const { rows } = await db.query(
      `INSERT INTO accounts (user_id, name, account_type, broker, drip_enabled)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${ACCOUNT_COLUMNS}`,
      [userId, name, accountType, broker, dripEnabled]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, `You already have an account named "${name}".`);
    throw err;
  }
}

export async function updateAccount(db, userId, accountId, changes) {
  const columns = { name: 'name', accountType: 'account_type', broker: 'broker', dripEnabled: 'drip_enabled' };
  const sets = [];
  const params = [userId, accountId];
  for (const [field, column] of Object.entries(columns)) {
    if (changes[field] !== undefined) {
      params.push(changes[field]);
      sets.push(`${column} = $${params.length}`); // column names come from our own list, never from the request
    }
  }
  if (sets.length === 0) throw new HttpError(400, 'Nothing to change.');

  try {
    const { rows } = await db.query(
      `UPDATE accounts SET ${sets.join(', ')} WHERE user_id = $1 AND id = $2 RETURNING ${ACCOUNT_COLUMNS}`,
      params
    );
    if (rows.length === 0) throw notFound('Account not found.');
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, `You already have an account named "${changes.name}".`);
    throw err;
  }
}

export async function deleteAccount(db, userId, accountId) {
  const { rows } = await db.query('DELETE FROM accounts WHERE user_id = $1 AND id = $2 RETURNING id', [userId, accountId]);
  if (rows.length === 0) throw notFound('Account not found.');
}

// ---------------------------------------------------------------- lots

const LOT_SELECT = `
  SELECT l.id, l.account_id AS "accountId", a.name AS "accountName", a.account_type AS "accountType",
         l.ticker, l.shares, l.cost_per_share AS "costPerShare", l.acquired_on AS "acquiredOn"
  FROM lots l JOIN accounts a ON a.id = l.account_id
  WHERE a.user_id = $1`;

export async function listLots(db, userId) {
  const { rows } = await db.query(`${LOT_SELECT} ORDER BY a.name, l.ticker, l.acquired_on, l.id`, [userId]);
  return rows;
}

export async function createLot(db, userId, { accountId, ticker, shares, costPerShare, acquiredOn, assetClass }) {
  return db.transaction(async (tx) => {
    const { rows: owned } = await tx.query('SELECT id FROM accounts WHERE user_id = $1 AND id = $2', [userId, accountId]);
    if (owned.length === 0) throw notFound('Account not found.');

    await tx.query('INSERT INTO securities (ticker) VALUES ($1) ON CONFLICT (ticker) DO NOTHING', [ticker]);
    if (assetClass) await upsertAssetClasses(tx, userId, { [ticker]: assetClass });

    const { rows } = await tx.query(
      `INSERT INTO lots (account_id, ticker, shares, cost_per_share, acquired_on)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [accountId, ticker, shares, costPerShare, acquiredOn]
    );
    const { rows: [lot] } = await tx.query(`${LOT_SELECT} AND l.id = $2`, [userId, rows[0].id]);
    return lot;
  });
}

export async function deleteLot(db, userId, lotId) {
  const { rows } = await db.query(
    `DELETE FROM lots l USING accounts a
     WHERE l.account_id = a.id AND a.user_id = $1 AND l.id = $2 RETURNING l.id`,
    [userId, lotId]
  );
  if (rows.length === 0) throw notFound('Lot not found.');
}

// ---------------------------------------------------------------- asset classes

/** { VTI: "US_EQUITY", ... } -> this user's classification, saved in one query. */
export async function upsertAssetClasses(db, userId, assetClasses) {
  const tickers = Object.keys(assetClasses);
  if (tickers.length === 0) return;
  await db.query('INSERT INTO securities (ticker) SELECT unnest($1::text[]) ON CONFLICT (ticker) DO NOTHING', [tickers]);
  await db.query(
    `INSERT INTO user_securities (user_id, ticker, asset_class)
     SELECT $1, t.ticker, t.asset_class FROM unnest($2::text[], $3::text[]) AS t(ticker, asset_class)
     ON CONFLICT (user_id, ticker) DO UPDATE SET asset_class = EXCLUDED.asset_class`,
    [userId, tickers, tickers.map((t) => assetClasses[t])]
  );
}

// ---------------------------------------------------------------- targets

export async function getTargets(db, userId) {
  const { rows } = await db.query(
    `SELECT asset_class, target_weight, preferred_ticker FROM target_allocations WHERE user_id = $1 ORDER BY target_weight DESC, asset_class`,
    [userId]
  );
  return {
    targetWeights: Object.fromEntries(rows.map((r) => [r.asset_class, r.target_weight])),
    preferredTickers: Object.fromEntries(rows.filter((r) => r.preferred_ticker).map((r) => [r.asset_class, r.preferred_ticker])),
  };
}

/** Replace the whole target mix at once, so it never sits half-updated. */
export async function replaceTargets(db, userId, targets) {
  await db.transaction(async (tx) => {
    const preferred = targets.map((t) => t.preferredTicker).filter(Boolean);
    if (preferred.length > 0) {
      await tx.query('INSERT INTO securities (ticker) SELECT unnest($1::text[]) ON CONFLICT (ticker) DO NOTHING', [preferred]);
    }
    await tx.query('DELETE FROM target_allocations WHERE user_id = $1', [userId]);
    await tx.query(
      `INSERT INTO target_allocations (user_id, asset_class, target_weight, preferred_ticker)
       SELECT $1, t.asset_class, t.weight, t.preferred FROM unnest($2::text[], $3::numeric[], $4::text[]) AS t(asset_class, weight, preferred)`,
      [userId, targets.map((t) => t.assetClass), targets.map((t) => t.weight), targets.map((t) => t.preferredTicker ?? null)]
    );
  });
  return getTargets(db, userId);
}

// ---------------------------------------------------------------- everything the engines need

/**
 * Load one user's whole portfolio in a few queries.
 * @param {string} asOfDate  "YYYY-MM-DD", for the 30-day transaction lookback
 */
export async function loadPortfolio(db, userId, asOfDate) {
  const [accounts, lots, classes, targets, transactions] = await Promise.all([
    listAccounts(db, userId),
    listLots(db, userId),
    db.query(
      // The user's own classification wins; otherwise the default for well-known funds.
      `SELECT s.ticker, s.tracked_index AS "trackedIndex", COALESCE(us.asset_class, s.default_asset_class) AS "assetClass"
       FROM securities s LEFT JOIN user_securities us ON us.ticker = s.ticker AND us.user_id = $1`,
      [userId]
    ),
    getTargets(db, userId),
    db.query(
      `SELECT t.account_id AS "accountId", t.ticker, t.type, t.trade_date AS "tradeDate", t.shares
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE a.user_id = $1 AND t.trade_date >= $2::date - 31`,
      [userId, asOfDate]
    ),
  ]);

  const securities = classes.rows;
  const assetClasses = Object.fromEntries(securities.filter((s) => s.assetClass).map((s) => [s.ticker, s.assetClass]));
  return { accounts, lots, securities, assetClasses, ...targets, transactions: transactions.rows };
}

// ---------------------------------------------------------------- import

/**
 * Save the result of importCsvSources() in ONE transaction: all of it or none of it.
 * Lots that exactly match ones the user already has are skipped, so uploading the
 * same file twice doesn't double the portfolio.
 */
export async function saveImport(db, userId, imported, { broker }) {
  return db.transaction(async (tx) => {
    // 1. Accounts: reuse by name (ignoring case), create the rest.
    const { rows: existing } = await tx.query(
      `SELECT id, name, account_type AS "accountType" FROM accounts WHERE user_id = $1`,
      [userId]
    );
    const byName = new Map(existing.map((a) => [a.name.toLowerCase(), a]));
    const conflicts = [];
    const createdAccounts = [];

    for (const account of imported.accounts) {
      const found = byName.get(account.name.toLowerCase());
      if (found) {
        if (found.accountType !== account.accountType) {
          conflicts.push({
            field: 'Account Type',
            message: `"${found.name}" is already saved as ${found.accountType}, but the file says ${account.accountType}.`,
          });
        }
        continue;
      }
      const { rows } = await tx.query(
        `INSERT INTO accounts (user_id, name, account_type, broker) VALUES ($1, $2, $3, $4)
         RETURNING id, name, account_type AS "accountType"`,
        [userId, account.name, account.accountType, broker]
      );
      byName.set(account.name.toLowerCase(), rows[0]);
      createdAccounts.push(rows[0].name);
    }
    if (conflicts.length > 0) {
      // Throwing inside the transaction rolls back the accounts created above too.
      throw new HttpError(422, 'Nothing was saved. Fix these and upload again.', conflicts);
    }

    // 2. Tickers and asset classes.
    const tickers = [...new Set(imported.lots.map((l) => l.ticker))];
    await tx.query('INSERT INTO securities (ticker) SELECT unnest($1::text[]) ON CONFLICT (ticker) DO NOTHING', [tickers]);
    await upsertAssetClasses(tx, userId, imported.assetClasses);

    // 3. Lots, minus exact copies of lots saved before this upload.
    const { rows: before } = await tx.query(
      `SELECT l.account_id, l.ticker, l.shares, l.cost_per_share, l.acquired_on
       FROM lots l JOIN accounts a ON a.id = l.account_id WHERE a.user_id = $1`,
      [userId]
    );
    const keyOf = (accountId, l) => [accountId, l.ticker, Number(l.shares), Number(l.costPerShare ?? l.cost_per_share), l.acquiredOn ?? l.acquired_on].join('|');
    const alreadySaved = new Set(before.map((l) => keyOf(l.account_id, l)));

    const toInsert = [];
    let skippedDuplicates = 0;
    for (const lot of imported.lots) {
      const accountId = byName.get(lot.accountName.toLowerCase()).id;
      if (alreadySaved.has(keyOf(accountId, lot))) {
        skippedDuplicates++;
        continue;
      }
      toInsert.push({ accountId, ...lot });
    }

    // One INSERT for all rows (unnest turns the arrays into rows). 5,000 single INSERTs to a cloud
    // database could take long enough to hit the serverless time limit.
    if (toInsert.length > 0) {
      await tx.query(
        `INSERT INTO lots (account_id, ticker, shares, cost_per_share, acquired_on)
         SELECT * FROM unnest($1::bigint[], $2::text[], $3::numeric[], $4::numeric[], $5::date[])`,
        [
          toInsert.map((l) => l.accountId),
          toInsert.map((l) => l.ticker),
          toInsert.map((l) => l.shares),
          toInsert.map((l) => l.costPerShare),
          toInsert.map((l) => l.acquiredOn),
        ]
      );
    }

    return { createdAccounts, lotsSaved: toInsert.length, skippedDuplicates };
  });
}
