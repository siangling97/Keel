// Request-body rules shared by the routes, built with zod.
//
// z.strictObject rejects fields we don't expect. Without it, a request could sneak in
// something like { "userId": 2 } and a careless update might save it ("mass assignment").

import { z } from 'zod';
import { normalizeTicker, parseDate, parseAssetClass } from '../import/normalize.js';
import { ACCOUNT_TYPES } from '../engine/taxLoss.js';

/** Reuse the importer's cleaning functions ({ value } | { error }) inside zod. */
const fromParser = (parse) =>
  z.string().transform((raw, ctx) => {
    const result = parse(raw);
    if (result.error) {
      ctx.addIssue({ code: 'custom', message: result.error });
      return z.NEVER;
    }
    return result.value;
  });

export const ticker = fromParser(normalizeTicker);
export const isoDate = fromParser(parseDate);
export const assetClass = fromParser(parseAssetClass).refine((v) => v !== null, 'Asset class is empty.');
export const accountType = z.enum(ACCOUNT_TYPES);
export const broker = z.enum(['FIDELITY', 'VANGUARD', 'WEBULL', 'OTHER']);

/** Route ids like /accounts/:id must be positive whole numbers. */
export const idParam = z.coerce.number().int().positive();

export const todayUtc = () => new Date().toISOString().slice(0, 10);
