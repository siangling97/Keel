// Builds the real Express app on an in-memory PGlite database for HTTP tests.

import request from 'supertest';
import { createDb } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createApp } from '../../src/app.js';
import { createSampleMarketData } from '../../src/market/sampleMarketData.js';

export const TEST_PASSWORD = 'correct horse battery';

export async function createTestApp(configOverrides = {}) {
  const db = createDb();
  await runMigrations(db);
  const config = {
    isProduction: false,
    bcryptRounds: 4, // fast hashing for tests only
    sessionDays: 7,
    authRateLimit: 0, // off, except in the test that checks it
    trustProxy: false,
    secureCookies: false,
    ...configOverrides,
  };
  const app = createApp({ db, config, marketData: createSampleMarketData() });

  let userCount = 0;
  /** Register a new user and return a supertest agent that keeps their login cookie. */
  async function newUser() {
    const agent = request.agent(app);
    const email = `user${++userCount}-${Date.now()}@example.com`;
    const res = await agent.post('/api/auth/register').send({ email, password: TEST_PASSWORD });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { agent, email, id: res.body.user.id };
  }

  return { app, db, newUser };
}
