// /api/portfolio/*: run the analyses on the logged-in user's saved data.
//
// The routes only validate input, load data and prices, and call engine/analysis.js.
// The browser's demo mode calls the same analysis functions, so both always agree.

import { Router } from 'express';
import { z } from 'zod';
import * as repo from '../repositories/portfolio.js';
import { isoDate, todayUtc } from '../http/schemas.js';
import { MODES, INFLOW_STRATEGIES } from '../engine/rebalance.js';
import {
  analyzeHoldings,
  analyzeRebalance,
  analyzeDividends,
  analyzeTaxLoss,
  tickersOf,
} from '../engine/analysis.js';

const rebalanceSchema = z.strictObject({
  mode: z.enum(Object.values(MODES)),
  newCash: z.number().min(0).max(1e10).default(0),
  inflowStrategy: z.enum(Object.values(INFLOW_STRATEGIES)).optional(),
  minTrade: z.number().min(0).max(1e9).optional(),
});

const dividendsSchema = z.strictObject({
  years: z.number().int().min(1).max(50).default(10),
  reinvestDividends: z.boolean().default(true),
  defaultDividendGrowthRate: z.number().optional(),
  defaultPriceGrowthRate: z.number().optional(),
});

const taxLossQuery = z.object({
  // The browser sends its own date, because "today" on a UTC server can already be tomorrow
  // for a user in Kansas City at 7 pm.
  asOfDate: isoDate.optional(),
  minLoss: z.coerce.number().min(0).max(1e9).optional(),
});

export function portfolioRoutes({ db, marketData }) {
  const router = Router();

  async function load(userId, asOfDate = todayUtc()) {
    const portfolio = await repo.loadPortfolio(db, userId, asOfDate);
    const quotes = await marketData.getQuotes(tickersOf(portfolio));
    return [portfolio, quotes, marketData.name];
  }

  router.get('/holdings', async (req, res) => {
    const { holdings, totals, warnings, priceSource } = analyzeHoldings(...(await load(req.user.id)));
    res.json({ holdings, totals, warnings, priceSource });
  });

  router.post('/rebalance', async (req, res) => {
    const options = rebalanceSchema.parse(req.body);
    res.json(analyzeRebalance(...(await load(req.user.id)), options));
  });

  router.post('/dividends', async (req, res) => {
    const options = dividendsSchema.parse(req.body);
    res.json(analyzeDividends(...(await load(req.user.id)), options));
  });

  router.get('/tax-loss', async (req, res) => {
    const { asOfDate = todayUtc(), minLoss } = taxLossQuery.parse(req.query);
    res.json(analyzeTaxLoss(...(await load(req.user.id, asOfDate)), { asOfDate, minLoss }));
  });

  return router;
}
