// Demo mode runs the server's engine code in the browser. These tests check it gives the same
// answers as the API tests in server/test/api.portfolio.test.js, and follows the same rules.

import { describe, it, expect, beforeEach } from 'vitest';
import { createDemoApi } from '../api/demoApi.js';
import { localToday } from '../lib/format.js';

const HEADER = 'Account,Account Type,Ticker,Shares,Cost Per Share,Acquired On,Asset Class';
let api;
beforeEach(() => {
  sessionStorage.clear();
  api = createDemoApi();
});

describe('sample portfolio (same numbers as the server)', () => {
  it('holdings', async () => {
    const { totals, holdings } = await api.holdings();
    expect(totals).toEqual({ currentValue: 37300, totalCostBasis: 34260, unrealizedGain: 3040 });
    expect(holdings.map((h) => h.ticker)).toEqual(['VTI', 'BND', 'VXUS', 'VNQ', 'O']);
  });

  it('rebalance, both ways of splitting the cash', async () => {
    const spread = await api.rebalance({ mode: 'INFLOW_ONLY', newCash: 1000 });
    expect(spread.rows.filter((r) => r.action === 'BUY').map((r) => [r.assetClass, r.tradeAmount])).toEqual([
      ['US_EQUITY', 535.37],
      ['INTL_EQUITY', 464.63],
    ]);
    const gapsFirst = await api.rebalance({ mode: 'INFLOW_ONLY', newCash: 1000, inflowStrategy: 'BIGGEST_GAP_FIRST' });
    expect(gapsFirst.rows.filter((r) => r.action === 'BUY').map((r) => [r.assetClass, r.tradeAmount])).toEqual([
      ['US_EQUITY', 702.5],
      ['INTL_EQUITY', 297.5],
    ]);
  });

  it('tax-loss: the Roth purchase is always "14 days ago", so the demo shows a wash-sale risk on any day', async () => {
    const scan = await api.taxLoss({ asOfDate: localToday() });
    expect(scan.summary).toMatchObject({ count: 3, totalHarvestableLoss: 2025, withWashSaleRisk: 1 });
    const vxus = scan.opportunities.find((o) => o.ticker === 'VXUS');
    expect(vxus.washSale.recentBuys[0]).toMatchObject({ accountName: 'Vanguard Roth IRA', daysAgo: 14 });
    expect(vxus.warnings.join(' ')).toMatch(/DRIP is on/);
  });

  it('engine errors come back as 400s, like the API', async () => {
    await expect(api.dividends({ years: 5, defaultDividendGrowthRate: 5 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('changes', () => {
  it('survive a reload of the page (same tab), and reset on leaving the demo', async () => {
    const { accounts } = await api.listAccounts();
    await api.deleteAccount(accounts[0].id);
    expect((await createDemoApi().listAccounts()).accounts).toHaveLength(2); // a "reload"
    await api.logout();
    expect((await createDemoApi().listAccounts()).accounts).toHaveLength(3);
  });

  it('deleting an account deletes its purchases', async () => {
    const before = (await api.listLots()).lots.length;
    const fidelity = (await api.listAccounts()).accounts.find((a) => a.name === 'Fidelity Brokerage');
    await api.deleteAccount(fidelity.id);
    expect((await api.listLots()).lots.length).toBe(before - 4);
  });

  it('adding a purchase cleans the ticker and date, and rejects bad input', async () => {
    const [account] = (await api.listAccounts()).accounts;
    const { lot } = await api.createLot({ accountId: account.id, ticker: 'brk.b', shares: 2, costPerShare: 400, acquiredOn: '03/15/2024' });
    expect(lot).toMatchObject({ ticker: 'BRK-B', acquiredOn: '2024-03-15', accountName: account.name });
    await expect(api.createLot({ accountId: account.id, ticker: 'VTI', shares: 0, costPerShare: 1, acquiredOn: '2024-01-01' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(api.createLot({ accountId: 999, ticker: 'VTI', shares: 1, costPerShare: 1, acquiredOn: '2024-01-01' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('target weights must add up to 100%', async () => {
    await expect(api.saveTargets([{ assetClass: 'BONDS', weight: 0.5 }])).rejects.toMatchObject({ status: 400 });
    const saved = await api.saveTargets([
      { assetClass: 'US_EQUITY', weight: 0.7 },
      { assetClass: 'BONDS', weight: 0.3, preferredTicker: 'bnd' },
    ]);
    expect(saved).toEqual({ targetWeights: { US_EQUITY: 0.7, BONDS: 0.3 }, preferredTickers: { BONDS: 'BND' } });
  });
});

describe('import (same rules as the server)', () => {
  const file = (rows) => [{ name: 'mine.csv', text: [HEADER, ...rows].join('\n') }];

  it('dry run saves nothing; saving adds the rows; the same file again is skipped', async () => {
    const rows = ['New Account,Taxable,SCHD,10,25,2024-01-02,US_EQUITY'];
    const preview = await api.importFiles({ files: file(rows), dryRun: true });
    expect(preview).toMatchObject({ saved: false, stats: { lotsImported: 1 } });
    expect((await api.listAccounts()).accounts).toHaveLength(3);

    const saved = await api.importFiles({ files: file(rows), dryRun: false });
    expect(saved).toMatchObject({ saved: true, lotsSaved: 1, createdAccounts: ['New Account'] });

    const again = await api.importFiles({ files: file(rows), dryRun: false });
    expect(again).toMatchObject({ lotsSaved: 0, skippedDuplicates: 1 });
  });

  it('a file with an error saves nothing', async () => {
    await expect(
      api.importFiles({ files: file(['A,Taxable,VTI,1,100,2024-01-02,', 'A,Taxable,BND,abc,70,2024-01-02,']), dryRun: false })
    ).rejects.toMatchObject({ status: 422, details: [{ field: 'mine.csv line 3' }] });
    expect((await api.listAccounts()).accounts).toHaveLength(3);
  });

  it('an account type that clashes with a saved account is refused', async () => {
    await expect(
      api.importFiles({ files: file(['Vanguard Roth IRA,Taxable,VTI,1,100,2024-01-02,']), dryRun: false })
    ).rejects.toMatchObject({ status: 422 });
  });
});
