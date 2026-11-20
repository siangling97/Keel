import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scanTaxLossOpportunities, WASH_SALE_STATUS } from '../src/engine/taxLoss.js';
import { ValidationError } from '../src/engine/errors.js';

const sample = JSON.parse(
  readFileSync(new URL('../src/sample-data/tax-lots.json', import.meta.url), 'utf8')
);

const TODAY = '2026-11-19';
const TAXABLE = { id: 1, name: 'Brokerage', accountType: 'TAXABLE', dripEnabled: false };
const ROTH = { id: 2, name: 'Roth IRA', accountType: 'ROTH_IRA', dripEnabled: false };

/** A lot of 100 shares bought at $100. With the price at $93, it's a $700 loss. */
const lot = (overrides = {}) => ({
  id: 1,
  accountId: 1,
  ticker: 'VOO',
  shares: 100,
  costPerShare: 100,
  acquiredOn: '2025-01-15',
  ...overrides,
});

const scan = (overrides = {}) =>
  scanTaxLossOpportunities({
    asOfDate: TODAY,
    accounts: [TAXABLE, ROTH],
    lots: [lot()],
    prices: { VOO: 93, IVV: 93, VTI: 50 },
    transactions: [],
    securities: [
      { ticker: 'VOO', assetClass: 'US_EQUITY', trackedIndex: 'S&P 500' },
      { ticker: 'IVV', assetClass: 'US_EQUITY', trackedIndex: 'S&P 500' },
      { ticker: 'VTI', assetClass: 'US_EQUITY', trackedIndex: 'CRSP US Total Market' },
      { ticker: 'BND', assetClass: 'BONDS', trackedIndex: 'Bloomberg US Aggregate Float Adjusted' },
    ],
    ...overrides,
  });

describe('finding losses', () => {
  it('finds a losing lot in a taxable account', () => {
    const [opp] = scan().opportunities;
    expect(opp).toMatchObject({
      ticker: 'VOO',
      accountName: 'Brokerage',
      harvestableLoss: 700,
      longTermLoss: 700,
      shortTermLoss: 0,
      sharesToSell: 100,
    });
    expect(opp.lotsToSell[0]).toMatchObject({ lotId: 1, loss: 700, term: 'LONG_TERM' });
  });

  it('fix: skips IRA lots, because losses there cannot be deducted', () => {
    const result = scan({ lots: [lot({ accountId: 2 })] });
    expect(result.opportunities).toEqual([]);
    expect(result.summary.taxAdvantagedLotsSkipped).toBe(1);
  });

  it('fix: finds a losing lot even when the whole position is UP', () => {
    const lots = [
      lot({ id: 1, costPerShare: 100, acquiredOn: '2026-02-01' }), // -$700 at $93
      lot({ id: 2, costPerShare: 40, acquiredOn: '2019-06-01' }), // +$5,300 at $93
    ];
    const [opp] = scan({ lots }).opportunities;
    // The merged position is +$4,600, so the pseudocode would have found nothing.
    expect(opp.harvestableLoss).toBe(700);
    expect(opp.lotsToSell.map((l) => l.lotId)).toEqual([1]);
    expect(opp.lotsToSell[0].term).toBe('SHORT_TERM');
    expect(opp.warnings.join(' ')).toMatch(/specific lot identification/);
  });

  it('ignores losses under the minimum', () => {
    expect(scan({ prices: { VOO: 96 } }).opportunities).toEqual([]); // $400 loss
    expect(scan({ prices: { VOO: 96 }, minLoss: 300 }).opportunities).toHaveLength(1);
  });

  it('keeps the same ticker in two taxable accounts as two separate opportunities', () => {
    const accounts = [TAXABLE, { id: 3, name: 'Webull', accountType: 'TAXABLE' }];
    const lots = [lot({ id: 1, accountId: 1 }), lot({ id: 2, accountId: 3, shares: 200 })];
    const result = scan({ accounts, lots });
    expect(result.opportunities.map((o) => [o.accountName, o.harvestableLoss])).toEqual([
      ['Webull', 1400],
      ['Brokerage', 700],
    ]);
  });

  it('skips lots with no price, with a warning', () => {
    const result = scan({ prices: {} });
    expect(result.opportunities).toEqual([]);
    expect(result.warnings[0]).toMatch(/No current price for VOO/);
  });
});

