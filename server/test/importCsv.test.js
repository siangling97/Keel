import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { importCsvSources, MAX_ROWS } from '../src/import/importCsv.js';
import { listAdapters } from '../src/import/adapters/index.js';

const TODAY = '2026-11-19';
const sampleCsv = readFileSync(new URL('../src/sample-data/sample-import.csv', import.meta.url), 'utf8');
const templateCsv = readFileSync(new URL('../src/sample-data/import-template.csv', import.meta.url), 'utf8');

const HEADER = 'Account,Account Type,Ticker,Shares,Cost Per Share,Acquired On,Asset Class';
const importText = (text, name = 'test.csv') => importCsvSources([{ name, text }], { today: TODAY });

describe('importing the sample file', () => {
  const result = importText(sampleCsv, 'sample-import.csv');

  it('imports every row with no errors', () => {
    expect(result.errors).toEqual([]);
    expect(result.stats).toEqual({ lotsImported: 8, rowsWithErrors: 0 });
    expect(result.files).toEqual([{ name: 'sample-import.csv', adapter: 'TEMPLATE', rowsRead: 8 }]);
  });

  it('finds the three accounts and their types', () => {
    expect(result.accounts).toEqual([
      { name: 'Fidelity Brokerage', accountType: 'TAXABLE' },
      { name: 'Vanguard Roth IRA', accountType: 'ROTH_IRA' },
      { name: 'Webull Individual', accountType: 'TAXABLE' },
    ]);
  });

  it('cleans up "$75.00" and "02/10/2024"', () => {
    expect(result.lots[0]).toEqual({
      accountName: 'Fidelity Brokerage',
      accountType: 'TAXABLE',
      ticker: 'VXUS',
      shares: 50,
      costPerShare: 75,
      acquiredOn: '2024-02-10',
      source: 'sample-import.csv line 2',
    });
  });

  it('collects asset classes per ticker', () => {
    expect(result.assetClasses).toEqual({
      VXUS: 'INTL_EQUITY',
      VTI: 'US_EQUITY',
      BND: 'BONDS',
      VNQ: 'REIT',
      O: 'REIT',
    });
  });
});

describe('flexible headers', () => {
  it('reads common broker header names (Symbol, Quantity, Cost Basis Total, Date Acquired)', () => {
    const text = [
      'Account Name,Account Type,Symbol,Quantity,Cost Basis Total,Date Acquired',
      'Brokerage,Individual,brk.b,4,"$1,800.00",03/15/2024',
    ].join('\n');
    const result = importText(text);
    expect(result.errors).toEqual([]);
    expect(result.lots[0]).toMatchObject({ ticker: 'BRK-B', shares: 4, costPerShare: 450, acquiredOn: '2024-03-15' });
    expect(result.warnings.join(' ')).toMatch(/No asset class for BRK-B/);
  });

  it('works with the BOM Excel adds, Windows line endings, and blank lines', () => {
    const text = '﻿' + [HEADER, '', 'A,Taxable,VTI,1,100,2025-01-02,US_EQUITY', '', ''].join('\r\n');
    const result = importText(text);
    expect(result.errors).toEqual([]);
    expect(result.lots).toHaveLength(1);
  });

  it('the downloadable template imports cleanly', () => {
    expect(importText(templateCsv).errors).toEqual([]);
  });

  it('lists the available adapters', () => {
    expect(listAdapters()).toEqual([{ id: 'TEMPLATE', label: 'Portfolio App template (any broker)' }]);
  });
});

