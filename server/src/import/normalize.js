// Turn messy text from a spreadsheet into clean values.
// Every function returns { value } on success or { error } with a message a user can read,
// so the importer can report "Row 7: ..." instead of crashing on the first bad cell.

const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,14}$/;

/**
 * Normalize a ticker so the same stock always has the same key.
 *   " brk.b " -> "BRK-B"   (class shares: brokers write BRK.B, BRK/B or BRK B)
 *   "SPAXX**" -> "SPAXX"   (Fidelity marks money market funds with asterisks)
 * @param {string} raw
 */
export function normalizeTicker(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'Ticker is empty.' };
  const ticker = raw
    .trim()
    .toUpperCase()
    .replace(/\*+$/, '')
    .replace(/[./\s]+/g, '-');
  if (!TICKER_PATTERN.test(ticker)) return { error: `"${raw.trim()}" doesn't look like a ticker.` };
  return { value: ticker };
}

/**
 * Parse a number the way spreadsheets and brokers write it.
 *   "$1,234.56" -> 1234.56    "(12.50)" -> -12.5 (accounting style negative)    "-3" -> -3
 *   "", "--", "n/a" -> null (blank)
 * @param {string|number|undefined} raw
 */
export function parseNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw } : { error: `${raw} is not a number.` };
  if (raw === undefined || raw === null) return { value: null };
  const text = String(raw).trim();
  if (text === '' || text === '--' || text.toLowerCase() === 'n/a') return { value: null };

  const negativeInParens = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/^\(|\)$/g, '').replace(/[$,\s]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return { error: `"${text}" is not a number.` };

  const value = Number(cleaned);
  return { value: negativeInParens ? -value : value };
}

/**
 * Parse a date into "YYYY-MM-DD". Accepts 2024-02-10, 02/10/2024 and 2/10/2024 (US month/day order).
 * Two-digit years are rejected: is "1/2/24" 1924 or 2024?
 * @param {string} raw
 */
export function parseDate(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'Date is empty.' };
  const text = raw.trim();

  let year, month, day;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    [, year, month, day] = match.map(Number);
  } else if ((match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    [, month, day, year] = match.map(Number);
  } else {
    return { error: `"${text}" is not a date. Use YYYY-MM-DD or MM/DD/YYYY with a 4-digit year.` };
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { error: `"${text}" is not a real date.` };
  }
  return { value: date.toISOString().slice(0, 10) };
}

/** Friendly account-type names people actually type, mapped to our codes. */
const ACCOUNT_TYPE_NAMES = {
  TAXABLE: ['taxable', 'brokerage', 'individual', 'joint', 'individual brokerage', 'cash account', 'margin account'],
  TRADITIONAL_IRA: ['ira', 'traditional ira', 'rollover ira', 'sep ira', 'simple ira', 'traditional_ira'],
  ROTH_IRA: ['roth', 'roth ira', 'roth_ira'],
  '401K': ['401k', '401(k)', '403b', '403(b)', 'roth 401k', 'roth 401(k)'],
  HSA: ['hsa', 'health savings account'],
};

/**
 * "Roth IRA" -> "ROTH_IRA", "Brokerage" -> "TAXABLE", "401(k)" -> "401K"
 * @param {string} raw
 */
export function parseAccountType(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'Account type is empty.' };
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [code, names] of Object.entries(ACCOUNT_TYPE_NAMES)) {
    if (names.includes(key) || key === code.toLowerCase()) return { value: code };
  }
  return {
    error: `"${raw.trim()}" is not an account type we know. Try Taxable, Traditional IRA, Roth IRA, 401(k) or HSA.`,
  };
}

/** "US Equity", "us_equity", "US-EQUITY" -> "US_EQUITY" (the format the database expects) */
export function parseAssetClass(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: null };
  const code = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) return { error: `"${raw}" is not a valid asset class name.` };
  return { value: code };
}

/** Make a header easy to match: "Cost Basis / Share" -> "cost basis share" */
export function normalizeHeader(raw) {
  return String(raw ?? '')
    .replace(/^﻿/, '') // Excel adds an invisible "BOM" character to the first header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
