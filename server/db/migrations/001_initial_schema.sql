-- Migration 001: initial schema (PostgreSQL 15+)
--
-- Key idea (fix from the design review): we store ACCOUNTS and LOTS, not one merged row per ticker.
--   * Account type matters: losses inside an IRA or 401(k) can't be harvested.
--   * Lots matter: one lot can be at a loss while the whole position is up.
-- The merged "one row per ticker" view the rebalancer needs is built from lots (see the views at the end).
--
-- Money and share counts use NUMERIC, not FLOAT/REAL. Floats can't store most decimals exactly
-- (0.1 + 0.2 = 0.30000000000000004). Note: the `pg` library returns NUMERIC as a string, so the
-- data layer converts it with Number() when reading.

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_format CHECK (position('@' IN email) > 1)
);
-- Case-insensitive unique email: "Siang@x.com" and "siang@x.com" are the same user.
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- ---------------------------------------------------------------------------
-- Brokerage accounts (a user can have several per broker)
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  broker        TEXT NOT NULL CHECK (broker IN ('FIDELITY', 'VANGUARD', 'WEBULL', 'OTHER')),
  name          TEXT NOT NULL,                      -- e.g. "Fidelity Brokerage", "Vanguard Roth IRA"
  account_type  TEXT NOT NULL CHECK (account_type IN
                  ('TAXABLE', 'TRADITIONAL_IRA', 'ROTH_IRA', '401K', 'HSA', 'OTHER_TAX_ADVANTAGED')),
  drip_enabled  BOOLEAN NOT NULL DEFAULT false,     -- DRIP buys can trigger wash sales
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user_idx ON accounts (user_id);
-- Account names are unique per user, ignoring case ("Roth IRA" = "roth ira"), like the CSV importer.
CREATE UNIQUE INDEX accounts_user_name_unique ON accounts (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- Securities: facts about a ticker that are the same for every user
-- ---------------------------------------------------------------------------
CREATE TABLE securities (
  ticker         TEXT PRIMARY KEY CHECK (ticker = upper(ticker) AND ticker <> ''),  -- normalized, e.g. 'BRK-B'
  name           TEXT,
  security_type  TEXT NOT NULL DEFAULT 'OTHER'
                   CHECK (security_type IN ('STOCK', 'ETF', 'MUTUAL_FUND', 'BOND', 'CASH', 'OTHER')),
  tracked_index  TEXT                               -- e.g. 'S&P 500'. Two funds on the same index may be
                                                    -- "substantially identical" for the wash-sale rule.
);

-- How THIS user classifies a ticker. Users may disagree (is SCHD "US_EQUITY" or "DIVIDEND"?).
CREATE TABLE user_securities (
  user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ticker       TEXT   NOT NULL REFERENCES securities (ticker),
  asset_class  TEXT   NOT NULL CHECK (asset_class ~ '^[A-Z][A-Z0-9_]*$'),   -- e.g. 'US_EQUITY'
  PRIMARY KEY (user_id, ticker)
);

-- ---------------------------------------------------------------------------
-- Tax lots: shares the user still holds, one row per purchase
-- ---------------------------------------------------------------------------
CREATE TABLE lots (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id      BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  ticker          TEXT   NOT NULL REFERENCES securities (ticker),
  shares          NUMERIC(20, 8) NOT NULL CHECK (shares > 0),          -- fractional shares from DRIP
  cost_per_share  NUMERIC(20, 6) NOT NULL CHECK (cost_per_share >= 0),
  acquired_on     DATE NOT NULL,                                       -- decides short- vs long-term
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lots_account_ticker_idx ON lots (account_id, ticker);

-- ---------------------------------------------------------------------------
-- Transactions: history, used for the 30-day wash-sale lookback
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  ticker      TEXT   NOT NULL REFERENCES securities (ticker),
  type        TEXT   NOT NULL CHECK (type IN ('BUY', 'SELL', 'DIVIDEND_REINVEST', 'DIVIDEND_CASH')),
  trade_date  DATE   NOT NULL,
  shares      NUMERIC(20, 8) CHECK (shares IS NULL OR shares >= 0),
  price       NUMERIC(20, 6) CHECK (price IS NULL OR price >= 0),
  amount      NUMERIC(20, 2) NOT NULL,                                 -- dollars moved
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Buys and sells must say how many shares and at what price.
  CONSTRAINT trades_have_shares CHECK (
    type NOT IN ('BUY', 'SELL', 'DIVIDEND_REINVEST') OR (shares > 0 AND price IS NOT NULL)
  )
);
-- The wash-sale query is "buys of ticker X, in any of this user's accounts, in the last 30 days".
CREATE INDEX transactions_ticker_date_idx ON transactions (ticker, trade_date);
CREATE INDEX transactions_account_idx ON transactions (account_id);

-- ---------------------------------------------------------------------------
-- Target allocation: what mix the user wants
-- ---------------------------------------------------------------------------
CREATE TABLE target_allocations (
  user_id           BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  asset_class       TEXT   NOT NULL CHECK (asset_class ~ '^[A-Z][A-Z0-9_]*$'),
  target_weight     NUMERIC(7, 6) NOT NULL CHECK (target_weight >= 0 AND target_weight <= 1),  -- 0.55 = 55%
  preferred_ticker  TEXT REFERENCES securities (ticker),             -- what to buy for this class
  PRIMARY KEY (user_id, asset_class)
  -- "Weights add up to 100%" spans several rows, so a CHECK can't enforce it.
  -- The rebalancing engine validates it instead.
);

-- ---------------------------------------------------------------------------
-- Price cache: replaces Redis for v1. Fresh if fetched_at is within the TTL (e.g. 5 minutes).
-- ---------------------------------------------------------------------------
CREATE TABLE price_cache (
  ticker                   TEXT PRIMARY KEY REFERENCES securities (ticker),
  price                    NUMERIC(20, 6) NOT NULL CHECK (price > 0),
  forward_annual_dividend  NUMERIC(20, 6) CHECK (forward_annual_dividend IS NULL OR forward_annual_dividend >= 0),
  fetched_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Views: the merged holdings the engines need, built from lots
-- ---------------------------------------------------------------------------

-- One row per account + ticker (what you see on a broker's positions page).
-- security_invoker: the view checks permissions as the person querying it, not as its owner,
-- so it can never be used to get around the tables' own protections.
CREATE VIEW account_holdings WITH (security_invoker = true) AS
SELECT
  a.user_id,
  l.account_id,
  a.account_type,
  l.ticker,
  SUM(l.shares)                    AS shares,
  SUM(l.shares * l.cost_per_share) AS total_cost_basis,
  COUNT(*)                         AS lot_count
FROM lots l
JOIN accounts a ON a.id = l.account_id
GROUP BY a.user_id, l.account_id, a.account_type, l.ticker;

-- One row per ticker across ALL accounts (the pseudocode's unifiedHoldings), for the rebalancer.
CREATE VIEW user_holdings WITH (security_invoker = true) AS
SELECT
  ah.user_id,
  ah.ticker,
  us.asset_class,                                  -- NULL means "not classified yet"
  SUM(ah.shares)            AS shares,
  SUM(ah.total_cost_basis)  AS total_cost_basis
FROM account_holdings ah
LEFT JOIN user_securities us ON us.user_id = ah.user_id AND us.ticker = ah.ticker
GROUP BY ah.user_id, ah.ticker, us.asset_class;
