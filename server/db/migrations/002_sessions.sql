-- Migration 002: login sessions
--
-- The browser gets a random token in an httpOnly cookie. We store only its SHA-256 hash,
-- so someone who steals a database backup can't use it to log in as anyone.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
