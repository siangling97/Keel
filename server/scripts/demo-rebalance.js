// Run with: npm run demo:rebalance
// Optional: npm run demo:rebalance -- 5000      (invest $5,000 instead of $2,000)
//
// Prints what the rebalancer recommends for the sample portfolio:
// inflow-only with each split strategy, then a full rebalance.

import { readFile } from 'node:fs/promises';
import { calculateRebalanceTrades, MODES, INFLOW_STRATEGIES } from '../src/engine/rebalance.js';

const samplePath = new URL('../src/sample-data/portfolio.json', import.meta.url);
const { holdings, targetWeights } = JSON.parse(await readFile(samplePath, 'utf8'));

const newCash = Number(process.argv[2] ?? 2000);

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const scenarios = [
  { mode: MODES.INFLOW_ONLY, inflowStrategy: INFLOW_STRATEGIES.PROPORTIONAL },
  { mode: MODES.INFLOW_ONLY, inflowStrategy: INFLOW_STRATEGIES.BIGGEST_GAP_FIRST },
  { mode: MODES.FULL_REBALANCE },
];

for (const scenario of scenarios) {
  const result = calculateRebalanceTrades({ holdings, targetWeights, newCash, ...scenario });
  const title = [result.mode, result.inflowStrategy].filter(Boolean).join(' / ');

  console.log(`\n=== ${title} — new cash ${usd(newCash)} — portfolio ${usd(result.currentTotal)} ===`);
  console.table(
    result.rows.map((r) => ({
      'Asset class': r.assetClass,
      Ticker: r.ticker ?? '(pick one)',
      Now: pct(r.currentPct),
      Target: pct(r.targetPct),
      Action: r.action,
      Amount: usd(r.tradeAmount),
      After: pct(r.projectedPct),
    }))
  );
  console.log(
    `Buy ${usd(result.summary.totalBuy)} · Sell ${usd(result.summary.totalSell)} · ` +
      `Cash left over ${usd(result.summary.cashLeftOver)}`
  );
  for (const warning of result.warnings) console.log(`⚠ ${warning}`);
}
