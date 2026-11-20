// Run with: npm run demo:import
// Your own file: npm run demo:import -- path/to/your-file.csv
//
// The whole pipeline, end to end:
//   CSV file -> lots + accounts -> merged holdings -> rebalance, dividends, tax-loss scan

import { readFile } from 'node:fs/promises';
import { importCsvSources } from '../src/import/importCsv.js';
import { buildHoldings } from '../src/engine/holdings.js';
import { calculateRebalanceTrades, MODES } from '../src/engine/rebalance.js';
import { projectDividendIncome } from '../src/engine/dividends.js';
import { scanTaxLossOpportunities } from '../src/engine/taxLoss.js';

const readJson = async (file) => JSON.parse(await readFile(new URL(`../src/sample-data/${file}`, import.meta.url), 'utf8'));
const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const pct = (n) => `${(n * 100).toFixed(1)}%`;

const csvPath = process.argv[2] ?? new URL('../src/sample-data/sample-import.csv', import.meta.url);
const csvName = typeof csvPath === 'string' ? csvPath : 'sample-import.csv';
const marketData = await readJson('market-data.json');
const { targetWeights } = await readJson('portfolio.json');

// 1. Import
const imported = importCsvSources([{ name: csvName, text: await readFile(csvPath, 'utf8') }]);
console.log(`\n=== 1. Import: ${csvName} ===`);
console.log(`${imported.stats.lotsImported} lots in ${imported.accounts.length} accounts, ${imported.stats.rowsWithErrors} rows with errors.`);
console.table(imported.accounts);
for (const e of imported.errors) console.log(`✗ ${e.file}${e.line ? ` line ${e.line}` : ''}: ${e.message}`);
for (const w of imported.warnings) console.log(`⚠ ${w}`);
if (imported.lots.length === 0) process.exit(1);

// 2. Merge into holdings with (sample) prices
const { holdings, totals, warnings } = buildHoldings({
  lots: imported.lots,
  marketData,
  assetClasses: imported.assetClasses,
});
console.log(`\n=== 2. Holdings (sample prices) — total ${usd(totals.currentValue)}, gain ${usd(totals.unrealizedGain)} ===`);
console.table(
  holdings.map((h) => ({
    Ticker: h.ticker,
    Class: h.assetClass,
    Shares: h.shares,
    Value: usd(h.currentValue),
    Gain: usd(h.unrealizedGain),
  }))
);
for (const w of warnings) console.log(`⚠ ${w}`);

// 3. Rebalance with $1,000 of new cash
const rebalance = calculateRebalanceTrades({ holdings, targetWeights, newCash: 1000, mode: MODES.INFLOW_ONLY });
console.log('\n=== 3. Rebalance: invest $1,000 (inflow-only, proportional) ===');
console.table(
  rebalance.rows.map((r) => ({ Class: r.assetClass, Now: pct(r.currentPct), Target: pct(r.targetPct), Action: r.action, Amount: usd(r.tradeAmount), Ticker: r.ticker ?? '-' }))
);

// 4. Dividends
const dividends = projectDividendIncome({ holdings, years: 10, reinvestDividends: true });
const [first, last] = [dividends.annualSummary[0], dividends.annualSummary.at(-1)];
console.log(`\n=== 4. Dividends with DRIP: ${usd(first.projectedAnnualIncome)} in ${first.year} -> ${usd(last.projectedAnnualIncome)} in ${last.year} ===`);

// 5. Tax-loss scan. The database will give accounts and lots real ids; here we number them.
const accounts = imported.accounts.map((a, i) => ({ id: i + 1, ...a, dripEnabled: false }));
const accountId = (name) => accounts.find((a) => a.name === name).id;
const lots = imported.lots.map((l, i) => ({ id: i + 1, accountId: accountId(l.accountName), ...l }));
const prices = Object.fromEntries(Object.entries(marketData).filter(([k]) => k !== '_note').map(([t, q]) => [t, q.price]));
const taxLoss = scanTaxLossOpportunities({
  asOfDate: new Date().toISOString().slice(0, 10),
  accounts,
  lots,
  prices,
});
console.log(`\n=== 5. Tax-loss scan: ${usd(taxLoss.summary.totalHarvestableLoss)} harvestable ===`);
console.table(
  taxLoss.opportunities.map((o) => ({ Account: o.accountName, Ticker: o.ticker, Loss: usd(o.harvestableLoss), 'Wash sale': o.washSale.status }))
);
