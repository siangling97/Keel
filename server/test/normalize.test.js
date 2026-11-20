import { describe, it, expect } from 'vitest';
import {
  normalizeTicker,
  parseNumber,
  parseDate,
  parseAccountType,
  parseAssetClass,
  normalizeHeader,
} from '../src/import/normalize.js';

describe('normalizeTicker', () => {
  it.each([
    ['vti', 'VTI'],
    ['  VTI ', 'VTI'],
    ['BRK.B', 'BRK-B'],
    ['BRK/B', 'BRK-B'],
    ['BRK B', 'BRK-B'],
    ['SPAXX**', 'SPAXX'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeTicker(raw)).toEqual({ value: expected });
  });

  it.each(['', '   ', 'Pending Activity', '$VTI', undefined])('rejects %j', (raw) => {
    expect(normalizeTicker(raw).error).toBeDefined();
  });
});

describe('parseNumber', () => {
  it.each([
    ['1234.56', 1234.56],
    ['$1,234.56', 1234.56],
    ['(12.50)', -12.5],
    ['-3', -3],
    [' 10 ', 10],
    ['.5', 0.5],
    [42, 42],
  ])('%j -> %d', (raw, expected) => {
    expect(parseNumber(raw)).toEqual({ value: expected });
  });

  it.each(['', '--', 'n/a', undefined, null])('%j is blank (null)', (raw) => {
    expect(parseNumber(raw)).toEqual({ value: null });
  });

  it.each(['abc', '1.2.3', '12abc', '$'])('rejects %j', (raw) => {
    expect(parseNumber(raw).error).toMatch(/not a number/);
  });
});

describe('parseDate', () => {
  it.each([
    ['2024-02-10', '2024-02-10'],
    ['02/10/2024', '2024-02-10'],
    ['2/1/2024', '2024-02-01'],
    [' 2024-2-1 ', '2024-02-01'],
  ])('%j -> %s', (raw, expected) => {
    expect(parseDate(raw)).toEqual({ value: expected });
  });

  it('rejects two-digit years, because 1/2/24 could be 1924 or 2024', () => {
    expect(parseDate('1/2/24').error).toMatch(/4-digit year/);
  });

  it('rejects impossible dates', () => {
    expect(parseDate('02/30/2024').error).toMatch(/not a real date/);
    expect(parseDate('2024-13-01').error).toMatch(/not a real date/);
  });
});

describe('parseAccountType', () => {
  it.each([
    ['Taxable', 'TAXABLE'],
    ['Individual', 'TAXABLE'],
    ['brokerage', 'TAXABLE'],
    ['Roth IRA', 'ROTH_IRA'],
    ['Rollover IRA', 'TRADITIONAL_IRA'],
    ['401(k)', '401K'],
    ['HSA', 'HSA'],
    ['ROTH_IRA', 'ROTH_IRA'],
  ])('%s -> %s', (raw, expected) => {
    expect(parseAccountType(raw)).toEqual({ value: expected });
  });

  it('rejects unknown types with a hint', () => {
    expect(parseAccountType('Savings').error).toMatch(/Try Taxable/);
  });
});

describe('parseAssetClass and normalizeHeader', () => {
  it('turns friendly names into codes', () => {
    expect(parseAssetClass('Intl Equity')).toEqual({ value: 'INTL_EQUITY' });
    expect(parseAssetClass('us-equity')).toEqual({ value: 'US_EQUITY' });
    expect(parseAssetClass('')).toEqual({ value: null });
    expect(parseAssetClass('123').error).toBeDefined();
  });

  it('normalizes headers, including the invisible BOM Excel adds', () => {
    expect(normalizeHeader('﻿Account')).toBe('account');
    expect(normalizeHeader('Cost Basis / Share')).toBe('cost basis share');
    expect(normalizeHeader('  Acquired_On ')).toBe('acquired on');
  });
});
