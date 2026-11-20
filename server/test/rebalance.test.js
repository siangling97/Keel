import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  calculateRebalanceTrades,
  MODES,
  ACTIONS,
  INFLOW_STRATEGIES,
} from '../src/engine/rebalance.js';
import { ValidationError } from '../src/engine/errors.js';

const sample = JSON.parse(
  readFileSync(new URL('../src/sample-data/portfolio.json', import.meta.url), 'utf8')
);

/** Find the row for one asset class. */
const rowFor = (result, assetClass) => result.rows.find((r) => r.assetClass === assetClass);

describe('validation', () => {
  const base = { holdings: sample.holdings, targetWeights: sample.targetWeights, mode: MODES.FULL_REBALANCE };

  it('rejects target weights that do not add up to 100%', () => {
    expect(() =>
      calculateRebalanceTrades({ ...base, targetWeights: { US_EQUITY: 0.6, BONDS: 0.35 } })
    ).toThrow(/add up to 95.00%/);
  });

  it('accepts weights with tiny float errors, like 0.1 + 0.2 + 0.7', () => {
    expect(() =>
      calculateRebalanceTrades({
        ...base,
        targetWeights: { US_EQUITY: 0.1 + 0.2, INTL_EQUITY: 0.4, BONDS: 0.2, REIT: 0.1 },
      })
    ).not.toThrow();
  });

  it('rejects a weight outside 0..1 (someone typed 55 instead of 0.55)', () => {
    expect(() =>
      calculateRebalanceTrades({ ...base, targetWeights: { US_EQUITY: 55, BONDS: -54 } })
    ).toThrow(ValidationError);
  });

  it('rejects an unknown mode', () => {
    expect(() => calculateRebalanceTrades({ ...base, mode: 'YOLO' })).toThrow(/Mode must be one of/);
  });

  it('rejects an unknown inflow strategy', () => {
    expect(() => calculateRebalanceTrades({ ...base, inflowStrategy: 'RANDOM' })).toThrow(
      /Inflow strategy must be one of/
    );
  });

  it('rejects negative cash', () => {
    expect(() => calculateRebalanceTrades({ ...base, newCash: -100 })).toThrow(ValidationError);
  });

  it('rejects a holding with a missing price (currentValue is NaN or null)', () => {
    const holdings = [{ ticker: 'XYZ', assetClass: 'US_EQUITY', currentValue: NaN }];
    expect(() =>
      calculateRebalanceTrades({ ...base, holdings, targetWeights: { US_EQUITY: 1 } })
    ).toThrow(/Holding XYZ needs a current value/);
  });

  it('rejects a holding with no asset class', () => {
    const holdings = [{ ticker: 'XYZ', currentValue: 100 }];
    expect(() =>
      calculateRebalanceTrades({ ...base, holdings, targetWeights: { US_EQUITY: 1 } })
    ).toThrow(/missing an asset class/);
  });
});

