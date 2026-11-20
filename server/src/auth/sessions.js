// Login sessions stored in Postgres.
//
// Why not a JWT in localStorage? Any script on the page (for example from an XSS bug) can read
// localStorage. An httpOnly cookie can't be read by JavaScript at all. And because sessions live in
// the database, logging out (or "log out everywhere") really ends them, which a JWT can't do
// before it expires.

import { randomBytes, createHash } from 'node:crypto';
import { HttpError } from '../http/errors.js';

export const SESSION_COOKIE = 'sid';

/** sha256 of the token: what we store, so a leaked database can't be used to log in. */
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export async function createSession(db, userId, { sessionDays }) {
  const token = randomBytes(32).toString('base64url'); // 256 bits of randomness
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), userId, sessionDays]
  );
  return token;
}

export async function deleteSession(db, token) {
  if (!token) return;
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

/** Returns { id, email } for a valid, unexpired session, or null. */
export async function findSessionUser(db, token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)]
  );
  return rows[0] ?? null;
}

export function cookieOptions(config) {
  return {
    httpOnly: true, // JavaScript in the browser can't read it
    secure: config.secureCookies, // HTTPS only in production
    sameSite: 'lax', // not sent on cross-site POSTs, which blocks most CSRF
    path: '/',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  };
}

/** Middleware: only let logged-in users through, and put the user on req.user. */
export function requireAuth(db) {
  return async (req, res, next) => {
    const user = await findSessionUser(db, req.cookies?.[SESSION_COOKIE]);
    if (!user) throw new HttpError(401, 'Please log in.');
    req.user = user;
    next();
  };
}
