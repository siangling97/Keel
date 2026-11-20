// All settings come from environment variables (see .env.example).
// Nothing secret is ever written in the code.

import { existsSync } from 'node:fs';

/** Load server/.env if it exists (local dev). On Vercel, variables come from the dashboard instead. */
export function loadEnvFile(path = '.env') {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(env = process.env) {
  // Vercel sets VERCEL=1 on its servers, so production settings apply there even if NODE_ENV isn't set.
  const isProduction = env.NODE_ENV === 'production' || env.VERCEL === '1';

  if (isProduction && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in production.');
  }

  return {
    isProduction,
    port: Number(env.PORT ?? 3001),
    databaseUrl: env.DATABASE_URL || undefined,
    databaseCaCert: env.DATABASE_CA_CERT || undefined,
    // verify-full (default) or verify-ca. See src/db/index.js.
    databaseSslMode: env.DATABASE_SSL_MODE || 'verify-full',
    // Local dev without DATABASE_URL keeps its PGlite data in this folder.
    pgliteDataDir: env.PGLITE_DATA_DIR ?? './.pglite',
    // bcrypt work factor. Higher = slower to crack, slower to log in. 12 is a common default.
    bcryptRounds: Number(env.BCRYPT_ROUNDS ?? 12),
    sessionDays: Number(env.SESSION_DAYS ?? 7),
    // Max login/register attempts per IP per 15 minutes. 0 turns the limit off (tests).
    authRateLimit: Number(env.AUTH_RATE_LIMIT ?? 20),
    // Behind Vercel's proxy, trust X-Forwarded-For so rate limiting sees the real visitor IP.
    trustProxy: isProduction,
    secureCookies: isProduction,
  };
}
