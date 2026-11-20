import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectDividendIncome } from '../src/engine/dividends.js';
import { ValidationError } from '../src/engine/errors.js';

const sample = JSON.parse(
  readFileSync(new URL('../src/sample-data/portfolio.json', import.meta.url), 'utf8')
);

/** One simple holding: 100 shares at $100, paying $4/share once a year, no growth. Easy to check by hand. */
const simpleHolding = (overrides = {}) => ({
  ticker: 'ABC',
  shares: 100,
  currentPrice: 100,
  annualDividendPerShare: 4,
  paymentsPerYear: 1,
  dividendGrowthRate: 0,
  priceGrowthRate: 0,
  ...overrides,
});

const incomes = (result) => result.annualSummary.map((y) => y.projectedAnnualIncome);

describe('without DRIP', () => {
  it('pays the same every year when nothing grows', () => {
    const result = projectDividendIncome({ holdings: [simpleHolding()], years: 3, reinvestDividends: false, currentYear: 2026 });
    expect(incomes(result)).toEqual([400, 400, 400]);
    expect(result.annualSummary[2]).toMatchObject({
      yearNumber: 3,
      year: 2029,
      projectedMonthlyAverage: 33.33,
      cumulativeIncome: 1200,
      projectedPortfolioValue: 10000, // dividends were taken as cash, shares didn't change
    });
  });

  it('grows the dividend each year by the growth rate', () => {
    const result = projectDividendIncome({
      holdings: [simpleHolding({ dividendGrowthRate: 0.05 })],
      years: 3,
      reinvestDividends: false,
    });
    expect(incomes(result)).toEqual([400, 420, 441]);
  });

  it('fix: a 0% growth rate stays 0% (the pseudocode\'s OR would have turned it into 3%)', () => {
    const result = projectDividendIncome({
      holdings: [simpleHolding({ dividendGrowthRate: 0 })],
      years: 3,
      reinvestDividends: false,
      defaultDividendGrowthRate: 0.03,
    });
    expect(incomes(result)).toEqual([400, 400, 400]); // with the bug: 400, 412, 424.36
  });

  it('uses the default growth rate when a holding has none', () => {
    const result = projectDividendIncome({
      holdings: [simpleHolding({ dividendGrowthRate: undefined })],
      years: 2,
      reinvestDividends: false,
      defaultDividendGrowthRate: 0.1,
    });
    expect(incomes(result)).toEqual([400, 440]);
    expect(result.assumptions.perHolding[0].dividendGrowthRate).toBe(0.1);
  });

  it('sample portfolio: year 1 and year 2 income', () => {
    const result = projectDividendIncome({ holdings: sample.holdings, years: 2, reinvestDividends: false });
    // 216 + 324 + 124.16 + 245 + 95 + 81
    expect(incomes(result)[0]).toBe(1085.16);
    // SCHD grows 7%, BND 0%, the rest use the 3% default
    expect(incomes(result)[1]).toBe(1123.32);
  });
});

