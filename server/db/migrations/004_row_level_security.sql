-- Migration 004: turn on Row Level Security (RLS) for every table.
--
-- Why: hosts like Supabase also expose tables in the "public" schema through an automatic web API
-- (meant for apps that talk to the database straight from the browser). Keel doesn't use that:
-- only our own Express server talks to the database. With RLS on and no policies, that automatic
-- API can't read or change a single row, even with Supabase's public key.
--
-- Our server's database user is the table owner locally (owners skip RLS) and has the BYPASSRLS
-- attribute on Supabase (see db/supabase/app-role.sql), so the app itself works normally.
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE securities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_securities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lots               ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE target_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_cache        ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations  ENABLE ROW LEVEL SECURITY;
