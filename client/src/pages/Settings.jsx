import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSession, usePortfolioData } from '../api/session.jsx';
import { PageHeader, Section, Table, Loading, ErrorAlert, Button, Field, Input, Select, Switch } from '../components/ui.jsx';
import { className, COMMON_CLASSES, sortClasses } from '../lib/assetClasses.js';
import { accountTypeName } from './Holdings.jsx';

const ACCOUNT_TYPES = ['TAXABLE', 'TRADITIONAL_IRA', 'ROTH_IRA', '401K', 'HSA', 'OTHER_TAX_ADVANTAGED'];

export function Settings() {
  const { status, user } = useSession();
  return (
    <div>
      <PageHeader title="Settings" />
      <TargetEditor />
      <Accounts />
      {status === 'user' && (
        <>
          <Section title="Your login">
            <p className="text-ink-2">Signed in as {user.email}.</p>
          </Section>
          <DeleteMyAccount />
        </>
      )}
    </div>
  );
}

/** The target mix: weights entered as percents, saved as decimals (55% -> 0.55). */
export function TargetEditor() {
  const { api, refresh } = useSession();
  const { data, error: loadError } = usePortfolioData((a) => a.getTargets());
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data || rows) return;
    const classes = sortClasses(Object.keys(data.targetWeights));
    setRows(
      classes.length
        ? classes.map((c) => ({ assetClass: c, percent: String(+(data.targetWeights[c] * 100).toFixed(2)), preferredTicker: data.preferredTickers[c] ?? '' }))
        : [{ assetClass: 'US_EQUITY', percent: '60', preferredTicker: '' }, { assetClass: 'BONDS', percent: '40', preferredTicker: '' }]
    );
  }, [data, rows]);

  if (!rows) return loadError ? <ErrorAlert error={loadError} /> : <Loading />;

  const total = rows.reduce((sum, r) => sum + (Number(r.percent) || 0), 0);
  const totalOk = Math.abs(total - 100) < 0.01;
  const update = (i, key, value) => {
    setSaved(false);
    setRows(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  };

  async function save(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.saveTargets(
        rows.map((r) => ({
          assetClass: r.assetClass,
          weight: Math.round(Number(r.percent) * 100) / 10000,
          ...(r.preferredTicker.trim() ? { preferredTicker: r.preferredTicker.trim() } : {}),
        }))
      );
      setSaved(true);
      refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Section title="Target mix" description="The mix you want. Percents must add up to 100. The fund you pick for a class is what Keel suggests buying.">
      <form onSubmit={save} noValidate>
        <Table caption="Target mix">
          <thead>
            <tr>
              <th>Asset class</th>
              <th className="w-32 text-right">Percent</th>
              <th className="w-40">Fund to buy</th>
              <th>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <Select aria-label="Asset class" value={r.assetClass} onChange={(e) => update(i, 'assetClass', e.target.value)} className="max-w-64">
                    {[...new Set([...COMMON_CLASSES, r.assetClass])].map((c) => (
                      <option key={c} value={c}>
                        {className(c)}
                      </option>
                    ))}
                  </Select>
                </td>
                <td>
                  <Input aria-label={`Percent for ${className(r.assetClass)}`} inputMode="decimal" className="num text-right" value={r.percent} onChange={(e) => update(i, 'percent', e.target.value)} />
                </td>
                <td>
                  <Input aria-label={`Fund to buy for ${className(r.assetClass)}`} placeholder="Optional" value={r.preferredTicker} onChange={(e) => update(i, 'preferredTicker', e.target.value)} />
                </td>
                <td className="text-right">
                  <Button variant="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length === 1}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-3 font-semibold">Total</td>
              <td className={`num pt-3 text-right font-semibold ${totalOk ? 'text-ink' : 'text-loss'}`} aria-live="polite">
                {+total.toFixed(2)}%
              </td>
              <td colSpan={2} className="pt-3 text-sm text-ink-2">
                {totalOk ? '' : `${total < 100 ? 'Add' : 'Remove'} ${+Math.abs(100 - total).toFixed(2)} points to reach 100%.`}
              </td>
            </tr>
          </tfoot>
        </Table>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Button
            variant="secondary"
            onClick={() => {
              const unused = COMMON_CLASSES.find((c) => !rows.some((r) => r.assetClass === c)) ?? 'CASH';
              setRows([...rows, { assetClass: unused, percent: '0', preferredTicker: '' }]);
            }}
          >
            Add a class
          </Button>
          <Button type="submit" disabled={!totalOk}>
            Save target mix
          </Button>
          {saved && (
            <span role="status" className="text-gain">
              Saved.
            </span>
          )}
        </div>
        <div className="mt-4">
          <ErrorAlert error={error} />
        </div>
      </form>
    </Section>
  );
}

