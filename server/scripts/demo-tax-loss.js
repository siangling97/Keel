// Run with: npm run demo:tax-loss
//
// Scans the sample accounts (two taxable, one Roth IRA) for tax-loss harvesting opportunities.

import { readFile } from 'node:fs/promises';
import { scanTaxLossOpportunities } from '../src/engine/taxLoss.js';

const samplePath = new URL('../src/sample-data/tax-lots.json', import.meta.url);
const sample = JSON.parse(await readFile(samplePath, 'utf8'));

const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const result = scanTaxLossOpportunities(sample);

console.log(`\n=== Tax-loss harvesting scan as of ${result.asOfDate} (sample data) ===`);
console.log('For education only. Not tax advice.\n');

console.table(
  result.opportunities.map((o) => ({
    Account: o.accountName,
    Ticker: o.ticker,
    Loss: usd(o.harvestableLoss),
    Term: o.shortTermLoss > 0 && o.longTermLoss > 0 ? 'mixed' : o.shortTermLoss > 0 ? 'short' : 'long',
    'Shares to sell': o.sharesToSell,
    'Wash sale': o.washSale.status,
    'Consider instead': o.substitutes.map((s) => s.ticker).join(', ') || '-',
  }))
);

for (const o of result.opportunities) {
  const notes = [
    ...o.washSale.recentBuys.map(
      (b) => `Bought ${b.ticker} in "${b.accountName}" ${b.daysAgo} days ago (${b.reason}).`
    ),
    ...o.warnings,
  ];
  if (notes.length === 0) continue;
  console.log(`\n${o.ticker} in ${o.accountName}:`);
  for (const note of notes) console.log(`  • ${note}`);
}

const s = result.summary;
console.log(
  `\nTotal: ${usd(s.totalHarvestableLoss)} (${usd(s.shortTermLoss)} short-term, ${usd(s.longTermLoss)} long-term). ` +
    `${s.withWashSaleRisk} with wash-sale risk. ${s.taxAdvantagedLotsSkipped} IRA lots skipped.`
);
console.log(`Whatever you sell, don't buy it (or a same-index fund) back in ANY account before ${result.opportunities[0]?.washSale.doNotBuyBackBefore}.`);