describe('INFLOW_ONLY mode', () => {
  const run = (newCash, overrides = {}) =>
    calculateRebalanceTrades({
      holdings: sample.holdings,
      targetWeights: sample.targetWeights,
      mode: MODES.INFLOW_ONLY,
      newCash,
      ...overrides,
    });

  it('splits new cash by how underweight each class is (sample portfolio)', () => {
    const result = run(2000);
    // Projected total = 44,000. INTL is $4,800 under target, REIT is $400 under.
    expect(rowFor(result, 'INTL_EQUITY')).toMatchObject({ action: 'BUY', tradeAmount: 1846.15, ticker: 'VXUS' });
    expect(rowFor(result, 'REIT')).toMatchObject({ action: 'BUY', tradeAmount: 153.85, ticker: 'VNQ' });
    expect(rowFor(result, 'US_EQUITY')).toMatchObject({ action: 'HOLD', tradeAmount: 0 });
    expect(rowFor(result, 'BONDS')).toMatchObject({ action: 'HOLD', tradeAmount: 0 });
    expect(result.summary).toEqual({ totalBuy: 2000, totalSell: 0, cashLeftOver: 0 });
  });

  it('fix: $0 cash gives HOLD for every row instead of no action at all', () => {
    const result = run(0);
    expect(result.rows.every((r) => r.action === ACTIONS.HOLD)).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/needs new cash/);
  });

  it('fix: a brand-new user with $0 invested gets the cash split by target weights', () => {
    const result = run(1000, { holdings: [] });
    expect(result.rows.map((r) => [r.assetClass, r.tradeAmount])).toEqual([
      ['US_EQUITY', 550],
      ['INTL_EQUITY', 200],
      ['BONDS', 150],
      ['REIT', 100],
    ]);
    result.rows.forEach((r) => {
      expect(r.currentPct).toBe(0); // no divide-by-zero (NaN)
      expect(r.projectedPct).toBeCloseTo(r.targetPct, 10);
    });
    // Owns nothing yet, so it can't guess a ticker.
    expect(result.rows.every((r) => r.ticker === null)).toBe(true);
    expect(result.warnings.some((w) => w.includes('Pick a fund'))).toBe(true);
  });

  it('uses preferred tickers when the user picks them', () => {
    const result = run(1000, { holdings: [], preferredTickers: { BONDS: 'BND', US_EQUITY: 'VTI' } });
    expect(rowFor(result, 'BONDS').ticker).toBe('BND');
    expect(rowFor(result, 'US_EQUITY').ticker).toBe('VTI');
    expect(rowFor(result, 'REIT').ticker).toBe(null);
  });

  it('buys add up to exactly the new cash, even when it does not divide evenly', () => {
    const holdings = [
      { ticker: 'A', assetClass: 'A', currentValue: 0 },
      { ticker: 'B', assetClass: 'B', currentValue: 0 },
      { ticker: 'C', assetClass: 'C', currentValue: 0 },
    ];
    const result = run(100, { holdings, targetWeights: { A: 1 / 3, B: 1 / 3, C: 1 / 3 } });
    expect(result.rows.map((r) => r.tradeAmount)).toEqual([33.34, 33.33, 33.33]);
    expect(result.summary.totalBuy).toBe(100);
  });

  it('random portfolios: never sells, spends exactly the cash, never buys past a target', () => {
    const random = seededRandom(7);
    const classes = ['US_EQUITY', 'INTL_EQUITY', 'BONDS', 'REIT', 'CASH'];

    for (let run = 0; run < 300; run++) {
      const targetWeights = randomWeights(classes, random);
      const holdings = classes.flatMap((assetClass, i) =>
        random() < 0.8 ? [{ ticker: `T${i}`, assetClass, currentValue: Math.round(random() * 5_000_000) / 100 }] : []
      );
      const newCash = Math.round(random() * 2_000_000) / 100;

      const result = calculateRebalanceTrades({ holdings, targetWeights, newCash, mode: MODES.INFLOW_ONLY });

      expect(result.rows.some((r) => r.action === ACTIONS.SELL)).toBe(false);
      expect(result.summary.totalBuy).toBeCloseTo(newCash, 2);
      for (const row of result.rows) {
        // allow 1 cent for rounding
        if (row.action === ACTIONS.BUY) expect(row.tradeAmount).toBeLessThanOrEqual(row.rawDelta + 0.01);
      }
    }
  });
});

