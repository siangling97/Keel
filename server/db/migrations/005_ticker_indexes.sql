-- Migration 005: indexes for foreign keys that point at securities(ticker).
-- Without them, changing or deleting a security makes Postgres scan these whole tables.
-- (Suggested by Supabase's performance advisor.)
CREATE INDEX lots_ticker_idx ON lots (ticker);
CREATE INDEX user_securities_ticker_idx ON user_securities (ticker);
CREATE INDEX target_allocations_preferred_ticker_idx ON target_allocations (preferred_ticker);
