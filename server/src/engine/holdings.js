// Build merged holdings from lots + market data (module 1 of the pseudocode, second half).
//
// Lots (one per purchase, per account) are merged into one holding per ticker, then joined with
// prices and dividend data. The result plugs straight into the rebalancer and the dividend projector.

import { ValidationError } from './errors.js';
import { roundDollars } from './money.js';

export const UNCLASSIFIED = 'UNCLASSIFIED';

/**
 * @typedef {Object} MarketQuote
 * @property {number} price
 * @property {number} [forwardAnnualDividend]   dollars per share per year
 * @property {1|2|4|12} [paymentsPerYear]
 */

/**
 * @param {Object} input
 * @param {{ ticker: string, shares: number, costPerShare: number }[]} input.lots
 * @param {Record<string, MarketQuote>} input.marketData   e.g. { VTI: { price: 300, forwardAnnualDividend: 3.6 } }
 * @param {Record<string, string>} [input.assetClasses]     e.g. { VTI: "US_EQUITY" }
 */
export function buildHoldings({ lots, marketData, assetClasses = {} }) {
  if (!Array.isArray(lots)) throw new ValidationError('Lots must be a list.');
  if (!marketData || typeof marketData !== 'object') throw new ValidationError('Market data must be an object.');

  const warnings = [];

  // 1. Merge lots by ticker (across all accounts).
  const byTicker = new Map();
  for (const lot of lots) {
    if (!byTicker.has(lot.ticker)) byTicker.set(lot.ticker, { shares: 0, totalCostBasis: 0 });
    const merged = byTicker.get(lot.ticker);
    merged.shares += lot.shares;
    merged.totalCostBasis += lot.shares * lot.costPerShare;
  }

  // 2. Join with market data.
  const holdings = [];
  const missingPrices = [];
  const missingDividends = [];
  const unclassified = [];

  for (const [ticker, merged] of byTicker) {
    const quote = marketData[ticker];
    // Fix: the pseudocode did quote.price without checking. A typo or delisted ticker has no quote,
    // and NaN would spread into every total. Leave it out and say so instead.
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
      missingPrices.push(ticker);
      continue;
    }

    const assetClass = assetClasses[ticker] ?? UNCLASSIFIED;
    if (assetClass === UNCLASSIFIED) unclassified.push(ticker);

    const dividend = quote.forwardAnnualDividend;
    if (dividend === undefined || dividend === null) missingDividends.push(ticker);

    const shares = Math.round(merged.shares * 1e8) / 1e8;
    const currentValue = roundDollars(shares * quote.price);
    const totalCostBasis = roundDollars(merged.totalCostBasis);

    holdings.push({
      ticker,
      assetClass,
      shares,
      totalCostBasis,
      currentPrice: quote.price,
      currentValue,
      unrealizedGain: roundDollars(currentValue - totalCostBasis),
      annualDividendPerShare: dividend ?? 0,
      ...(quote.paymentsPerYear ? { paymentsPerYear: quote.paymentsPerYear } : {}),
    });
  }

  if (missingPrices.length > 0) {
    warnings.push(`No price for ${missingPrices.join(', ')}, so they're left out of the totals. Check the ticker.`);
  }
  if (missingDividends.length > 0) {
    warnings.push(`No dividend data for ${missingDividends.join(', ')}. Assuming they pay no dividend.`);
  }
  if (unclassified.length > 0) {
    warnings.push(`${unclassified.join(', ')} ${unclassified.length === 1 ? 'has' : 'have'} no asset class yet.`);
  }

  holdings.sort((a, b) => b.currentValue - a.currentValue || a.ticker.localeCompare(b.ticker));

  return {
    holdings,
    totals: {
      currentValue: roundDollars(holdings.reduce((t, h) => t + h.currentValue, 0)),
      totalCostBasis: roundDollars(holdings.reduce((t, h) => t + h.totalCostBasis, 0)),
      unrealizedGain: roundDollars(holdings.reduce((t, h) => t + h.unrealizedGain, 0)),
    },
    missingPrices,
    warnings,
  };
}