describe('INFLOW_ONLY with BIGGEST_GAP_FIRST', () => {
  const run = (newCash, overrides = {}) =>
    calculateRebalanceTrades({
      holdings: sample.holdings,
      targetWeights: sample.targetWeights,
      mode: MODES.INFLOW_ONLY,
      inflowStrategy: INFLOW_STRATEGIES.BIGGEST_GAP_FIRST,
      newCash,
      ...overrides,
    });

  it('defaults to PROPORTIONAL when no strategy is given', () => {
    const result = calculateRebalanceTrades({
      holdings: sample.holdings,
      targetWeights: sample.targetWeights,
      mode: MODES.INFLOW_ONLY,
      newCash: 2000,
    });
    expect(result.inflowStrategy).toBe(INFLOW_STRATEGIES.PROPORTIONAL);
    expect(rowFor(result, 'REIT').tradeAmount).toBe(153.85);
  });

  it('sample portfolio: all $2,000 goes to INTL, because its gap stays bigger than REIT\'s', () => {
    const result = run(2000);
    expect(result.inflowStrategy).toBe(INFLOW_STRATEGIES.BIGGEST_GAP_FIRST);
    expect(rowFor(result, 'INTL_EQUITY')).toMatchObject({ action: 'BUY', tradeAmount: 2000 });
    expect(rowFor(result, 'REIT')).toMatchObject({ action: 'HOLD', tradeAmount: 0 });
    expect(result.summary.totalBuy).toBe(2000);
  });

  it('fills the big gap down to the small one, then fills both evenly', () => {
    // Projected total = 1,000. A wants 500 (gap 300), B wants 300 (gap 100), C is over target.
    const holdings = [
      { ticker: 'A', assetClass: 'A', currentValue: 200 },
      { ticker: 'B', assetClass: 'B', currentValue: 200 },
      { ticker: 'C', assetClass: 'C', currentValue: 300 },
    ];
    const result = run(300, { holdings, targetWeights: { A: 0.5, B: 0.3, C: 0.2 } });
    // Water level = (300 + 100 - 300) / 2 = 50. Both end $50 short of target.
    expect(rowFor(result, 'A').tradeAmount).toBe(250);
    expect(rowFor(result, 'B').tradeAmount).toBe(50);
    expect(rowFor(result, 'C').action).toBe('HOLD');
  });

  it('with enough cash to close every gap, it matches proportional', () => {
    // Gaps of 300 and 100, C is exactly on target, and the cash equals the total gap.
    const holdings = [
      { ticker: 'A', assetClass: 'A', currentValue: 200 },
      { ticker: 'B', assetClass: 'B', currentValue: 200 },
      { ticker: 'C', assetClass: 'C', currentValue: 200 },
    ];
    const targetWeights = { A: 0.5, B: 0.3, C: 0.2 };
    const gapFirst = run(400, { holdings, targetWeights });
    const prop = run(400, { holdings, targetWeights, inflowStrategy: INFLOW_STRATEGIES.PROPORTIONAL });
    expect(gapFirst.rows.map((r) => r.tradeAmount)).toEqual(prop.rows.map((r) => r.tradeAmount));
    gapFirst.rows.forEach((r) => expect(r.projectedPct).toBeCloseTo(r.targetPct, 10));
  });

  it('random portfolios: same safety rules, and it always ends at least as close to target as proportional', () => {
    const random = seededRandom(11);
    const classes = ['US_EQUITY', 'INTL_EQUITY', 'BONDS', 'REIT', 'CASH'];

    for (let run = 0; run < 300; run++) {
      const targetWeights = randomWeights(classes, random);
      const holdings = classes.flatMap((assetClass, i) =>
        random() < 0.8 ? [{ ticker: `T${i}`, assetClass, currentValue: Math.round(random() * 5_000_000) / 100 }] : []
      );
      const newCash = Math.round(random() * 2_000_000) / 100;
      const input = { holdings, targetWeights, newCash, mode: MODES.INFLOW_ONLY };

      const gapFirst = calculateRebalanceTrades({ ...input, inflowStrategy: INFLOW_STRATEGIES.BIGGEST_GAP_FIRST });
      const prop = calculateRebalanceTrades({ ...input, inflowStrategy: INFLOW_STRATEGIES.PROPORTIONAL });

      // Same safety rules as proportional.
      expect(gapFirst.rows.some((r) => r.action === ACTIONS.SELL)).toBe(false);
      expect(gapFirst.summary.totalBuy).toBeCloseTo(newCash, 2);
      for (const row of gapFirst.rows) {
        if (row.action === ACTIONS.BUY) expect(row.tradeAmount).toBeLessThanOrEqual(row.rawDelta + 0.01);
      }

      // Every class that got cash ends with the same gap (the water level, within a cent or two),
      // and that level is at least as big as any gap that got no cash.
      const leftoverGap = (r) => r.rawDelta - r.tradeAmount;
      const funded = gapFirst.rows.filter((r) => r.action === ACTIONS.BUY).map(leftoverGap);
      const unfunded = gapFirst.rows.filter((r) => r.action !== ACTIONS.BUY && r.rawDelta > 0).map(leftoverGap);
      if (funded.length > 0) {
        expect(Math.max(...funded) - Math.min(...funded)).toBeLessThanOrEqual(0.03);
        unfunded.forEach((gap) => expect(gap).toBeLessThanOrEqual(Math.min(...funded) + 0.02));
      }

      // Closer to target overall: smaller sum of squared distance from target %.
      expect(squaredDrift(gapFirst)).toBeLessThanOrEqual(squaredDrift(prop) + 1e-7);
    }
  });
});

