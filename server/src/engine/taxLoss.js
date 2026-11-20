// Tax-loss harvesting scanner (module 4 of the pseudocode).
//
// Finds lots you could sell at a loss to lower your taxes, and flags wash-sale risks.
//
// Fixes from the design review:
//   * Works on LOTS, not merged holdings. A position can be up overall while one lot is down.
//   * Only TAXABLE accounts. Losses inside an IRA/401(k)/HSA can't be deducted.
//   * Wash-sale lookback covers ALL accounts, including IRAs (IRS Rev. Rul. 2008-5).
//   * Funds that track the same index are flagged as possibly "substantially identical".
//   * DRIP warning: a reinvested dividend in the 30 days after the sale is also a buy.
//   * No "washSaleSafe: TRUE". We can only see the past 30 days; the user must also not buy
//     for 31 days after selling. So the status says what we found, not a promise.
//
// For education only. Not tax advice. Not covered: spouse's accounts, options, and splitting a
// partial wash sale by share count.

import { ValidationError } from './errors.js';
import { roundDollars } from './money.js';
import { toDayNumber, daysBetween, addDays, isLongTerm } from './dates.js';

export const ACCOUNT_TYPES = Object.freeze([
  'TAXABLE',
  'TRADITIONAL_IRA',
  'ROTH_IRA',
  '401K',
  'HSA',
  'OTHER_TAX_ADVANTAGED',
]);

/** Transaction types that count as acquiring shares for the wash-sale rule. */
const ACQUISITION_TYPES = new Set(['BUY', 'DIVIDEND_REINVEST']);
const TRANSACTION_TYPES = new Set(['BUY', 'SELL', 'DIVIDEND_REINVEST', 'DIVIDEND_CASH']);

export const DEFAULT_MIN_LOSS = 500;
export const WASH_SALE_WINDOW_DAYS = 30;
const MAX_SUBSTITUTES = 3;

export const WASH_SALE_STATUS = Object.freeze({
  // A buy of the same (or a same-index) security happened in the last 30 days, in some account.
  RISK: 'RISK',
  // Nothing found in the last 30 days. The user still must not buy for 31 days after selling.
  NO_RECENT_BUYS_FOUND: 'NO_RECENT_BUYS_FOUND',
});

/**
 * @typedef {Object} Account
 * @property {string|number} id
 * @property {string} name
 * @property {string} accountType   one of ACCOUNT_TYPES
 * @property {boolean} [dripEnabled]
 *
 * @typedef {Object} Lot
 * @property {string|number} id
 * @property {string|number} accountId
 * @property {string} ticker
 * @property {number} shares
 * @property {number} costPerShare
 * @property {string} acquiredOn    "YYYY-MM-DD"
 *
 * @typedef {Object} Transaction
 * @property {string|number} accountId
 * @property {string} ticker
 * @property {'BUY'|'SELL'|'DIVIDEND_REINVEST'|'DIVIDEND_CASH'} type
 * @property {string} tradeDate     "YYYY-MM-DD"
 * @property {number} [shares]
 *
 * @typedef {Object} SecurityInfo
 * @property {string} ticker
 * @property {string} [assetClass]
 * @property {string} [trackedIndex]  e.g. "S&P 500"
 *
 * @typedef {Object} TaxLossInput
 * @property {string} asOfDate                       the day you would sell, "YYYY-MM-DD"
 * @property {Account[]} accounts                    ALL the user's accounts (IRAs too, for the wash-sale check)
 * @property {Lot[]} lots                            ALL the user's open lots
 * @property {Record<string, number>} prices         current price per ticker
 * @property {Transaction[]} [transactions]          recent history, all accounts
 * @property {SecurityInfo[]} [securities]           index + asset class info, for substitutes
 * @property {number} [minLoss=500]                  ignore positions losing less than this
 */

/**
 * @param {TaxLossInput} input
 */
