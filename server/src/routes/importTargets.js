// /api/import and /api/targets

import { Router } from 'express';
import { z } from 'zod';
import * as repo from '../repositories/portfolio.js';
import { importCsvSources } from '../import/importCsv.js';
import { listAdapters } from '../import/adapters/index.js';
import { HttpError } from '../http/errors.js';
import { ticker, assetClass, broker, todayUtc } from '../http/schemas.js';

const importSchema = z.strictObject({
  files: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(200),
        text: z.string().max(1_500_000, 'Each file must be under 1.5 MB.'),
      })
    )
    .min(1, 'Add at least one file.')
    .max(5, 'Up to 5 files at once.'),
  broker: broker.default('OTHER'),
  dryRun: z.boolean().default(false),
});

const WEIGHT_TOLERANCE = 0.0001;

const targetsSchema = z.strictObject({
  targets: z
    .array(
      z.strictObject({
        assetClass,
        weight: z.number().min(0).max(1, 'Weights are decimals: 0.55 means 55%.'),
        preferredTicker: ticker.optional(),
      })
    )
    .min(1)
    .max(30)
    .refine((ts) => new Set(ts.map((t) => t.assetClass)).size === ts.length, 'Each asset class can appear only once.')
    .refine(
      (ts) => Math.abs(ts.reduce((sum, t) => sum + t.weight, 0) - 1) <= WEIGHT_TOLERANCE,
      'Target weights must add up to 100%.'
    ),
});

export function importAndTargetRoutes({ db }) {
  const router = Router();

  router.get('/import/formats', (req, res) => {
    res.json({ formats: listAdapters() });
  });

  /**
   * Upload CSV text. With dryRun: true, nothing is saved; you get a preview with every error.
   * Without it, the import is saved only if there are NO row errors (all or nothing), so fixing a
   * file and uploading it again never creates half-duplicates.
   */
  router.post('/import', async (req, res) => {
    const { files, broker: brokerName, dryRun } = importSchema.parse(req.body);
    const imported = importCsvSources(files, { today: todayUtc() });

    const preview = {
      files: imported.files,
      accounts: imported.accounts,
      lots: imported.lots,
      assetClasses: imported.assetClasses,
      errors: imported.errors,
      warnings: imported.warnings,
      stats: imported.stats,
    };

    if (dryRun) return res.json({ saved: false, ...preview });

    if (imported.errors.length > 0) {
      throw new HttpError(
        422,
        'Nothing was saved. Fix the rows with errors and upload again.',
        imported.errors.map((e) => ({ field: e.line ? `${e.file} line ${e.line}` : e.file, message: e.message }))
      );
    }
    if (imported.lots.length === 0) throw new HttpError(422, 'The file has no lots to import.');

    const result = await repo.saveImport(db, req.user.id, imported, { broker: brokerName });
    if (result.skippedDuplicates > 0) {
      preview.warnings.push(`${result.skippedDuplicates} rows match lots you already have, so they were skipped.`);
    }
    res.status(201).json({ saved: true, ...result, ...preview });
  });

  router.get('/targets', async (req, res) => {
    res.json(await repo.getTargets(db, req.user.id));
  });

  router.put('/targets', async (req, res) => {
    const { targets } = targetsSchema.parse(req.body);
    res.json(await repo.replaceTargets(db, req.user.id, targets));
  });

  return router;
}