describe('FULL_REBALANCE mode', () => {
  const run = (overrides = {}) =>
    calculateRebalanceTrades({
      holdings: sample.holdings,
      targetWeights: sample.targetWeights,
      mode: MODES.FULL_REBALANCE,
      newCash: 2000,
      ...overrides,
    });

  it('buys and sells to hit the targets exactly (sample portfolio)', () => {
    const result = run();
    expect(rowFor(result, 'US_EQUITY')).toMatchObject({ action: 'SELL', tradeAmount: 2800 });
    expect(rowFor(result, 'INTL_EQUITY')).toMatchObject({ action: 'BUY', tradeAmount: 4800 });
    expect(rowFor(result, 'BONDS')).toMatchObject({ action: 'SELL', tradeAmount: 400 });
    expect(rowFor(result, 'REIT')).toMatchObject({ action: 'BUY', tradeAmount: 400 });
    result.rows.forEach((r) => expect(r.projectedPct).toBeCloseTo(r.targetPct, 10));
    expect(result.summary).toEqual({ totalBuy: 5200, totalSell: 3200, cashLeftOver: 0 });
  });

  it('skips trades below the minimum, and the skipped money shows up as cash left over', () => {
    // BONDS and REIT are each $400 off. With a $500 minimum, both are skipped.
    const result = run({ minTrade: 500 });
    expect(rowFor(result, 'BONDS')).toMatchObject({ action: 'HOLD', tradeAmount: 0 });
    expect(rowFor(result, 'REIT')).toMatchObject({ action: 'HOLD', tradeAmount: 0 });
    // 2,000 cash + 2,800 sell - 4,800 buy = 0 left over
    expect(result.summary.cashLeftOver).toBe(0);

    const result2 = run({ minTrade: 500, newCash: 2400 });
    // Projected total 44,400. REIT needs +$440 and BONDS -$340, both under $500, so both are skipped.
    // Skipped REIT buy keeps $440 as cash; skipped BONDS sell means $340 less cash. 440 - 340 = $100 left.
    expect(rowFor(result2, 'REIT').action).toBe('HOLD');
    expect(rowFor(result2, 'BONDS').action).toBe('HOLD');
    expect(result2.summary.cashLeftOver).toBeCloseTo(100, 2);
  });

  it('fix: a class you own with no target gets a warning and is treated as 0% (sold)', () => {
    const holdings = [...sample.holdings, { ticker: 'BTC', assetClass: 'CRYPTO', currentValue: 1000 }];
    const result = run({ holdings, newCash: 0 });
    expect(rowFor(result, 'CRYPTO')).toMatchObject({ targetPct: 0, action: 'SELL', tradeAmount: 1000 });
    expect(result.warnings[0]).toMatch(/You own CRYPTO but have no target/);
  });

  it('nothing to do: no holdings and no cash', () => {
    const result = run({ holdings: [], newCash: 0 });
    expect(result.rows.every((r) => r.action === ACTIONS.HOLD)).toBe(true);
    expect(result.warnings[0]).toMatch(/Nothing to rebalance/);
  });
});

/** How far the portfolio is from target after the trades. Lower is closer. */
function squaredDrift(result) {
  return result.rows.reduce((total, r) => total + (r.projectedPct - r.targetPct) ** 2, 0);
}

function randomWeights(classes, random) {
  const raw = classes.map(() => random());
  const total = raw.reduce((a, b) => a + b);
  const weights = Object.fromEntries(classes.map((c, i) => [c, raw[i] / total]));
  return weights;
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