export function scanTaxLossOpportunities(input) {
  validateInput(input);

  const {
    asOfDate,
    accounts,
    lots,
    prices,
    transactions = [],
    securities = [],
    minLoss = DEFAULT_MIN_LOSS,
  } = input;

  const warnings = [];
  const accountsById = new Map(accounts.map((a) => [String(a.id), a]));
  const securityByTicker = new Map(securities.map((s) => [s.ticker, s]));
  const trackedIndexOf = (ticker) => securityByTicker.get(ticker)?.trackedIndex ?? null;

  // 1. Find losing lots in taxable accounts, grouped by account + ticker
  //    (you sell inside one account, so that's the unit of an opportunity).
  const groups = new Map();
  let taxAdvantagedLotsSkipped = 0;
  const missingPrices = new Set();

  for (const lot of lots) {
    const account = accountsById.get(String(lot.accountId));
    if (account.accountType !== 'TAXABLE') {
      taxAdvantagedLotsSkipped++;
      continue;
    }
    const price = prices[lot.ticker];
    if (!Number.isFinite(price) || price <= 0) {
      missingPrices.add(lot.ticker);
      continue;
    }

    const key = `${account.id}|${lot.ticker}`;
    if (!groups.has(key)) {
      groups.set(key, { account, ticker: lot.ticker, price, lossLots: [], gainLotCount: 0 });
    }
    const group = groups.get(key);

    const gainOrLoss = lot.shares * (price - lot.costPerShare);
    if (gainOrLoss < 0) {
      group.lossLots.push({
        lotId: lot.id,
        shares: lot.shares,
        costPerShare: lot.costPerShare,
        acquiredOn: lot.acquiredOn,
        loss: roundDollars(-gainOrLoss),
        term: isLongTerm(lot.acquiredOn, asOfDate) ? 'LONG_TERM' : 'SHORT_TERM',
      });
    } else {
      group.gainLotCount++;
    }
  }

  for (const ticker of missingPrices) {
    warnings.push(`No current price for ${ticker}, so its lots were skipped.`);
  }

  // 2. Keep positions with a big enough loss, and check each for wash-sale risk.
  const opportunities = [];

  for (const group of groups.values()) {
    const harvestableLoss = roundDollars(sum(group.lossLots.map((l) => l.loss)));
    if (group.lossLots.length === 0 || harvestableLoss < minLoss) continue;

    const soldLotIds = new Set(group.lossLots.map((l) => String(l.lotId)));
    const recentBuys = findRecentBuys({
      ticker: group.ticker,
      asOfDate,
      lots,
      transactions,
      soldLotIds,
      accountsById,
      trackedIndexOf,
    });

    const opportunityWarnings = [];
    for (const account of accounts) {
      const holdsIt = lots.some(
        (l) => String(l.accountId) === String(account.id) && sameOrSameIndex(l.ticker, group.ticker, trackedIndexOf)
      );
      if (account.dripEnabled && holdsIt) {
        opportunityWarnings.push(
          `DRIP is on for ${group.ticker} in "${account.name}". A dividend reinvested in the 30 days after ` +
            `you sell counts as a buy and would make this a wash sale. Turn DRIP off first.`
        );
      }
    }
    if (group.gainLotCount > 0) {
      opportunityWarnings.push(
        `Only sell the lots listed here. Tell your broker which lots to sell ("specific lot identification"), ` +
          `otherwise it may sell your oldest shares first, which are at a gain.`
      );
    }

    opportunities.push({
      accountId: group.account.id,
      accountName: group.account.name,
      ticker: group.ticker,
      currentPrice: group.price,
      harvestableLoss,
      shortTermLoss: roundDollars(sum(group.lossLots.filter((l) => l.term === 'SHORT_TERM').map((l) => l.loss))),
      longTermLoss: roundDollars(sum(group.lossLots.filter((l) => l.term === 'LONG_TERM').map((l) => l.loss))),
      sharesToSell: Math.round(sum(group.lossLots.map((l) => l.shares)) * 1e8) / 1e8, // 8 decimals, like the DB
      lotsToSell: group.lossLots,
      washSale: {
        status: recentBuys.length > 0 ? WASH_SALE_STATUS.RISK : WASH_SALE_STATUS.NO_RECENT_BUYS_FOUND,
        recentBuys,
        // The window runs 30 days AFTER the sale too, so day 31 is the first safe day to buy back.
        doNotBuyBackBefore: addDays(asOfDate, WASH_SALE_WINDOW_DAYS + 1),
      },
      substitutes: findSubstitutes(group.ticker, securities, securityByTicker),
      warnings: opportunityWarnings,
    });
  }

  opportunities.sort((a, b) => b.harvestableLoss - a.harvestableLoss || a.ticker.localeCompare(b.ticker));

  return {
    asOfDate,
    opportunities,
    summary: {
      count: opportunities.length,
      totalHarvestableLoss: roundDollars(sum(opportunities.map((o) => o.harvestableLoss))),
      shortTermLoss: roundDollars(sum(opportunities.map((o) => o.shortTermLoss))),
      longTermLoss: roundDollars(sum(opportunities.map((o) => o.longTermLoss))),
      withWashSaleRisk: opportunities.filter((o) => o.washSale.status === WASH_SALE_STATUS.RISK).length,
      taxAdvantagedLotsSkipped,
    },
    warnings,
  };
}

/**
 * Buys of the same ticker (or a fund on the same index) in ANY account in the last 30 days.
 *
 * Looks at both transactions and lots, because some imports only give us lots.
 * A recent lot that is itself being sold is not a "replacement", so it's left out.
 */
