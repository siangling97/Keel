// Demo mode: the whole app runs in the browser on sample data. No account, no server.
//
// It has the same methods as httpApi.js and returns the same shapes, so no page knows which one
// it's using. It runs the very same engine code as the server (imported from server/src), so the
// numbers are identical. Changes are kept in sessionStorage: they last until the tab is closed.

import { ApiError } from './httpApi.js';
import { importCsvSources } from '@shared/import/importCsv.js';
import { normalizeTicker, parseDate, parseAssetClass } from '@shared/import/normalize.js';
import { ACCOUNT_TYPES } from '@shared/engine/taxLoss.js';
import { ValidationError } from '@shared/engine/errors.js';
import { analyzeHoldings, analyzeRebalance, analyzeDividends, analyzeTaxLoss } from '@shared/engine/analysis.js';
import sampleCsv from '@shared/sample-data/sample-import.csv?raw';
import marketData from '@shared/sample-data/market-data.json';
import samplePortfolio from '@shared/sample-data/portfolio.json';
import taxSample from '@shared/sample-data/tax-lots.json';
import { localToday, daysAgo } from '../lib/format.js';

const STORAGE_KEY = 'keel-demo-state';
const PRICE_SOURCE = 'sample (made-up prices)';
const DEMO_USER = { id: 0, email: 'demo@keel.example' };

/** Fresh sample portfolio, built by running the real CSV importer on the sample file. */
function freshState() {
  const today = localToday();
  const imported = importCsvSources([{ name: 'sample-import.csv', text: sampleCsv }], { today });

  const accounts = imported.accounts.map((a, i) => ({
    id: i + 1,
    broker: 'OTHER',
    name: a.name,
    accountType: a.accountType,
    // DRIP on in the Roth, so the tax-loss page can show its wash-sale warning.
    dripEnabled: a.accountType === 'ROTH_IRA',
  }));
  const accountIdOf = (name) => accounts.find((a) => a.name === name).id;

  const lots = imported.lots.map((l, i) => {
    // Keep the demo's "bought in the Roth two weeks ago" story true on any day you open it.
    const recent = l.accountType === 'ROTH_IRA' && l.ticker === 'VXUS';
    return {
      id: i + 1,
      accountId: accountIdOf(l.accountName),
      ticker: l.ticker,
      shares: l.shares,
      costPerShare: l.costPerShare,
      acquiredOn: recent ? daysAgo(14, today) : l.acquiredOn,
    };
  });

  return {
    accounts,
    lots,
    userClasses: { ...imported.assetClasses },
    targets: Object.entries(samplePortfolio.targetWeights).map(([assetClass, weight]) => ({ assetClass, weight })),
    nextId: 1000,
  };
}

function load() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Storage can be blocked (private mode). Fall back to a fresh copy.
  }
  return freshState();
}

