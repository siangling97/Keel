-- Migration 003: starter facts about common funds, so the tax-loss scanner can spot same-index funds
-- and suggest substitutes. Demo data: verify a fund's index before relying on it.

-- A sensible starting asset class for a ticker. Each user can still classify it their own way
-- in user_securities; this is only used when they haven't.
ALTER TABLE securities ADD COLUMN default_asset_class TEXT
  CHECK (default_asset_class IS NULL OR default_asset_class ~ '^[A-Z][A-Z0-9_]*$');

INSERT INTO securities (ticker, name, security_type, tracked_index, default_asset_class) VALUES
  ('VOO',  'Vanguard S&P 500 ETF',                    'ETF',   'S&P 500',                               'US_EQUITY'),
  ('IVV',  'iShares Core S&P 500 ETF',                'ETF',   'S&P 500',                               'US_EQUITY'),
  ('SPY',  'SPDR S&P 500 ETF Trust',                  'ETF',   'S&P 500',                               'US_EQUITY'),
  ('VTI',  'Vanguard Total Stock Market ETF',         'ETF',   'CRSP US Total Market',                  'US_EQUITY'),
  ('SCHB', 'Schwab US Broad Market ETF',              'ETF',   'Dow Jones US Broad Stock Market',       'US_EQUITY'),
  ('SCHD', 'Schwab US Dividend Equity ETF',           'ETF',   'Dow Jones US Dividend 100',             'US_EQUITY'),
  ('VXUS', 'Vanguard Total International Stock ETF',  'ETF',   'FTSE Global All Cap ex US',             'INTL_EQUITY'),
  ('IXUS', 'iShares Core MSCI Total International Stock ETF', 'ETF', 'MSCI ACWI ex USA IMI',            'INTL_EQUITY'),
  ('BND',  'Vanguard Total Bond Market ETF',          'ETF',   'Bloomberg US Aggregate Float Adjusted', 'BONDS'),
  ('AGG',  'iShares Core US Aggregate Bond ETF',      'ETF',   'Bloomberg US Aggregate',                'BONDS'),
  ('VNQ',  'Vanguard Real Estate ETF',                'ETF',   'MSCI US IMI Real Estate 25/50',         'REIT'),
  ('O',    'Realty Income',                           'STOCK', NULL,                                    'REIT')
ON CONFLICT (ticker) DO NOTHING;
