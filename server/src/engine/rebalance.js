// Rebalancing engine (module 2 of the pseudocode).
//
// Input:  the user's holdings (already merged across brokers), target weights per asset class,
//         optional new cash, and a mode.
// Output: one row per asset class with BUY / SELL / HOLD and a dollar amount.
//
// This file is "pure": no database, no network, no Express. Same input always gives the
// same output. That makes it easy to test and easy to reuse from the API later.

import { ValidationError } from './errors.js';
import { toCents, fromCents, roundDollars, splitCents } from './money.js';

export const MODES = Object.freeze({
  INFLOW_ONLY: 'INFLOW_ONLY', // only use new cash to buy underweight classes; never sell
  FULL_REBALANCE: 'FULL_REBALANCE', // buy and sell to hit the targets
});

export const ACTIONS = Object.freeze({ BUY: 'BUY', SELL: 'SELL', HOLD: 'HOLD' });

/** How INFLOW_ONLY mode splits the new cash. The user picks one. */
export const INFLOW_STRATEGIES = Object.freeze({
  // Every underweight class gets a share, sized by how underweight it is.
  PROPORTIONAL: 'PROPORTIONAL',
  // Fill the biggest gap first, until it's level with the next one, then fill both together.
  // Gets the portfolio as close to target as possible with the cash you have.
  BIGGEST_GAP_FIRST: 'BIGGEST_GAP_FIRST',
});

/** In full rebalance mode, skip trades smaller than this (in dollars). */
export const DEFAULT_MIN_TRADE = 25;

/** Target weights may be off by this much from 100% (helps with 0.1 + 0.2 style float errors). */
const WEIGHT_TOLERANCE = 0.0001;

/**
 * @typedef {Object} Holding
 * @property {string} ticker        e.g. "VTI"
 * @property {string} assetClass    e.g. "US_EQUITY"
 * @property {number} currentValue  dollars
 */

/**
 * @typedef {Object} RebalanceInput
 * @property {Holding[]} holdings
 * @property {Record<string, number>} targetWeights  e.g. { US_EQUITY: 0.6, BONDS: 0.4 }. Must add up to 1.
 * @property {'INFLOW_ONLY'|'FULL_REBALANCE'} mode
 * @property {number} [newCash=0]                    dollars to invest now
 * @property {'PROPORTIONAL'|'BIGGEST_GAP_FIRST'} [inflowStrategy='PROPORTIONAL']  inflow-only only: how to split the cash
 * @property {number} [minTrade=25]                  full rebalance only: ignore smaller trades
 * @property {Record<string, string>} [preferredTickers]  which ticker to buy for each class, e.g. { BONDS: "BND" }
 */

/**
 * @typedef {Object} RebalanceRow
 * @property {string} assetClass
 * @property {string|null} ticker     what to trade for this class (null = user must pick one)
 * @property {number} currentValue
 * @property {number} currentPct      0..1, share of the current portfolio
 * @property {number} targetPct       0..1
 * @property {number} targetValue     dollars this class should have after the new cash
 * @property {number} rawDelta        targetValue - currentValue. Positive = underweight.
 * @property {'BUY'|'SELL'|'HOLD'} action
 * @property {number} tradeAmount     dollars, always >= 0
 * @property {number} projectedPct    0..1, share of the portfolio after the trades
 */

/**
 * Work out which asset classes to buy or sell.
 * @param {RebalanceInput} input
 */
