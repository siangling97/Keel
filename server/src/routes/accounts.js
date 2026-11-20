// /api/accounts and /api/lots and /api/asset-classes

import { Router } from 'express';
import { z } from 'zod';
import * as repo from '../repositories/portfolio.js';
import { HttpError } from '../http/errors.js';
import { ticker, isoDate, assetClass, accountType, broker, idParam, todayUtc } from '../http/schemas.js';

const newAccountSchema = z.strictObject({
  name: z.string().trim().min(1, 'Name is empty.').max(100),
  accountType,
  broker: broker.default('OTHER'),
  dripEnabled: z.boolean().default(false),
});

const accountChangesSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  accountType: accountType.optional(),
  broker: broker.optional(),
  dripEnabled: z.boolean().optional(),
});

const newLotSchema = z.strictObject({
  accountId: z.number().int().positive(),
  ticker,
  shares: z.number().positive('Shares must be more than 0.').max(1e11),
  costPerShare: z.number().min(0, "Cost can't be negative.").max(1e13),
  acquiredOn: isoDate.refine((d) => d <= todayUtc(), 'Acquired date is in the future.'),
  assetClass: assetClass.optional(),
});

const assetClassesSchema = z.record(ticker, assetClass).refine((m) => Object.keys(m).length > 0, 'Send at least one ticker.');

export function accountRoutes({ db }) {
  const router = Router();

  router.get('/accounts', async (req, res) => {
    res.json({ accounts: await repo.listAccounts(db, req.user.id) });
  });

  router.post('/accounts', async (req, res) => {
    const account = await repo.createAccount(db, req.user.id, newAccountSchema.parse(req.body));
    res.status(201).json({ account });
  });

  router.patch('/accounts/:id', async (req, res) => {
    const account = await repo.updateAccount(db, req.user.id, idParam.parse(req.params.id), accountChangesSchema.parse(req.body));
    res.json({ account });
  });

  router.delete('/accounts/:id', async (req, res) => {
    await repo.deleteAccount(db, req.user.id, idParam.parse(req.params.id));
    res.status(204).end();
  });

  router.get('/lots', async (req, res) => {
    res.json({ lots: await repo.listLots(db, req.user.id) });
  });

  // Manual entry: one lot at a time from a form.
  router.post('/lots', async (req, res) => {
    const lot = await repo.createLot(db, req.user.id, newLotSchema.parse(req.body));
    res.status(201).json({ lot });
  });

  router.delete('/lots/:id', async (req, res) => {
    await repo.deleteLot(db, req.user.id, idParam.parse(req.params.id));
    res.status(204).end();
  });

  // Classify tickers: { "VTI": "US_EQUITY", "BND": "BONDS" }
  router.put('/asset-classes', async (req, res) => {
    const classes = assetClassesSchema.parse(req.body);
    if (Object.keys(classes).length > 500) throw new HttpError(400, 'Too many tickers at once (max 500).');
    await repo.upsertAssetClasses(db, req.user.id, classes);
    res.json({ assetClasses: classes });
  });

  return router;
}
