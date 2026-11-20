// Adapter for the app's own CSV template. Works for any broker: the user copies their lots
// into these columns (by hand or from their broker's website).
//
// Header names are matched loosely, so "Symbol" works for "Ticker", "Quantity" for "Shares",
// "Cost Basis Total" for "Total Cost", and so on. Many broker "lot details" exports already
// match without any editing.

import {
  normalizeTicker,
  parseNumber,
  parseDate,
  parseAccountType,
  parseAssetClass,
  normalizeHeader,
} from '../normalize.js';

/** Our columns, and the header names we accept for each. Aliases are already in normalizeHeader() form. */
const COLUMNS = {
  account: { label: 'Account', required: true, aliases: ['account', 'account name', 'account nickname'] },
  accountType: { label: 'Account Type', required: true, aliases: ['account type', 'type of account', 'tax type'] },
  ticker: { label: 'Ticker', required: true, aliases: ['ticker', 'symbol', 'ticker symbol'] },
  shares: { label: 'Shares', required: true, aliases: ['shares', 'quantity', 'qty', 'units'] },
  costPerShare: {
    label: 'Cost Per Share',
    aliases: ['cost per share', 'cost basis per share', 'average cost', 'average cost basis', 'avg cost', 'unit cost', 'price paid'],
  },
  totalCost: { label: 'Total Cost', aliases: ['total cost', 'cost basis', 'cost basis total', 'total cost basis'] },
  acquiredOn: {
    label: 'Acquired On',
    required: true,
    aliases: ['acquired on', 'date acquired', 'acquired', 'purchase date', 'open date', 'trade date'],
  },
  assetClass: { label: 'Asset Class', aliases: ['asset class', 'category'] },
};

/** The header row of the downloadable template, in order. */
export const TEMPLATE_HEADERS = ['Account', 'Account Type', 'Ticker', 'Shares', 'Cost Per Share', 'Acquired On', 'Asset Class'];

/**
 * Find which column index holds each of our fields.
 * @param {string[]} headerRow
 * @returns {{ columnIndex: Record<string, number>, missing: string[] }}
 */
function mapHeaders(headerRow) {
  const normalized = headerRow.map(normalizeHeader);
  const columnIndex = {};
  for (const [field, spec] of Object.entries(COLUMNS)) {
    const index = normalized.findIndex((h) => spec.aliases.includes(h));
    if (index !== -1) columnIndex[field] = index;
  }

  const missing = Object.entries(COLUMNS)
    .filter(([field, spec]) => spec.required && columnIndex[field] === undefined)
    .map(([, spec]) => spec.label);
  if (columnIndex.costPerShare === undefined && columnIndex.totalCost === undefined) {
    missing.push('Cost Per Share (or Total Cost)');
  }
  return { columnIndex, missing };
}

export const templateAdapter = {
  id: 'TEMPLATE',
  label: 'Portfolio App template (any broker)',

  /** Can this adapter read a file with these headers? */
  detect(headerRow) {
    return mapHeaders(headerRow).missing.length === 0;
  },

  mapHeaders,

  /**
   * Turn one row of cells into a lot. Collects every problem in the row, not just the first.
   * @param {string[]} cells
   * @param {Record<string, number>} columnIndex
   * @param {{ today: string }} options
   * @returns {{ lot?: object, errors: string[] }}
   */
  parseRow(cells, columnIndex, { today }) {
    const cell = (field) => (columnIndex[field] === undefined ? undefined : cells[columnIndex[field]]);
    const errors = [];

    const account = String(cell('account') ?? '').trim();
    if (account === '') errors.push('Account is empty.');

    const accountType = parseAccountType(cell('accountType'));
    if (accountType.error) errors.push(accountType.error);

    const ticker = normalizeTicker(cell('ticker'));
    if (ticker.error) errors.push(ticker.error);

    const shares = parseNumber(cell('shares'));
    if (shares.error) errors.push(`Shares: ${shares.error}`);
    else if (shares.value === null) errors.push('Shares is empty.');
    else if (shares.value <= 0) errors.push(`Shares must be more than 0. Got: ${shares.value}`);

    // Cost: use Cost Per Share if given, otherwise Total Cost / Shares.
    let costPerShare = null;
    const perShare = parseNumber(cell('costPerShare'));
    const total = parseNumber(cell('totalCost'));
    if (perShare.error) errors.push(`Cost Per Share: ${perShare.error}`);
    else if (perShare.value !== null) costPerShare = perShare.value;
    else if (total.error) errors.push(`Total Cost: ${total.error}`);
    else if (total.value !== null && shares.value > 0) costPerShare = total.value / shares.value;

    if (!perShare.error && !total.error) {
      if (perShare.value === null && total.value === null) {
        errors.push('Cost is empty. Fill in Cost Per Share or Total Cost.');
      } else if (costPerShare !== null && costPerShare < 0) {
        errors.push(`Cost can't be negative. Got: ${costPerShare}`);
      }
      // If only Total Cost was given and Shares is bad, the Shares error above already explains it.
    }

    const acquiredOn = parseDate(cell('acquiredOn'));
    if (acquiredOn.error) errors.push(`Acquired On: ${acquiredOn.error}`);
    else if (acquiredOn.value > today) errors.push(`Acquired On is in the future: ${acquiredOn.value}`);

    const assetClass = parseAssetClass(cell('assetClass'));
    if (assetClass.error) errors.push(assetClass.error);

    if (errors.length > 0) return { errors };
    return {
      errors: [],
      lot: {
        accountName: account,
        accountType: accountType.value,
        ticker: ticker.value,
        shares: shares.value,
        costPerShare: Math.round(costPerShare * 1e6) / 1e6, // 6 decimals, like the database column
        acquiredOn: acquiredOn.value,
        assetClass: assetClass.value,
      },
    };
  },
};
