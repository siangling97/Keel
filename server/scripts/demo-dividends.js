// Run with: npm run demo:dividends
// Optional: npm run demo:dividends -- 20      (project 20 years instead of 10)
//
// Projects dividend income for the sample portfolio with DRIP off and on, side by side.

import { readFile } from 'node:fs/promises';
import { projectDividendIncome, DEFAULT_ASSUMPTIONS } from '../src/engine/dividends.js';

const samplePath = new URL('../src/sample-data/portfolio.json', import.meta.url);
const { holdings } = JSON.parse(await readFile(samplePath, 'utf8'));

const years = Number(process.argv[2] ?? 10);
const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const without = projectDividendIncome({ holdings, years, reinvestDividends: false });
const withDrip = projectDividendIncome({ holdings, years, reinvestDividends: true });

console.log(`\n=== Dividend projection, ${years} years (sample portfolio) ===`);
console.log(
  `Assumptions: dividends grow ${DEFAULT_ASSUMPTIONS.dividendGrowthRate * 100}%/yr, ` +
    `prices grow ${DEFAULT_ASSUMPTIONS.priceGrowthRate * 100}%/yr, unless a holding sets its own.`
);
console.table(
  without.annualSummary.map((year, i) => {
    const drip = withDrip.annualSummary[i];
    return {
      Year: year.year,
      'Income (no DRIP)': usd(year.projectedAnnualIncome),
      'Income (DRIP)': usd(drip.projectedAnnualIncome),
      'Monthly avg (DRIP)': usd(drip.projectedMonthlyAverage),
      'Portfolio (DRIP)': usd(drip.projectedPortfolioValue),
    };
  })
);

const last = years - 1;
const extraIncome = withDrip.annualSummary[last].projectedAnnualIncome - without.annualSummary[last].projectedAnnualIncome;
console.log(`In year ${years}, DRIP adds ${usd(extraIncome)} of yearly income.`);
console.log(
  `Without DRIP you'd have collected ${usd(without.annualSummary[last].cumulativeIncome)} in cash along the way.`
);
console.log('\nShares after DRIP:');
console.table(withDrip.finalHoldings);
