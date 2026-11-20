// Builds the Express app. Nothing here opens a port or a database by itself: the caller passes in
// the database and settings. That makes the app easy to test (tests pass an in-memory database)
// and easy to deploy (Vercel runs it from api/index.js).

import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { authRoutes } from './auth/routes.js';
import { requireAuth } from './auth/sessions.js';
import { accountRoutes } from './routes/accounts.js';
import { importAndTargetRoutes } from './routes/importTargets.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { errorHandler, notFoundHandler, HttpError } from './http/errors.js';

/**
 * @param {{ db: import('./db/index.js').Db, config: ReturnType<import('./config.js').loadConfig>, marketData: { name: string, getQuotes: Function } }} deps
 */
export function createApp({ db, config, marketData }) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet()); // security headers (nosniff, no x-powered-by, frame blocking, ...)

  // API answers hold personal financial data, so browsers and proxies must not keep a copy.
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // CSRF defense, part 2 (part 1 is the SameSite cookie): writes must be JSON. A malicious site
  // can submit an HTML form to our API, but a form can't send Content-Type: application/json,
  // and a cross-site fetch with that header is blocked by the browser's CORS check.
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      throw new HttpError(415, 'Send JSON with Content-Type: application/json.');
    }
    next();
  });

  // For uptime checks: is the app up, and can it reach the database?
  app.get('/api/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true, database: 'ok' });
    } catch (err) {
      console.error('Health check: database unreachable', err.message);
      res.status(503).json({ ok: false, database: 'unreachable' });
    }
  });
  app.use('/api/auth', authRoutes({ db, config }));

  // Everything below needs a logged-in user (checked once per request).
  app.use('/api', requireAuth(db));
  app.use('/api', accountRoutes({ db }));
  app.use('/api', importAndTargetRoutes({ db }));
  app.use('/api/portfolio', portfolioRoutes({ db, marketData }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