describe('with DRIP', () => {
  it('buys more shares with each dividend, so income grows (checked by hand)', () => {
    const result = projectDividendIncome({ holdings: [simpleHolding()], years: 3, reinvestDividends: true });
    // Year 1: 100 shares x $4 = $400 -> buys 4 shares at $100 -> 104 shares
    // Year 2: 104 x $4 = $416 -> buys 4.16 shares -> 108.16 shares
    // Year 3: 108.16 x $4 = $432.64
    expect(incomes(result)).toEqual([400, 416, 432.64]);
    expect(result.annualSummary[0].projectedPortfolioValue).toBe(10400);
    expect(result.finalHoldings[0]).toEqual({ ticker: 'ABC', startShares: 100, endShares: 112.4864 });
  });

  it('fix: quarterly payers compound 4 times a year, not once', () => {
    const result = projectDividendIncome({
      holdings: [simpleHolding({ paymentsPerYear: 4 })],
      years: 1,
      reinvestDividends: true,
    });
    // $1/share per quarter: 100 + 101 + 102.01 + 103.0301 = 406.0401
    expect(incomes(result)).toEqual([406.04]);
  });

  it('when prices rise faster, DRIP buys fewer shares: less income but a bigger portfolio', () => {
    const run = (priceGrowthRate) =>
      projectDividendIncome({
        holdings: [simpleHolding({ priceGrowthRate })],
        years: 5,
        reinvestDividends: true,
      });
    const flat = run(0);
    const rising = run(0.1);
    expect(incomes(rising)[4]).toBeLessThan(incomes(flat)[4]);
    expect(rising.annualSummary[4].projectedPortfolioValue).toBeGreaterThan(
      flat.annualSummary[4].projectedPortfolioValue
    );
  });

  it('a holding with no dividend keeps the same shares', () => {
    const result = projectDividendIncome({
      holdings: [simpleHolding({ annualDividendPerShare: 0, priceGrowthRate: 0.06 })],
      years: 2,
      reinvestDividends: true,
    });
    expect(incomes(result)).toEqual([0, 0]);
    expect(result.finalHoldings[0].endShares).toBe(100);
    expect(result.annualSummary[1].projectedPortfolioValue).toBe(11236); // 100 x 100 x 1.06^2
  });

  it('sample portfolio: DRIP income is never lower, and is higher from year 2 on', () => {
    const base = { holdings: sample.holdings, years: 20 };
    const withDrip = projectDividendIncome({ ...base, reinvestDividends: true });
    const without = projectDividendIncome({ ...base, reinvestDividends: false });

    withDrip.annualSummary.forEach((year, i) => {
      expect(year.projectedAnnualIncome).toBeGreaterThanOrEqual(without.annualSummary[i].projectedAnnualIncome);
    });
    expect(withDrip.annualSummary[19].projectedAnnualIncome).toBeGreaterThan(
      without.annualSummary[19].projectedAnnualIncome
    );
  });

  it('never changes the holdings you pass in', () => {
    const holdings = [simpleHolding()];
    const before = structuredClone(holdings);
    projectDividendIncome({ holdings, years: 10, reinvestDividends: true });
    expect(holdings).toEqual(before);
  });
});

describe('validation and edge cases', () => {
  const run = (overrides) =>
    projectDividendIncome({ holdings: [simpleHolding()], years: 5, reinvestDividends: true, ...overrides });

  it('no holdings: all zeros and a warning', () => {
    const result = run({ holdings: [] });
    expect(incomes(result)).toEqual([0, 0, 0, 0, 0]);
    expect(result.warnings[0]).toMatch(/No holdings/);
  });

  it.each([
    ['years = 0', { years: 0 }, /Years must be/],
    ['years = 51', { years: 51 }, /Years must be/],
    ['years = 2.5', { years: 2.5 }, /Years must be/],
    ['reinvest is a string', { reinvestDividends: 'yes' }, /true or false/],
    ['growth typed as 5 instead of 0.05', { defaultDividendGrowthRate: 5 }, /0.03 means 3%/],
    ['price is 0', { holdings: [simpleHolding({ currentPrice: 0 })] }, /needs a price above \$0/],
    ['price is missing', { holdings: [simpleHolding({ currentPrice: undefined })] }, /Is its price missing/],
    ['negative dividend', { holdings: [simpleHolding({ annualDividendPerShare: -1 })] }, /annual dividend/],
    ['pays 3 times a year', { holdings: [simpleHolding({ paymentsPerYear: 3 })] }, /payments per year/],
    ['same ticker twice', { holdings: [simpleHolding(), simpleHolding()] }, /appears twice/],
    ['-100% growth', { holdings: [simpleHolding({ priceGrowthRate: -1 })] }, /between -1 and 1/],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => run(overrides)).toThrow(ValidationError);
    expect(() => run(overrides)).toThrow(message);
  });

  it('allows a dividend cut (negative growth)', () => {
    const result = run({ holdings: [simpleHolding({ dividendGrowthRate: -0.5 })], reinvestDividends: false, years: 2 });
    expect(incomes(result)).toEqual([400, 200]);
  });
});
