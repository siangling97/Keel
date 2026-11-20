import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, TEST_PASSWORD } from './helpers/testApp.js';

let app, db, newUser;
beforeAll(async () => {
  ({ app, db, newUser } = await createTestApp());
});

const sessionCookie = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('sid='));

describe('register', () => {
  it('creates the user, logs them in with an httpOnly cookie, and lowercases the email', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: '  New@Example.COM ', password: TEST_PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('new@example.com');
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(res.body).not.toHaveProperty('user.password_hash');
  });

  it('stores a bcrypt hash, never the password', async () => {
    const { email } = await newUser();
    const { rows } = await db.query('SELECT password_hash FROM users WHERE email = $1', [email]);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
    expect(rows[0].password_hash).not.toContain(TEST_PASSWORD);
  });

  it('refuses a second account with the same email, ignoring case', async () => {
    const { email } = await newUser();
    const res = await request(app).post('/api/auth/register').send({ email: email.toUpperCase(), password: TEST_PASSWORD });
    expect(res.status).toBe(409);
  });

  it.each([
    ['a bad email', { email: 'not-an-email', password: TEST_PASSWORD }, 'email'],
    ['a short password', { email: 'a@example.com', password: 'short' }, 'password'],
    ['a password over 72 bytes (bcrypt would cut it)', { email: 'a@example.com', password: 'é'.repeat(37) }, 'password'],
    ['an extra field', { email: 'a@example.com', password: TEST_PASSWORD, isAdmin: true }, null],
  ])('rejects %s with 400', async (_label, body, field) => {
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
    if (field) expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });
});

describe('login and logout', () => {
  it('logs in with the right password (email in any case)', async () => {
    const { email } = await newUser();
    const res = await request(app).post('/api/auth/login').send({ email: email.toUpperCase(), password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).toBeDefined();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { email } = await newUser();
    const wrongPassword = await request(app).post('/api/auth/login').send({ email, password: 'wrong password!!' });
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: TEST_PASSWORD });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('logout ends the session on the server, so a copied cookie stops working', async () => {
    const { agent } = await newUser();
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    const stolenCookie = me.request.cookies; // what an attacker might have copied

    const out = await agent.post('/api/auth/logout').send({});
    expect(out.status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', stolenCookie)).status).toBe(401);
  });

  it('stores only a hash of the session token', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'hashcheck@example.com', password: TEST_PASSWORD });
    const token = sessionCookie(res).split(';')[0].slice('sid='.length);
    const { rows } = await db.query('SELECT token_hash FROM sessions WHERE user_id = $1', [res.body.user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an expired session is rejected', async () => {
    const { agent, id } = await newUser();
    await db.query(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [id]);
    expect((await agent.get('/api/accounts')).status).toBe(401);
  });

  it('a made-up cookie is rejected', async () => {
    const res = await request(app).get('/api/accounts').set('Cookie', 'sid=made-up-token');
    expect(res.status).toBe(401);
  });
});

describe('protection', () => {
  it.each([
    ['GET', '/api/accounts'],
    ['GET', '/api/lots'],
    ['GET', '/api/targets'],
    ['GET', '/api/portfolio/holdings'],
    ['GET', '/api/portfolio/tax-loss'],
    ['POST', '/api/portfolio/rebalance'],
    ['POST', '/api/import'],
  ])('%s %s needs login', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path).send({});
    expect(res.status).toBe(401);
  });

  it('rejects writes that are not JSON (blocks HTML-form CSRF)', async () => {
    const res = await request(app).post('/api/auth/login').type('form').send({ email: 'a@example.com', password: 'x' });
    expect(res.status).toBe(415);
  });

  it('sends security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('bad JSON gets a 400, not a crash', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not valid JSON/);
  });

  it('rate-limits password guessing', async () => {
    const limited = await createTestApp({ authRateLimit: 3 });
    const tries = [];
    for (let i = 0; i < 4; i++) {
      tries.push((await request(limited.app).post('/api/auth/login').send({ email: 'x@example.com', password: 'guess' + i })).status);
    }
    expect(tries).toEqual([401, 401, 401, 429]);
  });
});

