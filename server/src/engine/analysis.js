// The four analyses the app offers, given a user's data and prices.
//
// Both the Express API (real users) and the browser demo mode call these same functions,
// so a demo visitor sees exactly the numbers a real user would. Pure: no database, no fetch.

import { buildHoldings } from './holdings.js';
import { calculateRebalanceTrades } from './rebalance.js';
import { projectDividendIncome } from './dividends.js';
import { scanTaxLossOpportunities } from './taxLoss.js';
import { ValidationError } from './errors.js';

/**
 * @typedef {Object} PortfolioData
 * @property {object[]} accounts
 * @property {object[]} lots
 * @property {Record<string,string>} assetClasses
 * @property {Record<string,number>} targetWeights
 * @property {Record<string,string>} preferredTickers
 * @property {object[]} securities
 * @property {object[]} transactions
 */

/** Merged holdings + totals + warnings. */
export function analyzeHoldings(portfolio, quotes, priceSource) {
  const built = buildHoldings({ lots: portfolio.lots, marketData: quotes, assetClasses: portfolio.assetClasses });
  return { ...built, priceSource };
}

export function analyzeRebalance(portfolio, quotes, priceSource, options) {
  if (Object.keys(portfolio.targetWeights).length === 0) {
    throw new ValidationError('Set your target mix first.');
  }
  const { holdings, warnings } = analyzeHoldings(portfolio, quotes, priceSource);
  const result = calculateRebalanceTrades({
    holdings,
    targetWeights: portfolio.targetWeights,
    preferredTickers: portfolio.preferredTickers,
    ...options,
  });
  return { ...result, warnings: [...warnings, ...result.warnings], priceSource };
}

export function analyzeDividends(portfolio, quotes, priceSource, options) {
  const { holdings, warnings } = analyzeHoldings(portfolio, quotes, priceSource);
  const result = projectDividendIncome({ holdings, ...options });
  return { ...result, warnings: [...warnings, ...result.warnings], priceSource };
}

export function analyzeTaxLoss(portfolio, quotes, priceSource, { asOfDate, minLoss }) {
  const prices = Object.fromEntries(Object.entries(quotes).map(([ticker, quote]) => [ticker, quote.price]));
  const result = scanTaxLossOpportunities({
    asOfDate,
    accounts: portfolio.accounts,
    lots: portfolio.lots,
    prices,
    transactions: portfolio.transactions,
    securities: portfolio.securities,
    ...(minLoss !== undefined ? { minLoss } : {}),
  });
  return { ...result, priceSource };
}

/** The tickers we need prices for. */
export function tickersOf(portfolio) {
  return [...new Set(portfolio.lots.map((lot) => lot.ticker))];
}