export function createDemoApi() {
  let state = load();

  const save = () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Not fatal: the demo still works, it just won't survive a reload.
    }
  };
  const nextId = () => state.nextId++;
  const fail = (status, message, details) => {
    throw new ApiError(status, message, details);
  };
  const accountById = (id) => state.accounts.find((a) => a.id === Number(id)) ?? fail(404, 'Account not found.');

  /** Same as the server's loadPortfolio(), built from the in-memory state. */
  function portfolio() {
    const accountName = (id) => state.accounts.find((a) => a.id === id)?.name;
    const securities = taxSample.securities.map((s) => ({
      ticker: s.ticker,
      trackedIndex: s.trackedIndex ?? null,
      assetClass: state.userClasses[s.ticker] ?? s.assetClass ?? null,
    }));
    const defaults = Object.fromEntries(securities.filter((s) => s.assetClass).map((s) => [s.ticker, s.assetClass]));
    return {
      accounts: state.accounts,
      lots: state.lots.map((l) => ({ ...l, accountName: accountName(l.accountId) })),
      assetClasses: { ...defaults, ...state.userClasses },
      targetWeights: Object.fromEntries(state.targets.map((t) => [t.assetClass, t.weight])),
      preferredTickers: Object.fromEntries(state.targets.filter((t) => t.preferredTicker).map((t) => [t.assetClass, t.preferredTicker])),
      securities,
      transactions: [],
    };
  }

  const quotes = () => {
    const tickers = new Set(state.lots.map((l) => l.ticker));
    return Object.fromEntries(Object.entries(marketData).filter(([t]) => tickers.has(t)));
  };

  /** Run an engine function and turn its ValidationError into a 400, like the server does. */
  const run = async (fn) => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof ValidationError) fail(400, err.message);
      throw err;
    }
  };

  const clean = (parse, raw, field) => {
    const result = parse(String(raw ?? ''));
    if (result.error || result.value === null) fail(400, 'Some fields are invalid.', [{ field, message: result.error ?? `${field} is empty.` }]);
    return result.value;
  };

  const lotView = (lot) => ({ ...lot, accountName: accountById(lot.accountId).name, accountType: accountById(lot.accountId).accountType });

  return {
    isDemo: true,

    me: async () => ({ user: DEMO_USER }),
    logout: async () => {
      sessionStorage.removeItem(STORAGE_KEY);
      state = freshState();
      return null;
    },
    reset: async () => {
      state = freshState();
      save();
    },

    listAccounts: async () => ({ accounts: state.accounts }),
    createAccount: async ({ name, accountType, broker = 'OTHER', dripEnabled = false }) => {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) fail(400, 'Some fields are invalid.', [{ field: 'name', message: 'Name is empty.' }]);
      if (!ACCOUNT_TYPES.includes(accountType)) fail(400, 'Some fields are invalid.', [{ field: 'accountType', message: 'Pick an account type.' }]);
      if (state.accounts.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
        fail(409, `You already have an account named "${trimmed}".`);
      }
      const account = { id: nextId(), name: trimmed, accountType, broker, dripEnabled };
      state.accounts.push(account);
      save();
      return { account };
    },
    updateAccount: async (id, changes) => {
      const account = accountById(id);
      Object.assign(account, changes);
      save();
      return { account };
    },
    deleteAccount: async (id) => {
      accountById(id);
      state.accounts = state.accounts.filter((a) => a.id !== Number(id));
      state.lots = state.lots.filter((l) => l.accountId !== Number(id));
      save();
      return null;
    },

    listLots: async () => ({ lots: state.lots.map(lotView) }),
    createLot: async ({ accountId, ticker, shares, costPerShare, acquiredOn, assetClass }) => {
      accountById(accountId);
      const lot = {
        id: nextId(),
        accountId: Number(accountId),
        ticker: clean(normalizeTicker, ticker, 'ticker'),
        shares: Number(shares),
        costPerShare: Number(costPerShare),
        acquiredOn: clean(parseDate, acquiredOn, 'acquiredOn'),
      };
      if (!(lot.shares > 0)) fail(400, 'Some fields are invalid.', [{ field: 'shares', message: 'Shares must be more than 0.' }]);
      if (!(lot.costPerShare >= 0)) fail(400, 'Some fields are invalid.', [{ field: 'costPerShare', message: "Cost can't be negative." }]);
      if (lot.acquiredOn > localToday()) fail(400, 'Some fields are invalid.', [{ field: 'acquiredOn', message: 'Acquired date is in the future.' }]);
      if (assetClass) state.userClasses[lot.ticker] = clean(parseAssetClass, assetClass, 'assetClass');
      state.lots.push(lot);
      save();
      return { lot: lotView(lot) };
    },
    deleteLot: async (id) => {
      if (!state.lots.some((l) => l.id === Number(id))) fail(404, 'Lot not found.');
      state.lots = state.lots.filter((l) => l.id !== Number(id));
      save();
      return null;
    },
    setAssetClasses: async (classes) => {
      for (const [ticker, code] of Object.entries(classes)) {
        state.userClasses[clean(normalizeTicker, ticker, 'ticker')] = clean(parseAssetClass, code, 'assetClass');
      }
      save();
      return { assetClasses: classes };
    },

    // Same rules as the server: preview with dryRun; otherwise all or nothing, and skip exact copies.
    importFiles: async ({ files, dryRun }) => {
      const imported = importCsvSources(files, { today: localToday() });
      const preview = {
        files: imported.files,
        accounts: imported.accounts,
        lots: imported.lots,
        assetClasses: imported.assetClasses,
        errors: imported.errors,
        warnings: imported.warnings,
        stats: imported.stats,
      };
      if (dryRun) return { saved: false, ...preview };
      if (imported.errors.length > 0) {
        fail(422, 'Nothing was saved. Fix the rows with errors and upload again.',
          imported.errors.map((e) => ({ field: e.line ? `${e.file} line ${e.line}` : e.file, message: e.message })));
      }
      if (imported.lots.length === 0) fail(422, 'The file has no lots to import.');

      const byName = new Map(state.accounts.map((a) => [a.name.toLowerCase(), a]));
      const conflicts = imported.accounts
        .filter((a) => byName.get(a.name.toLowerCase()) && byName.get(a.name.toLowerCase()).accountType !== a.accountType)
        .map((a) => ({ field: 'Account Type', message: `"${a.name}" is already saved as ${byName.get(a.name.toLowerCase()).accountType}, but the file says ${a.accountType}.` }));
      if (conflicts.length) fail(422, 'Nothing was saved. Fix these and upload again.', conflicts);

      const createdAccounts = [];
      for (const a of imported.accounts) {
        if (!byName.has(a.name.toLowerCase())) {
          const account = { id: nextId(), name: a.name, accountType: a.accountType, broker: 'OTHER', dripEnabled: false };
          state.accounts.push(account);
          byName.set(a.name.toLowerCase(), account);
          createdAccounts.push(a.name);
        }
      }
      const key = (l) => [l.accountId, l.ticker, l.shares, l.costPerShare, l.acquiredOn].join('|');
      const existing = new Set(state.lots.map(key));
      let skippedDuplicates = 0;
      let lotsSaved = 0;
      for (const l of imported.lots) {
        const lot = { id: nextId(), accountId: byName.get(l.accountName.toLowerCase()).id, ticker: l.ticker, shares: l.shares, costPerShare: l.costPerShare, acquiredOn: l.acquiredOn };
        if (existing.has(key(lot))) {
          skippedDuplicates++;
          continue;
        }
        state.lots.push(lot);
        lotsSaved++;
      }
      Object.assign(state.userClasses, imported.assetClasses);
      if (skippedDuplicates) preview.warnings.push(`${skippedDuplicates} rows match lots you already have, so they were skipped.`);
      save();
      return { saved: true, createdAccounts, lotsSaved, skippedDuplicates, ...preview };
    },

    getTargets: async () => {
      const p = portfolio();
      return { targetWeights: p.targetWeights, preferredTickers: p.preferredTickers };
    },
    saveTargets: async (targets) => {
      const total = targets.reduce((sum, t) => sum + t.weight, 0);
      if (Math.abs(total - 1) > 0.0001) fail(400, 'Some fields are invalid.', [{ field: 'targets', message: 'Target weights must add up to 100%.' }]);
      state.targets = targets.map((t) => ({
        assetClass: clean(parseAssetClass, t.assetClass, 'assetClass'),
        weight: t.weight,
        ...(t.preferredTicker ? { preferredTicker: clean(normalizeTicker, t.preferredTicker, 'preferredTicker') } : {}),
      }));
      save();
      const p = portfolio();
      return { targetWeights: p.targetWeights, preferredTickers: p.preferredTickers };
    },

    holdings: () =>
      run(() => {
        const { holdings, totals, warnings, priceSource } = analyzeHoldings(portfolio(), quotes(), PRICE_SOURCE);
        return { holdings, totals, warnings, priceSource };
      }),
    rebalance: (options) => run(() => analyzeRebalance(portfolio(), quotes(), PRICE_SOURCE, options)),
    dividends: (options) => run(() => analyzeDividends(portfolio(), quotes(), PRICE_SOURCE, options)),
    taxLoss: ({ asOfDate = localToday(), minLoss }) =>
      run(() => analyzeTaxLoss(portfolio(), quotes(), PRICE_SOURCE, { asOfDate, minLoss: minLoss === '' ? undefined : minLoss })),
  };
}