export function calculateRebalanceTrades(input) {
  validateInput(input);

  const {
    holdings,
    targetWeights,
    mode,
    newCash = 0,
    inflowStrategy = INFLOW_STRATEGIES.PROPORTIONAL,
    minTrade = DEFAULT_MIN_TRADE,
    preferredTickers = {},
  } = input;

  const warnings = [];

  // Group holdings by asset class.
  const holdingsByClass = new Map();
  for (const holding of holdings) {
    if (!holdingsByClass.has(holding.assetClass)) holdingsByClass.set(holding.assetClass, []);
    holdingsByClass.get(holding.assetClass).push(holding);
  }

  // Every class with a target, plus any class the user owns but has no target for.
  // Fix: the pseudocode skipped those without a warning. Here they get a 0% target and a warning,
  // so the totals still add up and the user sees it.
  const assetClasses = Object.keys(targetWeights);
  for (const assetClass of holdingsByClass.keys()) {
    if (!(assetClass in targetWeights)) {
      assetClasses.push(assetClass);
      warnings.push(
        `You own ${assetClass} but have no target for it, so it is treated as a 0% target.`
      );
    }
  }

  const currentTotal = sum(holdings.map((h) => h.currentValue));
  const projectedTotal = currentTotal + newCash;

  if (projectedTotal === 0) {
    warnings.push('Nothing to rebalance yet: no holdings and no new cash.');
  }

  /** @type {(RebalanceRow & { _exactDelta: number })[]} */
  const rows = assetClasses.map((assetClass) => {
    const classHoldings = holdingsByClass.get(assetClass) ?? [];
    const currentValue = sum(classHoldings.map((h) => h.currentValue));
    const targetPct = targetWeights[assetClass] ?? 0;
    const targetValue = projectedTotal * targetPct;
    const exactDelta = targetValue - currentValue;

    return {
      assetClass,
      ticker: pickTicker(assetClass, classHoldings, preferredTickers),
      currentValue: roundDollars(currentValue),
      // Fix: a brand-new user has currentTotal = 0. The pseudocode divided by zero here.
      currentPct: currentTotal > 0 ? currentValue / currentTotal : 0,
      targetPct,
      targetValue: roundDollars(targetValue),
      rawDelta: roundDollars(exactDelta),
      action: ACTIONS.HOLD,
      tradeAmount: 0,
      projectedPct: 0,
      _exactDelta: exactDelta, // unrounded, used for the math below
    };
  });

  if (mode === MODES.INFLOW_ONLY) {
    applyInflowOnly(rows, newCash, inflowStrategy, warnings);
  } else {
    applyFullRebalance(rows, minTrade);
  }

  // Where each class ends up after the trades.
  for (const row of rows) {
    const change =
      row.action === ACTIONS.BUY ? row.tradeAmount : row.action === ACTIONS.SELL ? -row.tradeAmount : 0;
    row.projectedPct = projectedTotal > 0 ? (row.currentValue + change) / projectedTotal : 0;
    delete row._exactDelta;
  }

  // "Buy $500 of BONDS" is not something a user can act on, so ask them to pick a fund.
  for (const row of rows) {
    if (row.action === ACTIONS.BUY && row.ticker === null) {
      warnings.push(`You don't own any ${row.assetClass} yet. Pick a fund to buy for it.`);
    }
  }

  const totalBuy = roundDollars(sum(rows.filter((r) => r.action === ACTIONS.BUY).map((r) => r.tradeAmount)));
  const totalSell = roundDollars(sum(rows.filter((r) => r.action === ACTIONS.SELL).map((r) => r.tradeAmount)));

  return {
    mode,
    // Only meaningful in inflow-only mode, so the UI can show which split was used.
    inflowStrategy: mode === MODES.INFLOW_ONLY ? inflowStrategy : null,
    newCash: roundDollars(newCash),
    currentTotal: roundDollars(currentTotal),
    projectedTotal: roundDollars(projectedTotal),
    rows,
    summary: {
      totalBuy,
      totalSell,
      // Cash not used: new cash, plus money from sells, minus money spent on buys.
      cashLeftOver: roundDollars(newCash + totalSell - totalBuy),
    },
    warnings,
  };
}

/**
 * Inflow-only: spend the new cash on underweight classes. Never sells, so it never creates a tax bill.
 *
 * Key fact used by both strategies: all the deltas add up to exactly `newCash`
 * (target weights add up to 100%). Overweight classes have negative deltas, so the
 * underweight deltas add up to `newCash` or more. There is always enough "gap" to absorb the cash.
 */
function applyInflowOnly(rows, newCash, inflowStrategy, warnings) {
  // Fix: in the pseudocode, INFLOW_ONLY with $0 cash fell through both IF branches and no action was set.
  if (newCash === 0) {
    warnings.push('Inflow-only mode needs new cash to invest. With $0, every row is HOLD.');
    return;
  }

  const underweight = rows.filter((row) => row._exactDelta > 0);
  if (underweight.length === 0) {
    // Can't happen when weights add up to 100% and newCash > 0, but never divide by zero.
    warnings.push('No asset class is underweight, so there is nothing to buy.');
    return;
  }

  const gaps = underweight.map((row) => row._exactDelta);
  const exactBuys =
    inflowStrategy === INFLOW_STRATEGIES.BIGGEST_GAP_FIRST
      ? biggestGapFirst(gaps, newCash)
      : proportional(gaps, newCash);

  // Turn the exact buys into whole cents that add up to exactly the new cash. Plain rounding
  // of each row could be off by a cent, e.g. $100 / 3 = 33.33 + 33.33 + 33.33 = 99.99.
  const centsPerRow = splitCents(toCents(newCash), exactBuys);

  underweight.forEach((row, i) => {
    row.tradeAmount = fromCents(centsPerRow[i]);
    row.action = centsPerRow[i] > 0 ? ACTIONS.BUY : ACTIONS.HOLD;
  });
}

/**
 * PROPORTIONAL: each class gets cash * (its gap / total gap).
 * Never overshoots: total gap >= cash, so each share is <= its own gap.
 *
 * Example: gaps $4,800 and $400, cash $2,000 -> buys $1,846.15 and $153.85.
 *
 * @param {number[]} gaps  positive dollar gaps
 * @param {number} cash
 * @returns {number[]} exact dollar buys, same order as `gaps`
 */
function proportional(gaps, cash) {
  const totalGap = sum(gaps);
  return gaps.map((gap) => (cash * gap) / totalGap);
}