describe('wash-sale check', () => {
  const buy = (overrides) => ({ accountId: 1, ticker: 'VOO', type: 'BUY', tradeDate: '2026-11-09', shares: 5, ...overrides });

  it('no recent buys: says so, and still says when it is safe to buy back', () => {
    const { washSale } = scan().opportunities[0];
    expect(washSale.status).toBe(WASH_SALE_STATUS.NO_RECENT_BUYS_FOUND);
    expect(washSale.doNotBuyBackBefore).toBe('2026-12-20'); // 31 days after the sale
  });

  it('fix: a buy in your IRA counts (Rev. Rul. 2008-5)', () => {
    const { washSale } = scan({ transactions: [buy({ accountId: 2 })] }).opportunities[0];
    expect(washSale.status).toBe(WASH_SALE_STATUS.RISK);
    expect(washSale.recentBuys[0]).toMatchObject({ accountName: 'Roth IRA', daysAgo: 10, reason: 'SAME_TICKER' });
  });

  it('a reinvested dividend counts as a buy', () => {
    const { washSale } = scan({ transactions: [buy({ type: 'DIVIDEND_REINVEST' })] }).opportunities[0];
    expect(washSale.status).toBe(WASH_SALE_STATUS.RISK);
  });

  it('a cash dividend does not count', () => {
    const { washSale } = scan({ transactions: [buy({ type: 'DIVIDEND_CASH' })] }).opportunities[0];
    expect(washSale.status).toBe(WASH_SALE_STATUS.NO_RECENT_BUYS_FOUND);
  });

  it('the window is exactly 30 days', () => {
    const at = (tradeDate) => scan({ transactions: [buy({ tradeDate })] }).opportunities[0].washSale.status;
    expect(at('2026-10-20')).toBe(WASH_SALE_STATUS.RISK); // 30 days ago
    expect(at('2026-10-19')).toBe(WASH_SALE_STATUS.NO_RECENT_BUYS_FOUND); // 31 days ago
  });

  it('fix: a fund on the same index (VOO and IVV, both S&P 500) is flagged', () => {
    const { washSale } = scan({ transactions: [buy({ ticker: 'IVV', accountId: 2 })] }).opportunities[0];
    expect(washSale.status).toBe(WASH_SALE_STATUS.RISK);
    expect(washSale.recentBuys[0]).toMatchObject({ ticker: 'IVV', reason: 'SAME_INDEX' });
  });

  it('a fund on a different index (VTI) is not flagged', () => {
    const { washSale } = scan({ transactions: [buy({ ticker: 'VTI' })] }).opportunities[0];
    expect(washSale.status).toBe(WASH_SALE_STATUS.NO_RECENT_BUYS_FOUND);
  });

  it('a recent lot that is itself being sold is not a replacement', () => {
    // Bought 10 days ago at $100, now $93: we sell this exact lot, so it can't "replace" itself.
    const recent = lot({ acquiredOn: '2026-11-09' });
    const result = scan({ lots: [recent], transactions: [buy({ shares: 100 })] });
    expect(result.opportunities[0].washSale.status).toBe(WASH_SALE_STATUS.NO_RECENT_BUYS_FOUND);
  });

  it('a recent lot that is NOT being sold (it is at a gain) is a replacement', () => {
    const lots = [lot({ id: 1 }), lot({ id: 2, shares: 3, costPerShare: 90, acquiredOn: '2026-11-09' })];
    const { washSale } = scan({ lots }).opportunities[0];
    expect(washSale.status).toBe(WASH_SALE_STATUS.RISK);
    expect(washSale.recentBuys).toHaveLength(1);
  });

  it('the same purchase in both transactions and lots is listed once', () => {
    const lots = [lot({ id: 1 }), lot({ id: 2, accountId: 2, shares: 5, acquiredOn: '2026-11-09' })];
    const { washSale } = scan({ lots, transactions: [buy({ accountId: 2 })] }).opportunities[0];
    expect(washSale.recentBuys).toHaveLength(1);
  });

  it('fix: warns when DRIP is on in an account that holds the fund', () => {
    const accounts = [TAXABLE, { ...ROTH, dripEnabled: true }];
    const lots = [lot({ id: 1 }), lot({ id: 2, accountId: 2, acquiredOn: '2020-01-01', costPerShare: 50 })];
    const [opp] = scan({ accounts, lots }).opportunities;
    expect(opp.warnings.join(' ')).toMatch(/DRIP is on for VOO in "Roth IRA"/);
  });
});

describe('substitutes', () => {
  it('suggests funds in the same asset class on a DIFFERENT index', () => {
    const [opp] = scan().opportunities;
    expect(opp.substitutes).toEqual([{ ticker: 'VTI', trackedIndex: 'CRSP US Total Market' }]);
    // IVV is not suggested: same S&P 500 index as VOO. BND is not suggested: different asset class.
  });

  it('suggests nothing when we know nothing about the fund', () => {
    const [opp] = scan({ securities: [] }).opportunities;
    expect(opp.substitutes).toEqual([]);
  });
});

describe('sample data', () => {
  it('finds BND, VXUS and VNQ, biggest loss first; flags VXUS (bought in the Roth 14 days ago)', () => {
    const result = scanTaxLossOpportunities(sample);
    expect(result.opportunities.map((o) => [o.ticker, o.harvestableLoss, o.washSale.status])).toEqual([
      ['BND', 800, 'NO_RECENT_BUYS_FOUND'],
      ['VXUS', 625, 'RISK'],
      ['VNQ', 600, 'NO_RECENT_BUYS_FOUND'],
    ]);
    expect(result.summary).toEqual({
      count: 3,
      totalHarvestableLoss: 2025,
      shortTermLoss: 800,
      longTermLoss: 1225,
      withWashSaleRisk: 1,
      taxAdvantagedLotsSkipped: 2,
    });
  });
});

describe('validation', () => {
  it.each([
    ['a bad date', { asOfDate: '11/19/2026' }, /YYYY-MM-DD/],
    ['an unknown account type', { accounts: [{ id: 1, name: 'X', accountType: 'SAVINGS' }] }, /unknown type/],
    ['a lot in an unknown account', { lots: [lot({ accountId: 99 })] }, /unknown account/],
    ['a lot bought in the future', { lots: [lot({ acquiredOn: '2027-01-01' })] }, /acquired after/],
    ['a lot with 0 shares', { lots: [lot({ shares: 0 })] }, /more than 0 shares/],
    ['an unknown transaction type', { transactions: [{ accountId: 1, ticker: 'VOO', type: 'GIFT', tradeDate: TODAY }] }, /Unknown transaction type/],
    ['a negative minimum loss', { minLoss: -1 }, /Minimum loss/],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => scan(overrides)).toThrow(ValidationError);
    expect(() => scan(overrides)).toThrow(message);
  });
});