describe('row errors', () => {
  it('keeps the good rows and reports each bad row with its line number', () => {
    const text = [
      HEADER,
      'A,Taxable,VTI,10,100,2025-01-02,US_EQUITY', // line 2: good
      'A,Taxable,VTI,,100,2025-01-02,US_EQUITY', // line 3: no shares
      'A,Taxable,VTI,abc,100,02/30/2025,US_EQUITY', // line 4: two problems
      'A,Taxable,BND,5,90,2025-03-04,BONDS', // line 5: good
    ].join('\n');
    const result = importText(text);
    expect(result.lots.map((l) => l.source)).toEqual(['test.csv line 2', 'test.csv line 5']);
    expect(result.errors).toEqual([
      { file: 'test.csv', line: 3, message: 'Shares is empty.' },
      {
        file: 'test.csv',
        line: 4,
        message: 'Shares: "abc" is not a number. Acquired On: "02/30/2025" is not a real date.',
      },
    ]);
    expect(result.stats).toEqual({ lotsImported: 2, rowsWithErrors: 2 });
  });

  it.each([
    ['zero shares', 'A,Taxable,VTI,0,100,2025-01-02,', /Shares must be more than 0/],
    ['no cost at all', 'A,Taxable,VTI,1,,2025-01-02,', /Cost is empty/],
    ['negative cost', 'A,Taxable,VTI,1,(5.00),2025-01-02,', /Cost can't be negative/],
    ['a future date', 'A,Taxable,VTI,1,100,2027-01-01,', /in the future/],
    ['an unknown account type', 'A,Savings,VTI,1,100,2025-01-02,', /not an account type we know/],
    ['no account name', ',Taxable,VTI,1,100,2025-01-02,', /Account is empty/],
    ['a bad ticker', 'A,Taxable,Pending Activity,1,100,2025-01-02,', /doesn't look like a ticker/],
  ])('reports %s', (_label, row, message) => {
    const result = importText([HEADER, row].join('\n'));
    expect(result.lots).toEqual([]);
    expect(result.errors[0].message).toMatch(message);
  });

  it('one account name cannot have two account types', () => {
    const text = [HEADER, 'Main,Taxable,VTI,1,100,2025-01-02,', 'Main,Roth IRA,BND,1,90,2025-01-02,'].join('\n');
    const result = importText(text);
    expect(result.lots).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ line: 3, message: expect.stringMatching(/is TAXABLE at test.csv line 2 but ROTH_IRA here/) });
  });

  it('matches account names without caring about upper/lower case', () => {
    const text = [HEADER, 'Main,Taxable,VTI,1,100,2025-01-02,', 'MAIN,Taxable,BND,1,90,2025-01-02,'].join('\n');
    const result = importText(text);
    expect(result.accounts).toEqual([{ name: 'Main', accountType: 'TAXABLE' }]);
    expect(result.lots.map((l) => l.accountName)).toEqual(['Main', 'Main']);
  });

  it('warns about a row that looks like a copy, but still imports it', () => {
    const row = 'A,Taxable,VTI,1,100,2025-01-02,';
    const result = importText([HEADER, row, row].join('\n'));
    expect(result.lots).toHaveLength(2);
    expect(result.warnings.join(' ')).toMatch(/line 3 looks like a copy of test.csv line 2/);
  });
});

describe('file errors', () => {
  it('empty file', () => {
    expect(importText('   ').errors[0].message).toBe('The file is empty.');
  });

  it('unknown columns: says which ones are missing', () => {
    const result = importText('Name,Value\nfoo,1');
    expect(result.errors[0].line).toBeNull();
    expect(result.errors[0].message).toMatch(/Missing: Account, Account Type, Ticker, Shares, Acquired On, Cost Per Share \(or Total Cost\)/);
  });

  it(`too many rows (more than ${MAX_ROWS})`, () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, () => 'A,Taxable,VTI,1,100,2025-01-02,');
    expect(importText([HEADER, ...rows].join('\n')).errors[0].message).toMatch(/more than 5000 rows/);
  });
});

describe('several files at once (one per broker)', () => {
  it('combines them and keeps file names in messages', () => {
    const fidelity = [HEADER, 'Fidelity,Taxable,VTI,10,200,2024-01-02,US_EQUITY'].join('\n');
    const vanguard = [HEADER, 'Vanguard Roth,Roth IRA,VTI,5,250,2025-01-02,US_EQUITY', 'Vanguard Roth,Roth IRA,XYZ,,1,2025-01-02,'].join('\n');
    const result = importCsvSources(
      [
        { name: 'fidelity.csv', text: fidelity },
        { name: 'vanguard.csv', text: vanguard },
      ],
      { today: TODAY }
    );
    expect(result.lots).toHaveLength(2);
    expect(result.accounts.map((a) => a.name)).toEqual(['Fidelity', 'Vanguard Roth']);
    expect(result.errors).toEqual([{ file: 'vanguard.csv', line: 3, message: 'Shares is empty.' }]);
  });
});
