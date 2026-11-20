import { useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '../api/session.jsx';
import { PageHeader, Section, Table, Button, ErrorAlert, Warnings, Alert } from '../components/ui.jsx';
import { TEMPLATE_HEADERS } from '@shared/import/adapters/template.js';
import { usd, shares, date } from '../lib/format.js';
import { accountTypeName } from './Holdings.jsx';

const MAX_BYTES = 1_500_000;
const PREVIEW_ROWS = 50;

function downloadTemplate() {
  const csv = `${TEMPLATE_HEADERS.join(',')}\nMy Brokerage,Taxable,VTI,10,250.00,2025-01-15,US_EQUITY\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'keel-import-template.csv' });
  link.click();
  URL.revokeObjectURL(url);
}

export function Import() {
  const { api, refresh } = useSession();
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function choose(fileList) {
    setPreview(null);
    setResult(null);
    setError(null);
    const chosen = [...fileList].slice(0, 5);
    const tooBig = chosen.find((f) => f.size > MAX_BYTES);
    if (tooBig) return setError({ message: `${tooBig.name} is over 1.5 MB. Split it into smaller files.` });

    setBusy(true);
    try {
      const read = await Promise.all(chosen.map(async (f) => ({ name: f.name, text: await f.text() })));
      setFiles(read);
      // Check first, save later: nothing is stored until you press Save.
      setPreview(await api.importFiles({ files: read, dryRun: true }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.importFiles({ files, dryRun: false }));
      setPreview(null);
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Import">
        Add many purchases at once from a CSV file. Keel checks every row first and saves nothing until you say so.
      </PageHeader>

      <ol className="flex max-w-[760px] flex-col gap-10">
        <Step n={1} title="Fill in the template">
          <p className="text-ink-2">
            One row per purchase. Many broker downloads already work: Keel also accepts headers like Symbol, Quantity, Cost Basis
            Total and Date Acquired.
          </p>
          <Table caption="Template columns" className="mt-4">
            <thead>
              <tr>
                {TEMPLATE_HEADERS.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="text-ink-2">
                <td>My Brokerage</td>
                <td>Taxable</td>
                <td>VTI</td>
                <td className="num">10</td>
                <td className="num">250.00</td>
                <td className="num">2025-01-15</td>
                <td>US_EQUITY</td>
              </tr>
            </tbody>
          </Table>
          <Button variant="secondary" className="mt-4" onClick={downloadTemplate}>
            Download the template
          </Button>
        </Step>

        <Step n={2} title="Choose your files">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choose(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-[10px] border-2 border-dashed px-6 py-10 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
              dragging ? 'border-primary bg-primary-soft' : 'border-rule-strong bg-surface hover:border-ink-2'
            }`}
          >
            <span className="font-semibold">Drop CSV files here, or click to choose</span>
            <span className="mt-1 text-sm text-muted">Up to 5 files, 1.5 MB each. One file per broker is fine.</span>
            <input type="file" accept=".csv,text/csv" multiple className="sr-only" onChange={(e) => choose(e.target.files)} />
          </label>
          {busy && !preview && <p className="mt-3 text-muted" role="status">Checking your files…</p>}
        </Step>

        <Step n={3} title="Check and save">
          {!preview && !result && <p className="text-muted">Your rows will show up here.</p>}
          <ErrorAlert error={error} />
          {preview && <Preview preview={preview} onSave={save} busy={busy} />}
          {result && <Saved result={result} />}
        </Step>
      </ol>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <li className="grid grid-cols-[2.25rem_1fr] gap-x-3">
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full border border-rule-strong text-sm font-semibold text-ink-2">
        {n}
      </span>
      <div>
        <h2 className="text-[21px] font-bold tracking-[-0.01em]">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </li>
  );
}

function Preview({ preview, onSave, busy }) {
  const { stats, errors, warnings, accounts, lots } = preview;
  const canSave = errors.length === 0 && lots.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[17px]">
        {stats.lotsImported} {stats.lotsImported === 1 ? 'purchase' : 'purchases'} ready in {accounts.length}{' '}
        {accounts.length === 1 ? 'account' : 'accounts'}
        {stats.rowsWithErrors > 0 && `, and ${stats.rowsWithErrors} ${stats.rowsWithErrors === 1 ? 'row needs' : 'rows need'} fixing`}.
      </p>

      {errors.length > 0 && (
        <Alert
          tone="error"
          title="Fix these rows, then choose the file again. Nothing is saved while there are errors."
          items={errors.map((e) => `${e.file}${e.line ? `, line ${e.line}` : ''}: ${e.message}`)}
        />
      )}
      <Warnings warnings={warnings} />

      {lots.length > 0 && (
        <Table caption="Purchases to import">
          <thead>
            <tr>
              <th>Account</th>
              <th>Ticker</th>
              <th className="text-right">Shares</th>
              <th className="text-right">Cost per share</th>
              <th className="text-right">Bought on</th>
            </tr>
          </thead>
          <tbody>
            {lots.slice(0, PREVIEW_ROWS).map((lot) => (
              <tr key={lot.source}>
                <td>
                  {lot.accountName} <span className="text-ink-2">{accountTypeName(lot.accountType)}</span>
                </td>
                <td className="font-semibold">{lot.ticker}</td>
                <td className="num text-right">{shares(lot.shares)}</td>
                <td className="num text-right">{usd(lot.costPerShare)}</td>
                <td className="num text-right">{date(lot.acquiredOn)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {lots.length > PREVIEW_ROWS && <p className="text-sm text-muted">Showing the first {PREVIEW_ROWS} of {lots.length}.</p>}

      <div>
        <Button onClick={onSave} disabled={!canSave || busy}>
          {busy ? 'Saving…' : `Save ${lots.length} ${lots.length === 1 ? 'purchase' : 'purchases'}`}
        </Button>
      </div>
    </div>
  );
}

function Saved({ result }) {
  return (
    <div className="flex flex-col gap-3">
      <Alert tone="info" title={`Saved ${result.lotsSaved} ${result.lotsSaved === 1 ? 'purchase' : 'purchases'}.`}>
        {result.createdAccounts.length > 0 && <p>New accounts: {result.createdAccounts.join(', ')}.</p>}
      </Alert>
      <Warnings warnings={result.warnings} />
      <Link to="/holdings" className="font-semibold text-primary underline-offset-4 hover:underline">
        See your holdings
      </Link>
    </div>
  );
}