describe('delete my account', () => {
  /** A user with something in every table that belongs to them. */
  async function userWithData() {
    const u = await newUser();
    const accountId = (await u.agent.post('/api/accounts').send({ name: 'Brokerage', accountType: 'TAXABLE' })).body.account.id;
    await u.agent.post('/api/lots').send({ accountId, ticker: 'VTI', shares: 5, costPerShare: 200, acquiredOn: '2024-01-02', assetClass: 'US_EQUITY' });
    await u.agent.put('/api/targets').send({ targets: [{ assetClass: 'US_EQUITY', weight: 1 }] });
    await db.query(
      `INSERT INTO transactions (account_id, ticker, type, trade_date, shares, price, amount) VALUES ($1, 'VTI', 'BUY', '2024-01-02', 5, 200, 1000)`,
      [accountId]
    );
    return { ...u, accountId };
  }

  /** How many rows this user still has in each of their tables. */
  async function rowsLeft(userId, accountId) {
    const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;
    return {
      users: await count('SELECT count(*)::int AS n FROM users WHERE id = $1', [userId]),
      sessions: await count('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [userId]),
      accounts: await count('SELECT count(*)::int AS n FROM accounts WHERE user_id = $1', [userId]),
      lots: await count('SELECT count(*)::int AS n FROM lots WHERE account_id = $1', [accountId]),
      transactions: await count('SELECT count(*)::int AS n FROM transactions WHERE account_id = $1', [accountId]),
      targets: await count('SELECT count(*)::int AS n FROM target_allocations WHERE user_id = $1', [userId]),
      assetClasses: await count('SELECT count(*)::int AS n FROM user_securities WHERE user_id = $1', [userId]),
    };
  }

  it('deletes the user and everything that belongs to them, and logs them out', async () => {
    const { agent, id, accountId } = await userWithData();
    expect(Object.values(await rowsLeft(id, accountId)).every((n) => n > 0)).toBe(true);

    const res = await agent.delete('/api/auth/me').send({ password: TEST_PASSWORD });
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'].join(';')).toMatch(/sid=;/); // cookie cleared

    expect(await rowsLeft(id, accountId)).toEqual({
      users: 0, sessions: 0, accounts: 0, lots: 0, transactions: 0, targets: 0, assetClasses: 0,
    });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('a copied session cookie stops working, and the old password no longer logs in', async () => {
    const { agent, email } = await userWithData();
    const copiedCookie = (await agent.get('/api/auth/me')).request.cookies;
    await agent.delete('/api/auth/me').send({ password: TEST_PASSWORD });

    expect((await request(app).get('/api/accounts').set('Cookie', copiedCookie)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email, password: TEST_PASSWORD })).status).toBe(401);
  });

  it('the same email can sign up again afterwards, starting empty', async () => {
    const { agent, email } = await userWithData();
    await agent.delete('/api/auth/me').send({ password: TEST_PASSWORD });

    const again = request.agent(app);
    expect((await again.post('/api/auth/register').send({ email, password: TEST_PASSWORD })).status).toBe(201);
    expect((await again.get('/api/accounts')).body.accounts).toEqual([]);
  });

  it('a wrong password deletes nothing', async () => {
    const { agent, id, accountId } = await userWithData();
    const res = await agent.delete('/api/auth/me').send({ password: 'not my password' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/was not deleted/);
    expect(Object.values(await rowsLeft(id, accountId)).every((n) => n > 0)).toBe(true);
    expect((await agent.get('/api/auth/me')).status).toBe(200); // still logged in
  });

  it('asks for the password', async () => {
    const { agent } = await userWithData();
    const res = await agent.delete('/api/auth/me').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toEqual({ field: 'password', message: 'Enter your password to confirm.' });
  });

  it('needs login', async () => {
    expect((await request(app).delete('/api/auth/me').send({ password: TEST_PASSWORD })).status).toBe(401);
  });

  it("doesn't touch anyone else's data", async () => {
    const alice = await userWithData();
    const bob = await userWithData();
    await bob.agent.delete('/api/auth/me').send({ password: TEST_PASSWORD });
    expect(Object.values(await rowsLeft(alice.id, alice.accountId)).every((n) => n > 0)).toBe(true);
    expect((await alice.agent.get('/api/lots')).body.lots).toHaveLength(1);
  });
});
