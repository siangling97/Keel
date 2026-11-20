import { useState } from 'react';
import { Link } from 'react-router';
import { useSession, usePortfolioData } from '../api/session.jsx';
import { PageHeader, Section, Table, Loading, ErrorAlert, Warnings, Button, Field, Input, Select, GainLoss } from '../components/ui.jsx';
import { className, COMMON_CLASSES } from '../lib/assetClasses.js';
import { usd, signedUsd, pct, shares, date, localToday } from '../lib/format.js';

const ACCOUNT_TYPE_NAMES = {
  TAXABLE: 'Taxable',
  TRADITIONAL_IRA: 'Traditional IRA',
  ROTH_IRA: 'Roth IRA',
  '401K': '401(k)',
  HSA: 'HSA',
  OTHER_TAX_ADVANTAGED: 'Other tax-advantaged',
};
export const accountTypeName = (code) => ACCOUNT_TYPE_NAMES[code] ?? code;

export function Holdings() {
  const { data, error, loading } = usePortfolioData(async (api) => {
    const [h, l, a] = await Promise.all([api.holdings(), api.listLots(), api.listAccounts()]);
    return { ...h, lots: l.lots, accounts: a.accounts };
  });

  if (!data && loading) return <Loading />;
  if (!data) return <ErrorAlert error={error} />;

  const total = data.totals.currentValue;
  const unclassified = data.holdings.filter((h) => h.assetClass === 'UNCLASSIFIED').map((h) => h.ticker);

  return (
    <div>
      <PageHeader title="Holdings">
        One row per fund or stock, added up across all your accounts. Below that, every purchase (lot) by account.
      </PageHeader>
      <ErrorAlert error={error} />

      {data.holdings.length > 0 ? (
        <Table caption="Holdings">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Asset class</th>
              <th className="text-right">Shares</th>
              <th className="text-right">Price</th>
              <th className="text-right">Value</th>
              <th className="text-right">Gain or loss</th>
              <th className="text-right">Of portfolio</th>
            </tr>
          </thead>
          <tbody>
            {data.holdings.map((h) => (
              <tr key={h.ticker}>
                <td className="font-semibold">{h.ticker}</td>
                <td className="text-ink-2">{className(h.assetClass)}</td>
                <td className="num text-right">{shares(h.shares)}</td>
                <td className="num text-right">{usd(h.currentPrice)}</td>
                <td className="num text-right">{usd(h.currentValue)}</td>
                <td className="num text-right">
                  <GainLoss value={h.unrealizedGain}>{signedUsd(h.unrealizedGain)}</GainLoss>
                </td>
                <td className="num text-right">{pct(total > 0 ? h.currentValue / total : 0)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="text-ink-2">
          Nothing here yet. <Link className="font-semibold text-primary underline-offset-4 hover:underline" to="/import">Import a CSV</Link> or add a
          purchase below.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <Warnings warnings={data.warnings} />
        {unclassified.length > 0 && <Classify tickers={unclassified} />}
      </div>

      <Section title="Purchases by account" description="Each purchase is a lot. Tax-loss harvesting works lot by lot, because each one has its own price and date.">
        {data.accounts.length === 0 ? (
          <p className="text-ink-2">Add an account in Settings first.</p>
        ) : (
          <LotsTable accounts={data.accounts} lots={data.lots} />
        )}
      </Section>

      {data.accounts.length > 0 && (
        <Section title="Add a purchase">
          <AddLotForm accounts={data.accounts} />
        </Section>
      )}
    </div>
  );
}

/** One table, one group of rows per account, so the columns line up across accounts. */
function LotsTable({ accounts, lots }) {
  const { api, refresh } = useSession();
  const [error, setError] = useState(null);

  async function remove(id) {
    setError(null);
    try {
      await api.deleteLot(id);
      refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <ErrorAlert error={error} />
      <Table caption="Purchases by account">
        <thead>
          <tr>
            <th className="w-[28%]">Ticker</th>
            <th className="text-right">Shares</th>
            <th className="text-right">Cost per share</th>
            <th className="text-right">Bought on</th>
            <th className="w-24 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {accounts.map((account) => {
          const accountLots = lots.filter((l) => l.accountId === account.id);
          return (
            <tbody key={account.id}>
              <tr>
                <th colSpan={5} scope="rowgroup" className="pt-6! text-left text-[15px]! text-ink!">
                  {account.name} <span className="font-normal text-ink-2">{accountTypeName(account.accountType)}</span>
                </th>
              </tr>
              {accountLots.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-sm text-muted">
                    No purchases in this account.
                  </td>
                </tr>
              )}
              {accountLots.map((lot) => (
                <tr key={lot.id}>
                  <td className="font-semibold">{lot.ticker}</td>
                  <td className="num text-right">{shares(lot.shares)}</td>
                  <td className="num text-right">{usd(lot.costPerShare)}</td>
                  <td className="num text-right">{date(lot.acquiredOn)}</td>
                  <td className="text-right">
                    <Button variant="danger" onClick={() => remove(lot.id)} aria-label={`Delete ${lot.ticker} purchase from ${date(lot.acquiredOn)}`}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </Table>
    </>
  );
}

function AddLotForm({ accounts }) {
  const { api, refresh } = useSession();
  const empty = { accountId: String(accounts[0].id), ticker: '', shares: '', costPerShare: '', acquiredOn: localToday(), assetClass: '' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const fieldError = (field) => error?.details?.find((d) => d.field === field)?.message;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    try {
      const { lot } = await api.createLot({
        accountId: Number(form.accountId),
        ticker: form.ticker,
        shares: Number(form.shares),
        costPerShare: Number(form.costPerShare),
        acquiredOn: form.acquiredOn,
        ...(form.assetClass ? { assetClass: form.assetClass } : {}),
      });
      setSaved(`Added ${shares(lot.shares)} ${lot.ticker} to ${lot.accountName}.`);
      setForm({ ...empty, accountId: form.accountId });
      refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid max-w-[880px] gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Account">
        {(p) => (
          <Select {...p} value={form.accountId} onChange={set('accountId')}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Ticker" error={fieldError('ticker')}>
        {(p) => <Input {...p} value={form.ticker} onChange={set('ticker')} placeholder="VTI" autoCapitalize="characters" />}
      </Field>
      <Field label="Asset class" hint="Optional if Keel already knows it.">
        {(p) => (
          <Select {...p} value={form.assetClass} onChange={set('assetClass')}>
            <option value="">Keep current</option>
            {COMMON_CLASSES.map((c) => (
              <option key={c} value={c}>
                {className(c)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Shares" error={fieldError('shares')}>
        {(p) => <Input {...p} inputMode="decimal" value={form.shares} onChange={set('shares')} placeholder="10" />}
      </Field>
      <Field label="Cost per share" error={fieldError('costPerShare')}>
        {(p) => <Input {...p} inputMode="decimal" value={form.costPerShare} onChange={set('costPerShare')} placeholder="250.00" />}
      </Field>
      <Field label="Bought on" error={fieldError('acquiredOn')}>
        {(p) => <Input {...p} type="date" max={localToday()} value={form.acquiredOn} onChange={set('acquiredOn')} />}
      </Field>
      <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-3">
        {error && !error.details?.length && <ErrorAlert error={error} />}
        {saved && (
          <p role="status" className="text-gain">
            {saved}
          </p>
        )}
        <div>
          <Button type="submit">Add purchase</Button>
        </div>
      </div>
    </form>
  );
}

function Classify({ tickers }) {
  const { api, refresh } = useSession();
  const [choices, setChoices] = useState({});
  const [error, setError] = useState(null);
  const ready = Object.values(choices).filter(Boolean).length > 0;

  async function save() {
    setError(null);
    try {
      await api.setAssetClasses(Object.fromEntries(Object.entries(choices).filter(([, v]) => v)));
      setChoices({});
      refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="rounded-[10px] border border-rule bg-surface p-5">
      <h2 className="font-semibold">Pick an asset class for {tickers.length === 1 ? 'this ticker' : 'these tickers'}</h2>
      <p className="mt-1 text-sm text-ink-2">The rebalancer needs to know where each holding belongs.</p>
      <div className="mt-4 flex flex-wrap gap-4">
        {tickers.map((t) => (
          <Field key={t} label={t} className="w-56">
            {(p) => (
              <Select {...p} value={choices[t] ?? ''} onChange={(e) => setChoices({ ...choices, [t]: e.target.value })}>
                <option value="">Choose…</option>
                {COMMON_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {className(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
      </div>
      <ErrorAlert error={error} />
      <Button className="mt-4" onClick={save} disabled={!ready}>
        Save asset classes
      </Button>
    </div>
  );
}
