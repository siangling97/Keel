// /api/auth: register, login, logout, me

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { HttpError } from '../http/errors.js';
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  findSessionUser,
  cookieOptions,
} from './sessions.js';

const credentialsSchema = z.strictObject({
  // Clean first (trim, lowercase), then check the format.
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.')),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters.')
    // bcrypt only looks at the first 72 bytes. Longer passwords would be silently cut, so refuse them.
    .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be 72 bytes or less.'),
});

const loginSchema = z.strictObject({
  email: z.string().max(254).transform((e) => e.trim().toLowerCase()),
  password: z.string().max(200),
});

const deleteAccountSchema = z.strictObject({
  password: z.string({ error: 'Enter your password to confirm.' }).min(1, 'Enter your password to confirm.').max(200),
});

const LOGIN_FAILED = 'Email or password is wrong.';

export function authRoutes({ db, config }) {
  const router = Router();

  // Slow down password guessing: at most N tries per IP per 15 minutes.
  // (Memory-based, so on serverless each instance counts separately. Good enough for v1.)
  const limiter = config.authRateLimit
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: config.authRateLimit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: { message: 'Too many attempts. Try again in 15 minutes.' } },
      })
    : (req, res, next) => next();

  // A real bcrypt hash of a random password. Used when the email doesn't exist, so a wrong email
  // takes as long as a wrong password and the response time doesn't reveal who has an account.
  const dummyHash = bcrypt.hashSync(String(Math.random()), config.bcryptRounds);

  async function startSession(res, userId) {
    const token = await createSession(db, userId, config);
    res.cookie(SESSION_COOKIE, token, cookieOptions(config));
  }

  router.post('/register', limiter, async (req, res) => {
    const { email, password } = credentialsSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

    let user;
    try {
      const { rows } = await db.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash]
      );
      user = rows[0];
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'An account with this email already exists.');
      throw err;
    }

    await startSession(res, user.id);
    res.status(201).json({ user });
  });

  router.post('/login', limiter, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const { rows } = await db.query('SELECT id, email, password_hash FROM users WHERE lower(email) = $1', [email]);
    const found = rows[0];

    const passwordOk = await bcrypt.compare(password, found?.password_hash ?? dummyHash);
    if (!found || !passwordOk) throw new HttpError(401, LOGIN_FAILED);

    await startSession(res, found.id);
    res.json({ user: { id: found.id, email: found.email } });
  });

  router.post('/logout', async (req, res) => {
    await deleteSession(db, req.cookies?.[SESSION_COOKIE]);
    const { maxAge, ...clearOptions } = cookieOptions(config);
    res.clearCookie(SESSION_COOKIE, clearOptions);
    res.status(204).end();
  });

  router.get('/me', async (req, res) => {
    const user = await findSessionUser(db, req.cookies?.[SESSION_COOKIE]);
    if (!user) throw new HttpError(401, 'Please log in.');
    res.json({ user });
  });

  /**
   * Delete my account and everything in it.
   *
   * The password is asked again even though the user is logged in ("re-authentication"), so
   * someone at a computer left logged in can't wipe the account. One DELETE removes the user;
   * the ON DELETE CASCADE rules in the schema remove their sessions, brokerage accounts, lots,
   * transactions, target mix and asset classes in the same statement, so it's all or nothing.
   * (DELETE requests can't be sent cross-site without passing the browser's CORS check, which
   * this API doesn't allow, so the CSRF defense still holds.)
   */
  router.delete('/me', limiter, async (req, res) => {
    const user = await findSessionUser(db, req.cookies?.[SESSION_COOKIE]);
    if (!user) throw new HttpError(401, 'Please log in.');
    const { password } = deleteAccountSchema.parse(req.body ?? {});

    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!(await bcrypt.compare(password, rows[0].password_hash))) {
      throw new HttpError(403, 'That password is wrong. Your account was not deleted.');
    }

    await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    const { maxAge, ...clearOptions } = cookieOptions(config);
    res.clearCookie(SESSION_COOKIE, clearOptions);
    res.status(204).end();
  });

  return router;
}
