// Dividend projection + DRIP simulator (module 3 of the pseudocode).
//
// Projects dividend income year by year. With DRIP on, every dividend payment buys more
// (fractional) shares at that day's projected price, so later payments get bigger.
//
// Pure function like the rebalancer: no database, no network, no clock (unless you leave
// `currentYear` out). The same input always gives the same output.

import { ValidationError } from './errors.js';
import { roundDollars } from './money.js';

/** Used when a holding has no growth rate of its own. The user can change these. */
export const DEFAULT_ASSUMPTIONS = Object.freeze({
  dividendGrowthRate: 0.03, // dividends per share grow 3% a year
  priceGrowthRate: 0.06, // share price grows 6% a year
  paymentsPerYear: 4, // most US stocks and ETFs pay quarterly
});

/** Allowed payment schedules: annual, semi-annual, quarterly, monthly. */
export const PAYMENT_SCHEDULES = Object.freeze([1, 2, 4, 12]);

const MAX_YEARS = 50;

/**
 * @typedef {Object} DividendHolding
 * @property {string} ticker
 * @property {number} shares
 * @property {number} currentPrice             dollars per share, must be > 0
 * @property {number} annualDividendPerShare   forward annual dividend in dollars (0 if none)
 * @property {number} [dividendGrowthRate]     e.g. 0.05 for 5%/year. Falls back to the default.
 * @property {number} [priceGrowthRate]        e.g. 0.07 for 7%/year. Falls back to the default.
 * @property {1|2|4|12} [paymentsPerYear]      how often it pays. Falls back to the default (4).
 */

/**
 * @typedef {Object} DividendInput
 * @property {DividendHolding[]} holdings
 * @property {number} years                    how many years to project (1..50)
 * @property {boolean} reinvestDividends       true = DRIP on
 * @property {number} [defaultDividendGrowthRate=0.03]
 * @property {number} [defaultPriceGrowthRate=0.06]
 * @property {number} [currentYear]            calendar year now. Year 1 of the projection is currentYear + 1.
 */

/**
 * Project dividend income for the next `years` years.
 * @param {DividendInput} input
 */
export function projectDividendIncome(input) {
  validateInput(input);

  const {
    holdings,
    years,
    reinvestDividends,
    defaultDividendGrowthRate = DEFAULT_ASSUMPTIONS.dividendGrowthRate,
    defaultPriceGrowthRate = DEFAULT_ASSUMPTIONS.priceGrowthRate,
    currentYear = new Date().getFullYear(),
  } = input;

  const warnings = [];
  if (holdings.length === 0) warnings.push('No holdings yet, so there is no dividend income to project.');

  // Work on our own copies so the caller's holdings are never changed (the pseudocode's DEEP_COPY).
  // Fix: the pseudocode used `holding.dividendGrowthRate OR 0.03`. In JavaScript, `||` treats 0 as
  // "missing", so a stock the user set to 0% growth would silently get 3%. `??` only replaces
  // null/undefined.
  const positions = holdings.map((h) => ({
    ticker: h.ticker,
    shares: h.shares,
    startPrice: h.currentPrice,
    startDividendPerShare: h.annualDividendPerShare,
    dividendGrowthRate: h.dividendGrowthRate ?? defaultDividendGrowthRate,
    priceGrowthRate: h.priceGrowthRate ?? defaultPriceGrowthRate,
    paymentsPerYear: h.paymentsPerYear ?? DEFAULT_ASSUMPTIONS.paymentsPerYear,
  }));

  const annualSummary = [];
  let cumulativeIncome = 0;

  for (let year = 1; year <= years; year++) {
    let yearlyDividendTotal = 0;

    for (const position of positions) {
      // Dividend per share for this year. Year 1 uses today's forward dividend.
      const annualDividendPerShare =
        position.startDividendPerShare * (1 + position.dividendGrowthRate) ** (year - 1);
      const dividendPerPayment = annualDividendPerShare / position.paymentsPerYear;

      // Fix: the pseudocode reinvested once a year. Real DRIP buys shares on every payment,
      // so a quarterly payer compounds 4 times a year and a monthly payer 12 times.
      for (let payment = 1; payment <= position.paymentsPerYear; payment++) {
        const cashPaid = position.shares * dividendPerPayment;
        yearlyDividendTotal += cashPaid;

        if (reinvestDividends && cashPaid > 0) {
          // Years since today when this payment happens, e.g. year 2, 3rd quarterly payment = 1.75
          const yearsFromNow = year - 1 + payment / position.paymentsPerYear;
          position.shares += cashPaid / priceAt(position, yearsFromNow);
        }
      }
    }

    cumulativeIncome += yearlyDividendTotal;
    const endOfYearValue = sum(positions.map((p) => p.shares * priceAt(p, year)));

    annualSummary.push({
      yearNumber: year,
      year: currentYear + year,
      projectedAnnualIncome: roundDollars(yearlyDividendTotal),
      // An average. Real payments are lumpy (most pay quarterly), so some months get more.
      projectedMonthlyAverage: roundDollars(yearlyDividendTotal / 12),
      cumulativeIncome: roundDollars(cumulativeIncome),
      // Value of the shares only. With DRIP off, the dividends were paid out as cash instead.
      projectedPortfolioValue: roundDollars(endOfYearValue),
    });
  }

  return {
    reinvestDividends,
    // Echo the assumptions so the UI can show them next to the chart.
    assumptions: {
      defaultDividendGrowthRate,
      defaultPriceGrowthRate,
      perHolding: positions.map((p) => ({
        ticker: p.ticker,
        dividendGrowthRate: p.dividendGrowthRate,
        priceGrowthRate: p.priceGrowthRate,
        paymentsPerYear: p.paymentsPerYear,
      })),
    },
    annualSummary,
    // Where each holding ends up after the last year.
    finalHoldings: positions.map((p, i) => ({
      ticker: p.ticker,
      startShares: holdings[i].shares,
      endShares: Math.round(p.shares * 10000) / 10000,
    })),
    warnings,
  };
}

