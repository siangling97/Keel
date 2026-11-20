import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestApp } from './helpers/testApp.js';

const sampleCsv = readFileSync(new URL('../src/sample-data/sample-import.csv', import.meta.url), 'utf8');
const HEADER = 'Account,Account Type,Ticker,Shares,Cost Per Share,Acquired On,Asset Class';
const TARGETS = [
  { assetClass: 'US_EQUITY', weight: 0.55 },
  { assetClass: 'INTL_EQUITY', weight: 0.2 },
  { assetClass: 'BONDS', weight: 0.15 },
  { assetClass: 'REIT', weight: 0.1 },
];

let newUser, db;
beforeAll(async () => {
  ({ newUser, db } = await createTestApp());
});

const importFile = (agent, text, extra = {}) =>
  agent.post('/api/import').send({ files: [{ name: 'test.csv', text }], ...extra });

describe('accounts', () => {
  it('create, list, update and delete', async () => {
    const { agent } = await newUser();
    const created = await agent.post('/api/accounts').send({ name: 'Roth', accountType: 'ROTH_IRA' });
    expect(created.status).toBe(201);
    expect(created.body.account).toMatchObject({ name: 'Roth', accountType: 'ROTH_IRA', broker: 'OTHER', dripEnabled: false });
    const id = created.body.account.id;

    const updated = await agent.patch(`/api/accounts/${id}`).send({ dripEnabled: true });
    expect(updated.body.account.dripEnabled).toBe(true);

    expect((await agent.get('/api/accounts')).body.accounts).toHaveLength(1);
    expect((await agent.delete(`/api/accounts/${id}`)).status).toBe(204);
    expect((await agent.get('/api/accounts')).body.accounts).toHaveLength(0);
  });

  it('names are unique per user, ignoring case', async () => {
    const { agent } = await newUser();
    await agent.post('/api/accounts').send({ name: 'Brokerage', accountType: 'TAXABLE' });
    const dup = await agent.post('/api/accounts').send({ name: 'BROKERAGE', accountType: 'TAXABLE' });
    expect(dup.status).toBe(409);
  });

  it('rejects unknown fields, so nobody can set user_id through the body', async () => {
    const { agent } = await newUser();
    const res = await agent.post('/api/accounts').send({ name: 'X', accountType: 'TAXABLE', userId: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects a bad id in the URL', async () => {
    const { agent } = await newUser();
    expect((await agent.patch('/api/accounts/abc').send({ dripEnabled: true })).status).toBe(400);
  });
});

describe("users can't see or change each other's data (IDOR)", () => {
  let alice, bob, aliceAccountId, aliceLotId;

  beforeAll(async () => {
    alice = await newUser();
    bob = await newUser();
    aliceAccountId = (await alice.agent.post('/api/accounts').send({ name: 'Alice Brokerage', accountType: 'TAXABLE' })).body.account.id;
    aliceLotId = (
      await alice.agent.post('/api/lots').send({ accountId: aliceAccountId, ticker: 'VTI', shares: 10, costPerShare: 200, acquiredOn: '2024-01-02' })
    ).body.lot.id;
  });

  it("Bob's lists don't include Alice's data", async () => {
    expect((await bob.agent.get('/api/accounts')).body.accounts).toEqual([]);
    expect((await bob.agent.get('/api/lots')).body.lots).toEqual([]);
  });

  it("Bob gets 404 (not 403) for Alice's account, so he can't even tell it exists", async () => {
    expect((await bob.agent.patch(`/api/accounts/${aliceAccountId}`).send({ name: 'hacked' })).status).toBe(404);
    expect((await bob.agent.delete(`/api/accounts/${aliceAccountId}`)).status).toBe(404);
  });

  it("Bob can't add a lot to Alice's account or delete Alice's lot", async () => {
    const add = await bob.agent.post('/api/lots').send({ accountId: aliceAccountId, ticker: 'VTI', shares: 1, costPerShare: 1, acquiredOn: '2024-01-02' });
    expect(add.status).toBe(404);
    expect((await bob.agent.delete(`/api/lots/${aliceLotId}`)).status).toBe(404);
  });

  it("Alice's data is untouched", async () => {
    const { body } = await alice.agent.get('/api/lots');
    expect(body.lots).toHaveLength(1);
    expect((await alice.agent.get('/api/accounts')).body.accounts[0].name).toBe('Alice Brokerage');
  });
});

describe('lots (manual entry)', () => {
  it('cleans the ticker and date like the importer does', async () => {
    const { agent } = await newUser();
    const accountId = (await agent.post('/api/accounts').send({ name: 'B', accountType: 'TAXABLE' })).body.account.id;
    const res = await agent.post('/api/lots').send({ accountId, ticker: 'brk.b', shares: 2, costPerShare: 400, acquiredOn: '03/15/2024', assetClass: 'us equity' });
    expect(res.status).toBe(201);
    expect(res.body.lot).toMatchObject({ ticker: 'BRK-B', shares: 2, costPerShare: 400, acquiredOn: '2024-03-15', accountName: 'B' });
  });

  it.each([
    ['0 shares', { shares: 0 }, 'shares'],
    ['a future date', { acquiredOn: '2999-01-01' }, 'acquiredOn'],
    ['a bad ticker', { ticker: '$$$' }, 'ticker'],
    ['shares as text', { shares: '10' }, 'shares'],
  ])('rejects %s', async (_label, change, field) => {
    const { agent } = await newUser();
    const accountId = (await agent.post('/api/accounts').send({ name: 'B', accountType: 'TAXABLE' })).body.account.id;
    const res = await agent.post('/api/lots').send({ accountId, ticker: 'VTI', shares: 1, costPerShare: 1, acquiredOn: '2024-01-02', ...change });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });
});

describe('import', () => {
  it('dry run shows a preview and saves nothing', async () => {
    const { agent } = await newUser();
    const res = await importFile(agent, sampleCsv, { dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(false);
    expect(res.body.stats.lotsImported).toBe(8);
    expect((await agent.get('/api/lots')).body.lots).toEqual([]);
  });

  it('saves accounts, lots and asset classes', async () => {
    const { agent } = await newUser();
    const res = await importFile(agent, sampleCsv, { broker: 'FIDELITY' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ saved: true, lotsSaved: 8, skippedDuplicates: 0 });
    expect(res.body.createdAccounts).toEqual(['Fidelity Brokerage', 'Vanguard Roth IRA', 'Webull Individual']);
    expect((await agent.get('/api/lots')).body.lots).toHaveLength(8);
  });

  it('uploading the same file twice does not double the portfolio', async () => {
    const { agent } = await newUser();
    await importFile(agent, sampleCsv);
    const again = await importFile(agent, sampleCsv);
    expect(again.body).toMatchObject({ lotsSaved: 0, skippedDuplicates: 8, createdAccounts: [] });
    expect((await agent.get('/api/lots')).body.lots).toHaveLength(8);
  });

  it('with any row error, nothing is saved (all or nothing)', async () => {
    const { agent } = await newUser();
    const text = [HEADER, 'A,Taxable,VTI,10,100,2024-01-02,US_EQUITY', 'A,Taxable,BND,abc,70,2024-01-02,BONDS'].join('\n');
    const res = await importFile(agent, text);
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([{ field: 'test.csv line 3', message: 'Shares: "abc" is not a number.' }]);
    expect((await agent.get('/api/accounts')).body.accounts).toEqual([]);
  });

  it('an account type that clashes with a saved account rolls back the whole import', async () => {
    const { agent } = await newUser();
    await agent.post('/api/accounts').send({ name: 'Main', accountType: 'ROTH_IRA' });
    const text = [HEADER, 'New One,Taxable,VTI,1,100,2024-01-02,', 'Main,Taxable,BND,1,70,2024-01-02,'].join('\n');
    const res = await importFile(agent, text);
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].message).toMatch(/"Main" is already saved as ROTH_IRA/);
    // "New One" was created inside the transaction, then rolled back.
    expect((await agent.get('/api/accounts')).body.accounts.map((a) => a.name)).toEqual(['Main']);
  });

  it('lists the supported formats', async () => {
    const { agent } = await newUser();
    expect((await agent.get('/api/import/formats')).body.formats[0].id).toBe('TEMPLATE');
  });
});

describe('targets', () => {
  it('saves and returns the target mix', async () => {
    const { agent } = await newUser();
    const res = await agent.put('/api/targets').send({ targets: [...TARGETS.slice(0, 3), { assetClass: 'REIT', weight: 0.1, preferredTicker: 'vnq' }] });
    expect(res.status).toBe(200);
    expect(res.body.targetWeights).toEqual({ US_EQUITY: 0.55, INTL_EQUITY: 0.2, BONDS: 0.15, REIT: 0.1 });
    expect(res.body.preferredTickers).toEqual({ REIT: 'VNQ' });
  });

  it.each([
    ['weights that add up to 95%', [{ assetClass: 'A', weight: 0.6 }, { assetClass: 'B', weight: 0.35 }], /add up to 100%/],
    ['55 instead of 0.55', [{ assetClass: 'A', weight: 55 }], /0.55 means 55%/],
    ['the same class twice', [{ assetClass: 'A', weight: 0.5 }, { assetClass: 'a', weight: 0.5 }], /only once/],
  ])('rejects %s', async (_label, targets, message) => {
    const { agent } = await newUser();
    const res = await agent.put('/api/targets').send({ targets });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(message);
  });
});

describe('engines over HTTP (same numbers as the step 1-4 demos)', () => {
  let agent;
  beforeAll(async () => {
    ({ agent } = await newUser());
    await importFile(agent, sampleCsv);
    await agent.put('/api/targets').send({ targets: TARGETS });
  });

  it('holdings', async () => {
    const res = await agent.get('/api/portfolio/holdings');
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ currentValue: 37300, totalCostBasis: 34260, unrealizedGain: 3040 });
    expect(res.body.holdings.map((h) => h.ticker)).toEqual(['VTI', 'BND', 'VXUS', 'VNQ', 'O']);
    expect(res.body.priceSource).toMatch(/sample/);
  });

  it('rebalance', async () => {
    const res = await agent.post('/api/portfolio/rebalance').send({ mode: 'INFLOW_ONLY', newCash: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => [r.assetClass, r.action, r.tradeAmount])).toEqual([
      ['US_EQUITY', 'BUY', 535.37],
      ['INTL_EQUITY', 'BUY', 464.63],
      ['BONDS', 'HOLD', 0],
      ['REIT', 'HOLD', 0],
    ]);
  });

  it('rebalance needs targets first', async () => {
    const { agent: fresh } = await newUser();
    const res = await fresh.post('/api/portfolio/rebalance').send({ mode: 'FULL_REBALANCE' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/target mix/);
  });

  it('engine validation errors come back as 400 with the engine message', async () => {
    const res = await agent.post('/api/portfolio/dividends').send({ years: 5, defaultDividendGrowthRate: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/0.03 means 3%/);
  });

  it('dividends', async () => {
    const res = await agent.post('/api/portfolio/dividends').send({ years: 10, reinvestDividends: true });
    expect(res.status).toBe(200);
    expect(res.body.annualSummary).toHaveLength(10);
    expect(res.body.annualSummary[0].projectedAnnualIncome).toBe(920.95);
  });

  it('tax-loss scan, with the date the browser sends', async () => {
    const res = await agent.get('/api/portfolio/tax-loss?asOfDate=2026-11-19');
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ count: 3, totalHarvestableLoss: 2025, withWashSaleRisk: 1, taxAdvantagedLotsSkipped: 2 });
    // Substitutes come from the securities seeded by migration 003.
    const vxus = res.body.opportunities.find((o) => o.ticker === 'VXUS');
    expect(vxus.substitutes.map((s) => s.ticker)).toEqual(['IXUS']);
  });

  it('turning DRIP on in the Roth adds a warning to the scan', async () => {
    const roth = (await agent.get('/api/accounts')).body.accounts.find((a) => a.accountType === 'ROTH_IRA');
    await agent.patch(`/api/accounts/${roth.id}`).send({ dripEnabled: true });
    const res = await agent.get('/api/portfolio/tax-loss?asOfDate=2026-11-19');
    const vxus = res.body.opportunities.find((o) => o.ticker === 'VXUS');
    expect(vxus.warnings.join(' ')).toMatch(/DRIP is on/);
  });

  it('classifying a ticker changes the rebalance', async () => {
    await agent.put('/api/asset-classes').send({ O: 'US_EQUITY' });
    const res = await agent.post('/api/portfolio/rebalance').send({ mode: 'FULL_REBALANCE' });
    const us = res.body.rows.find((r) => r.assetClass === 'US_EQUITY');
    expect(us.currentValue).toBe(19500); // VTI 18,000 + O 1,500
  });
});

describe('unknown routes', () => {
  it('logged-in users get a JSON 404', async () => {
    const { agent } = await newUser();
    const res = await agent.get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/No route/);
  });

  it('server errors never leak details', async () => {
    const { agent } = await newUser();
    const original = db.query;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {}); // the error is logged on purpose
    db.query = async () => {
      throw new Error('secret SQL detail');
    };
    try {
      const res = await agent.get('/api/accounts');
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toMatch(/secret/);
    } finally {
      db.query = original;
      quiet.mockRestore();
    }
  });
});
