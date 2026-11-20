-- Supabase only: a limited database user for the app (run once, as the "postgres" user).
--
-- The app does NOT connect as "postgres" (the admin). It connects as keel_app, which can read and
-- write rows in Keel's tables and nothing else: it can't create or drop tables, change other
-- roles, or touch Supabase's own schemas. If the app's password ever leaked, the damage is limited.
--
-- BYPASSRLS lets it skip the row-level-security lock from migration 004 (the same approach
-- Supabase's docs use for an app's own role). The password is set separately, never committed:
--   ALTER ROLE keel_app PASSWORD '<long random password>';
-- Connect through the transaction pooler (port 6543) as user "keel_app.<project-ref>".

CREATE ROLE keel_app LOGIN BYPASSRLS NOINHERIT;

GRANT USAGE ON SCHEMA public TO keel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO keel_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO keel_app;  -- for identity (auto-number) columns

-- Tables created by future migrations get the same rights automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO keel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO keel_app;

-- Belt and braces: the roles Supabase's automatic web API uses get no access to Keel's tables at all.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
