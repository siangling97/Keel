// CSV import (module 1 of the pseudocode, first half).
//
// Reads one or more CSV files and returns clean lots, the accounts they belong to, and a list of
// problems with line numbers. A bad row doesn't stop the import: the user gets the good rows plus
// "Line 7: Shares is empty." for the rest, and can fix and re-upload.
//
// Uses papaparse, which runs in Node and in the browser. Demo mode can import a file without
// ever sending it to the server.

import Papa from 'papaparse';
import { detectAdapter, getBrokerAdapter } from './adapters/index.js';

export const MAX_ROWS = 5000;

/**
 * @typedef {Object} CsvSource
 * @property {string} name        file name, used in messages
 * @property {string} text        file contents
 * @property {string} [adapterId] force an adapter instead of auto-detecting
 */

/**
 * Import several CSV files at once (e.g. one per broker) and combine them.
 * @param {CsvSource[]} sources
 * @param {{ today?: string }} [options]  today = "YYYY-MM-DD", for rejecting future dates
 */
export function importCsvSources(sources, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const lots = [];
  const errors = [];
  const warnings = [];
  const accounts = new Map(); // lower-case name -> { name, accountType, firstSeen }
  const assetClasses = {}; // ticker -> asset class
  const seenLots = new Map(); // duplicate check
  const files = [];

  for (const source of sources) {
    const result = readOneSource(source, today);
    files.push({ name: source.name, adapter: result.adapterId, rowsRead: result.rows.length });
    errors.push(...result.errors);

    for (const { line, lot } of result.rows) {
      const where = `${source.name} line ${line}`;

      // One account name = one account type. "Roth IRA" can't also be "Taxable".
      const key = lot.accountName.toLowerCase();
      const existing = accounts.get(key);
      if (existing && existing.accountType !== lot.accountType) {
        errors.push({
          file: source.name,
          line,
          message: `Account "${lot.accountName}" is ${existing.accountType} at ${existing.firstSeen} but ${lot.accountType} here.`,
        });
        continue;
      }
      if (!existing) accounts.set(key, { name: lot.accountName, accountType: lot.accountType, firstSeen: where });

      if (lot.assetClass) {
        if (assetClasses[lot.ticker] && assetClasses[lot.ticker] !== lot.assetClass) {
          warnings.push(
            `${where}: ${lot.ticker} is ${lot.assetClass} here but ${assetClasses[lot.ticker]} earlier. Keeping ${assetClasses[lot.ticker]}.`
          );
        } else {
          assetClasses[lot.ticker] = lot.assetClass;
        }
      }

      const dupKey = [key, lot.ticker, lot.shares, lot.costPerShare, lot.acquiredOn].join('|');
      if (seenLots.has(dupKey)) {
        warnings.push(`${where} looks like a copy of ${seenLots.get(dupKey)}. Both were imported; delete one if it's a mistake.`);
      } else {
        seenLots.set(dupKey, where);
      }

      const { assetClass, ...lotWithoutClass } = lot;
      lots.push({ ...lotWithoutClass, accountName: accounts.get(key).name, source: where });
    }
  }

  const unclassified = [...new Set(lots.map((l) => l.ticker))].filter((t) => !assetClasses[t]);
  if (unclassified.length > 0) {
    warnings.push(`No asset class for ${unclassified.join(', ')}. Set one so the rebalancer knows where they belong.`);
  }

  return {
    files,
    accounts: [...accounts.values()].map(({ name, accountType }) => ({ name, accountType })),
    lots,
    assetClasses,
    errors,
    warnings,
    stats: {
      lotsImported: lots.length,
      rowsWithErrors: new Set(errors.filter((e) => e.line).map((e) => `${e.file}|${e.line}`)).size,
    },
  };
}

/** Read one file: find the header row, pick an adapter, parse every row. */
function readOneSource({ name, text, adapterId }, today) {
  const fileError = (message) => ({ adapterId: null, rows: [], errors: [{ file: name, line: null, message }] });

  if (typeof text !== 'string' || text.trim() === '') return fileError('The file is empty.');

  const parsed = Papa.parse(text.replace(/^﻿/, ''), { header: false, skipEmptyLines: false });
  const allRows = parsed.data;

  // The header is the first non-blank row.
  const headerIndex = allRows.findIndex((cells) => !isBlank(cells));
  if (headerIndex === -1) return fileError('The file is empty.');
  const headerRow = allRows[headerIndex];

  const adapter = adapterId ? getBrokerAdapter(adapterId) : detectAdapter(headerRow);
  if (!adapter) {
    const { missing } = getBrokerAdapter('TEMPLATE').mapHeaders(headerRow);
    return fileError(
      `We couldn't read this file's columns. Missing: ${missing.join(', ')}. ` +
        `Download the template to see the columns we need.`
    );
  }

  const { columnIndex, missing } = adapter.mapHeaders(headerRow);
  if (missing.length > 0) return fileError(`Missing columns: ${missing.join(', ')}.`);

  const dataRows = allRows.slice(headerIndex + 1);
  if (dataRows.filter((cells) => !isBlank(cells)).length > MAX_ROWS) {
    return fileError(`This file has more than ${MAX_ROWS} rows. Split it into smaller files.`);
  }

  const rows = [];
  const errors = [];
  dataRows.forEach((cells, i) => {
    if (isBlank(cells)) return;
    const line = headerIndex + i + 2; // +1 for the header row, +1 because lines start at 1
    const { lot, errors: rowErrors } = adapter.parseRow(cells, columnIndex, { today });
    if (rowErrors.length > 0) {
      errors.push({ file: name, line, message: rowErrors.join(' ') });
    } else {
      rows.push({ line, lot });
    }
  });

  return { adapterId: adapter.id, rows, errors };
}

function isBlank(cells) {
  return cells.every((c) => String(c ?? '').trim() === '');
}
