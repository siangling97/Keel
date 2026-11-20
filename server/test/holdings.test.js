import { describe, it, expect } from 'vitest';
import { buildHoldings, UNCLASSIFIED } from '../src/engine/holdings.js';
import { calculateRebalanceTrades, MODES } from '../src/engine/rebalance.js';
import { projectDividendIncome } from '../src/engine/dividends.js';

const lots = [
  { accountName: 'Brokerage', ticker: 'VTI', shares: 10, costPerShare: 200 },
  { accountName: 'Roth IRA', ticker: 'VTI', shares: 5.5, costPerShare: 320 },
  { accountName: 'Roth IRA', ticker: 'BND', shares: 20, costPerShare: 72.5 },
];
const marketData = {
  VTI: { price: 300, forwardAnnualDividend: 3.6, paymentsPerYear: 4 },
  BND: { price: 70, forwardAnnualDividend: 2.45, paymentsPerYear: 12 },
};
const assetClasses = { VTI: 'US_EQUITY', BND: 'BONDS' };

describe('buildHoldings', () => {
  it('merges lots by ticker across accounts and adds price, value and gain', () => {
    const { holdings, totals, warnings } = buildHoldings({ lots, marketData, assetClasses });
    expect(holdings).toEqual([
      {
        ticker: 'VTI',
        assetClass: 'US_EQUITY',
        shares: 15.5,
        totalCostBasis: 3760, // 10 x 200 + 5.5 x 320
        currentPrice: 300,
        currentValue: 4650,
        unrealizedGain: 890,
        annualDividendPerShare: 3.6,
        paymentsPerYear: 4,
      },
      {
        ticker: 'BND',
        assetClass: 'BONDS',
        shares: 20,
        totalCostBasis: 1450,
        currentPrice: 70,
        currentValue: 1400,
        unrealizedGain: -50,
        annualDividendPerShare: 2.45,
        paymentsPerYear: 12,
      },
    ]);
    expect(totals).toEqual({ currentValue: 6050, totalCostBasis: 5210, unrealizedGain: 840 });
    expect(warnings).toEqual([]);
  });

  it('fix: a ticker with no price is left out with a warning, instead of making totals NaN', () => {
    const { holdings, missingPrices, warnings, totals } = buildHoldings({
      lots: [...lots, { ticker: 'TYPO', shares: 1, costPerShare: 10 }],
      marketData,
      assetClasses,
    });
    expect(holdings.map((h) => h.ticker)).toEqual(['VTI', 'BND']);
    expect(missingPrices).toEqual(['TYPO']);
    expect(warnings[0]).toMatch(/No price for TYPO/);
    expect(Number.isFinite(totals.currentValue)).toBe(true);
  });

  it.each([null, 0, -5, NaN])('a quote with a bad price (%s) is also left out', (price) => {
    const { holdings, missingPrices } = buildHoldings({
      lots: [{ ticker: 'BAD', shares: 1, costPerShare: 10 }],
      marketData: { BAD: { price } },
    });
    expect(holdings).toEqual([]);
    expect(missingPrices).toEqual(['BAD']);
  });

  it('marks tickers with no asset class, and assumes no dividend when data is missing', () => {
    const { holdings, warnings } = buildHoldings({
      lots: [{ ticker: 'XYZ', shares: 2, costPerShare: 10 }],
      marketData: { XYZ: { price: 12 } },
    });
    expect(holdings[0]).toMatchObject({ assetClass: UNCLASSIFIED, annualDividendPerShare: 0 });
    expect(holdings[0].paymentsPerYear).toBeUndefined();
    expect(warnings).toEqual([
      'No dividend data for XYZ. Assuming they pay no dividend.',
      'XYZ has no asset class yet.',
    ]);
  });

  it('handles fractional DRIP shares without float noise', () => {
    const { holdings } = buildHoldings({
      lots: [
        { ticker: 'VTI', shares: 0.1, costPerShare: 300 },
        { ticker: 'VTI', shares: 0.2, costPerShare: 300 },
      ],
      marketData,
      assetClasses,
    });
    expect(holdings[0].shares).toBe(0.3); // not 0.30000000000000004
  });
});

describe('the output plugs straight into the other engines', () => {
  const { holdings } = buildHoldings({ lots, marketData, assetClasses });

  it('rebalancer', () => {
    const result = calculateRebalanceTrades({
      holdings,
      targetWeights: { US_EQUITY: 0.6, BONDS: 0.4 },
      mode: MODES.FULL_REBALANCE,
    });
    expect(result.currentTotal).toBe(6050);
    expect(result.rows.map((r) => [r.assetClass, r.action])).toEqual([
      ['US_EQUITY', 'SELL'],
      ['BONDS', 'BUY'],
    ]);
  });

  it('dividend projection', () => {
    const result = projectDividendIncome({ holdings, years: 1, reinvestDividends: false });
    // 15.5 x 3.60 + 20 x 2.45 = 55.80 + 49.00
    expect(result.annualSummary[0].projectedAnnualIncome).toBe(104.8);
  });
});