/** Projected share price `yearsFromNow` years from today. */
function priceAt(position, yearsFromNow) {
  return position.startPrice * (1 + position.priceGrowthRate) ** yearsFromNow;
}

function validateInput(input) {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Dividend projection input is missing.');
  }

  const {
    holdings,
    years,
    reinvestDividends,
    defaultDividendGrowthRate = DEFAULT_ASSUMPTIONS.dividendGrowthRate,
    defaultPriceGrowthRate = DEFAULT_ASSUMPTIONS.priceGrowthRate,
    currentYear,
  } = input;

  if (!Array.isArray(holdings)) throw new ValidationError('Holdings must be a list.');
  if (!Number.isInteger(years) || years < 1 || years > MAX_YEARS) {
    throw new ValidationError(`Years must be a whole number from 1 to ${MAX_YEARS}. Got: ${years}`);
  }
  if (typeof reinvestDividends !== 'boolean') {
    throw new ValidationError('reinvestDividends must be true or false.');
  }
  checkRate('Default dividend growth rate', defaultDividendGrowthRate);
  checkRate('Default price growth rate', defaultPriceGrowthRate);
  if (currentYear !== undefined && !Number.isInteger(currentYear)) {
    throw new ValidationError(`currentYear must be a whole number. Got: ${currentYear}`);
  }

  const seen = new Set();
  holdings.forEach((h, i) => {
    const label = h?.ticker ? `Holding ${h.ticker}` : `Holding #${i + 1}`;
    if (typeof h?.ticker !== 'string' || h.ticker.trim() === '') {
      throw new ValidationError(`${label} is missing a ticker.`);
    }
    if (seen.has(h.ticker)) {
      throw new ValidationError(`${label} appears twice. Merge it into one holding first.`);
    }
    seen.add(h.ticker);
    if (!Number.isFinite(h.shares) || h.shares < 0) {
      throw new ValidationError(`${label} needs shares of 0 or more. Got: ${h.shares}`);
    }
    // DRIP divides by the price, so a missing or $0 price would give Infinity shares.
    if (!Number.isFinite(h.currentPrice) || h.currentPrice <= 0) {
      throw new ValidationError(
        `${label} needs a price above $0. Got: ${h.currentPrice}. (Is its price missing?)`
      );
    }
    if (!Number.isFinite(h.annualDividendPerShare) || h.annualDividendPerShare < 0) {
      throw new ValidationError(
        `${label} needs an annual dividend of $0 or more. Got: ${h.annualDividendPerShare}`
      );
    }
    if (h.dividendGrowthRate !== undefined && h.dividendGrowthRate !== null) {
      checkRate(`${label} dividend growth rate`, h.dividendGrowthRate);
    }
    if (h.priceGrowthRate !== undefined && h.priceGrowthRate !== null) {
      checkRate(`${label} price growth rate`, h.priceGrowthRate);
    }
    if (h.paymentsPerYear !== undefined && h.paymentsPerYear !== null && !PAYMENT_SCHEDULES.includes(h.paymentsPerYear)) {
      throw new ValidationError(
        `${label} payments per year must be one of ${PAYMENT_SCHEDULES.join(', ')}. Got: ${h.paymentsPerYear}`
      );
    }
  });
}

/** Growth rates are decimals: 0.03 = 3%. Allow cuts (negative) but not -100% or worse, and not 100%+. */
function checkRate(label, rate) {
  if (!Number.isFinite(rate) || rate <= -1 || rate >= 1) {
    throw new ValidationError(
      `${label} must be a decimal between -1 and 1 (0.03 means 3%). Got: ${rate}`
    );
  }
}

function sum(numbers) {
  return numbers.reduce((total, n) => total + n, 0);
}