function Accounts() {
  const { api, refresh } = useSession();
  const { data, error: loadError } = usePortfolioData((a) => a.listAccounts());
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [form, setForm] = useState({ name: '', accountType: 'TAXABLE' });

  async function act(fn) {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Section
      title="Accounts"
      description="Account type decides whether a loss can be harvested. Turn on DRIP where your broker reinvests dividends, so the tax-loss scan can warn you about wash sales."
    >
      <ErrorAlert error={loadError ?? error} />
      {data && data.accounts.length > 0 && (
        <Table caption="Accounts">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Dividends</th>
              <th>
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => (
              <tr key={a.id}>
                <td className="font-semibold">{a.name}</td>
                <td className="text-ink-2">{accountTypeName(a.accountType)}</td>
                <td>
                  <Switch
                    checked={a.dripEnabled}
                    label={a.dripEnabled ? 'Reinvested (DRIP)' : 'Paid as cash'}
                    onChange={(checked) => act(() => api.updateAccount(a.id, { dripEnabled: checked }))}
                  />
                </td>
                <td className="text-right">
                  {confirming === a.id ? (
                    <span className="inline-flex flex-wrap items-center justify-end gap-3">
                      <span className="text-sm text-ink-2">Delete it and its purchases?</span>
                      <Button variant="danger" onClick={() => act(() => api.deleteAccount(a.id))}>
                        Delete
                      </Button>
                      <Button variant="quiet" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <Button variant="danger" onClick={() => setConfirming(a.id)}>
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <form
        className="mt-6 flex flex-wrap items-end gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            await api.createAccount(form);
            setForm({ name: '', accountType: 'TAXABLE' });
          });
        }}
      >
        <Field label="New account name" className="w-64">
          {(p) => <Input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Fidelity Brokerage" />}
        </Field>
        <Field label="Type" className="w-56">
          {(p) => (
            <Select {...p} value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {accountTypeName(t)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="secondary" disabled={!form.name.trim()}>
          Add account
        </Button>
      </form>
    </Section>
  );
}

/**
 * Permanently delete the user's Keel account. Two steps (open, then confirm with the password),
 * so it can't happen by accident, and the second button says exactly what it does.
 */
export function DeleteMyAccount() {
  const { deleteMyAccount } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount(password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const fieldError = error?.details?.find((d) => d.field === 'password')?.message;

  return (
    <Section title="Delete your account">
      <div className="max-w-[60ch] rounded-[10px] border border-loss/40 bg-surface p-6">
        <p>
          This permanently deletes your Keel account and everything in it: your brokerage accounts, purchases, target mix and
          asset classes. It can't be undone.
        </p>
        {!open ? (
          <Button variant="secondary" className="mt-4 border-loss/60! text-loss!" onClick={() => setOpen(true)}>
            Delete my account
          </Button>
        ) : (
          <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4">
            <Field label="Enter your password to confirm" error={fieldError}>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            {error && !fieldError && <ErrorAlert error={error} />}
            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" disabled={busy || !password} className="bg-loss! hover:bg-loss/90!">
                {busy ? 'Deleting…' : 'Permanently delete my account'}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setOpen(false);
                  setPassword('');
                  setError(null);
                }}
              >
                Keep my account
              </Button>
            </div>
          </form>
        )}
      </div>
    </Section>
  );
}