function findRecentBuys({ ticker, asOfDate, lots, transactions, soldLotIds, accountsById, trackedIndexOf }) {
  const found = new Map(); // key: account|ticker|date, so the same purchase isn't listed twice

  const consider = ({ accountId, buyTicker, date, shares, type }) => {
    const daysAgo = daysBetween(date, asOfDate);
    if (daysAgo < 0 || daysAgo > WASH_SALE_WINDOW_DAYS) return;
    if (!sameOrSameIndex(buyTicker, ticker, trackedIndexOf)) return;

    const key = `${accountId}|${buyTicker}|${date}`;
    if (found.has(key)) return;
    found.set(key, {
      accountName: accountsById.get(String(accountId))?.name ?? String(accountId),
      ticker: buyTicker,
      date,
      daysAgo,
      shares: shares ?? null,
      type,
      reason: buyTicker === ticker ? 'SAME_TICKER' : 'SAME_INDEX',
    });
  };

  // Recent purchases being sold right now don't count. Remember their keys so a matching
  // transaction for the same purchase is skipped too.
  const soldKeys = new Set();
  for (const lot of lots) {
    const key = `${lot.accountId}|${lot.ticker}|${lot.acquiredOn}`;
    if (soldLotIds.has(String(lot.id))) {
      soldKeys.add(key);
    }
  }

  for (const tx of transactions) {
    if (!ACQUISITION_TYPES.has(tx.type)) continue;
    if (soldKeys.has(`${tx.accountId}|${tx.ticker}|${tx.tradeDate}`)) continue;
    consider({ accountId: tx.accountId, buyTicker: tx.ticker, date: tx.tradeDate, shares: tx.shares, type: tx.type });
  }
  for (const lot of lots) {
    if (soldLotIds.has(String(lot.id))) continue;
    consider({ accountId: lot.accountId, buyTicker: lot.ticker, date: lot.acquiredOn, shares: lot.shares, type: 'BUY' });
  }

  return [...found.values()].sort((a, b) => a.daysAgo - b.daysAgo);
}

/** Same ticker, or both funds track the same index (possibly "substantially identical"). */
function sameOrSameIndex(tickerA, tickerB, trackedIndexOf) {
  if (tickerA === tickerB) return true;
  const indexA = trackedIndexOf(tickerA);
  return indexA !== null && indexA === trackedIndexOf(tickerB);
}

/**
 * Funds in the same asset class that track a DIFFERENT index, so you stay invested
 * without buying something "substantially identical". Only suggestions: the IRS has not
 * defined exactly where that line is.
 */
function findSubstitutes(ticker, securities, securityByTicker) {
  const sold = securityByTicker.get(ticker);
  if (!sold?.assetClass) return [];
  return securities
    .filter(
      (s) =>
        s.ticker !== ticker &&
        s.assetClass === sold.assetClass &&
        s.trackedIndex &&
        s.trackedIndex !== sold.trackedIndex
    )
    .slice(0, MAX_SUBSTITUTES)
    .map((s) => ({ ticker: s.ticker, trackedIndex: s.trackedIndex }));
}

function validateInput(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Tax-loss scan input is missing.');

  const { asOfDate, accounts, lots, prices, transactions = [], securities = [], minLoss = DEFAULT_MIN_LOSS } = input;

  toDayNumber(asOfDate, 'asOfDate');

  if (!Array.isArray(accounts)) throw new ValidationError('Accounts must be a list.');
  const accountIds = new Set();
  for (const a of accounts) {
    if (a?.id === undefined || a.id === null) throw new ValidationError('Every account needs an id.');
    if (!ACCOUNT_TYPES.includes(a.accountType)) {
      throw new ValidationError(
        `Account "${a.name ?? a.id}" has an unknown type: ${a.accountType}. Use one of ${ACCOUNT_TYPES.join(', ')}.`
      );
    }
    accountIds.add(String(a.id));
  }

  if (!Array.isArray(lots)) throw new ValidationError('Lots must be a list.');
  for (const lot of lots) {
    const label = `Lot ${lot?.id ?? '?'} (${lot?.ticker ?? 'no ticker'})`;
    if (!accountIds.has(String(lot?.accountId))) {
      throw new ValidationError(`${label} belongs to an unknown account: ${lot?.accountId}`);
    }
    if (typeof lot.ticker !== 'string' || lot.ticker.trim() === '') throw new ValidationError(`${label} needs a ticker.`);
    if (!Number.isFinite(lot.shares) || lot.shares <= 0) {
      throw new ValidationError(`${label} needs more than 0 shares. Got: ${lot.shares}`);
    }
    if (!Number.isFinite(lot.costPerShare) || lot.costPerShare < 0) {
      throw new ValidationError(`${label} needs a cost per share of $0 or more. Got: ${lot.costPerShare}`);
    }
    if (toDayNumber(lot.acquiredOn, `${label} acquiredOn`) > toDayNumber(asOfDate)) {
      throw new ValidationError(`${label} was acquired after ${asOfDate}.`);
    }
  }

  if (!prices || typeof prices !== 'object') throw new ValidationError('Prices must be an object like { VTI: 300 }.');

  if (!Array.isArray(transactions)) throw new ValidationError('Transactions must be a list.');
  for (const tx of transactions) {
    if (!TRANSACTION_TYPES.has(tx?.type)) {
      throw new ValidationError(`Unknown transaction type: ${tx?.type}`);
    }
    toDayNumber(tx.tradeDate, `Transaction tradeDate (${tx.ticker})`);
  }

  if (!Array.isArray(securities)) throw new ValidationError('Securities must be a list.');

  if (!Number.isFinite(minLoss) || minLoss < 0) {
    throw new ValidationError(`Minimum loss must be $0 or more. Got: ${minLoss}`);
  }
}

function sum(numbers) {
  return numbers.reduce((total, n) => total + n, 0);
}