/**
 * BIGGEST_GAP_FIRST ("water-filling"): pour cash into the biggest gap until it shrinks to the
 * size of the next biggest, then fill both evenly, and so on. All classes that get cash end
 * with the same leftover gap (the "water level"), and classes with smaller gaps get nothing.
 *
 * This leaves the smallest possible total squared gap, so it's the closest you can get to
 * target with the cash you have.
 *
 * Example: gaps $4,800 and $400, cash $2,000 -> buys $2,000 and $0
 *          (the big gap is still $2,800 after, so it never gets down to $400).
 * Example: gaps $300 and $100, cash $300 -> buys $250 and $50 (both end $50 short).
 *
 * @param {number[]} gaps  positive dollar gaps
 * @param {number} cash    must be <= sum(gaps)
 * @returns {number[]} exact dollar buys, same order as `gaps`
 */
function biggestGapFirst(gaps, cash) {
  const sorted = [...gaps].sort((a, b) => b - a);

  // Find the water level: the gap every funded class is left with.
  // Try funding the k biggest gaps. With k funded, level = (sum of those k gaps - cash) / k.
  // Stop at the first k where the level is at or above the next gap (so the next class doesn't need cash).
  let level = 0;
  let runningTotal = 0;
  for (let k = 1; k <= sorted.length; k++) {
    runningTotal += sorted[k - 1];
    level = (runningTotal - cash) / k;
    const nextGap = sorted[k] ?? 0;
    if (level >= nextGap) break;
  }
  level = Math.max(level, 0);

  return gaps.map((gap) => Math.max(gap - level, 0));
}

/**
 * Full rebalance: buy underweight classes and sell overweight ones to hit the targets.
 * Trades smaller than `minTrade` are skipped (not worth the hassle).
 */
function applyFullRebalance(rows, minTrade) {
  for (const row of rows) {
    const amount = Math.abs(row._exactDelta);
    if (amount < minTrade) {
      row.action = ACTIONS.HOLD;
      row.tradeAmount = 0;
    } else {
      row.action = row._exactDelta > 0 ? ACTIONS.BUY : ACTIONS.SELL;
      row.tradeAmount = roundDollars(amount);
    }
  }
}

/**
 * Pick which ticker to trade for an asset class:
 * the user's preferred ticker if they set one, otherwise the biggest holding in that class.
 * Returns null when the user owns nothing in the class and has no preference.
 */
function pickTicker(assetClass, classHoldings, preferredTickers) {
  if (preferredTickers[assetClass]) return preferredTickers[assetClass];
  if (classHoldings.length === 0) return null;
  return classHoldings.reduce((biggest, h) => (h.currentValue > biggest.currentValue ? h : biggest))
    .ticker;
}

function validateInput(input) {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Rebalance input is missing.');
  }

  const {
    holdings,
    targetWeights,
    mode,
    newCash = 0,
    minTrade = DEFAULT_MIN_TRADE,
    inflowStrategy = INFLOW_STRATEGIES.PROPORTIONAL,
  } = input;

  if (!Object.values(MODES).includes(mode)) {
    throw new ValidationError(`Mode must be one of ${Object.values(MODES).join(', ')}. Got: ${mode}`);
  }
  if (!Object.values(INFLOW_STRATEGIES).includes(inflowStrategy)) {
    throw new ValidationError(
      `Inflow strategy must be one of ${Object.values(INFLOW_STRATEGIES).join(', ')}. Got: ${inflowStrategy}`
    );
  }

  if (!Array.isArray(holdings)) {
    throw new ValidationError('Holdings must be a list.');
  }
  holdings.forEach((h, i) => {
    const label = h?.ticker ? `Holding ${h.ticker}` : `Holding #${i + 1}`;
    if (typeof h?.ticker !== 'string' || h.ticker.trim() === '') {
      throw new ValidationError(`${label} is missing a ticker.`);
    }
    if (typeof h.assetClass !== 'string' || h.assetClass.trim() === '') {
      throw new ValidationError(`${label} is missing an asset class.`);
    }
    if (!isMoney(h.currentValue)) {
      throw new ValidationError(
        `${label} needs a current value of $0 or more. Got: ${h.currentValue}. (Is its price missing?)`
      );
    }
  });

  if (!targetWeights || typeof targetWeights !== 'object' || Object.keys(targetWeights).length === 0) {
    throw new ValidationError('Set at least one target weight.');
  }
  for (const [assetClass, weight] of Object.entries(targetWeights)) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new ValidationError(
        `Target for ${assetClass} must be between 0 and 1 (0% to 100%). Got: ${weight}`
      );
    }
  }
  // Fix: if weights don't add up to 100%, the math breaks (and totalDeficit can be 0).
  const weightTotal = sum(Object.values(targetWeights));
  if (Math.abs(weightTotal - 1) > WEIGHT_TOLERANCE) {
    throw new ValidationError(
      `Target weights add up to ${(weightTotal * 100).toFixed(2)}%. They must add up to 100%.`
    );
  }

  if (!isMoney(newCash)) {
    throw new ValidationError(`New cash must be $0 or more. Got: ${newCash}`);
  }
  if (!isMoney(minTrade)) {
    throw new ValidationError(`Minimum trade must be $0 or more. Got: ${minTrade}`);
  }
}

function isMoney(value) {
  return Number.isFinite(value) && value >= 0;
}

function sum(numbers) {
  return numbers.reduce((total, n) => total + n, 0);
}
