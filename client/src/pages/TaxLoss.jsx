import { useState } from 'react';
import { usePortfolioData } from '../api/session.jsx';
import { PageHeader, Table, Loading, ErrorAlert, Warnings, Field, Input, Alert } from '../components/ui.jsx';
import { usd, usdRounded, shares, date, localToday } from '../lib/format.js';
import { useDebounced } from '../lib/useDebounced.js';

const TERM = { SHORT_TERM: 'Short-term', LONG_TERM: 'Long-term' };

export function TaxLoss() {
  const [asOfDate, setAsOfDate] = useState(localToday());
  const [minLoss, setMinLoss] = useState('500');
  const query = useDebounced({ asOfDate, minLoss: Number(minLoss) || 0 });
  const { data, error, loading } = usePortfolioData((api) => api.taxLoss(query), [JSON.stringify(query)]);

  return (
    <div>
      <PageHeader title="Tax-loss harvesting">
        Selling a holding below what you paid creates a loss that can lower your taxes. Keel looks at each purchase in your
        taxable accounts and checks for wash sales in all your accounts, IRAs included.
      </PageHeader>

      <div className="flex flex-wrap gap-6">
        <Field label="Selling on" className="w-48">
          {(p) => <Input {...p} type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value || localToday())} />}
        </Field>
        <Field label="Smallest loss to show" hint="In dollars, per position." className="w-48">
          {(p) => <Input {...p} inputMode="decimal" value={minLoss} onChange={(e) => setMinLoss(e.target.value)} />}
        </Field>
      </div>

      <div className={`mt-10 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        {!data && loading && <Loading />}
        <ErrorAlert error={error} />
        {data && <Results scan={data} />}
      </div>
    </div>
  );
}

function Results({ scan }) {
  const { summary } = scan;
  if (summary.count === 0) {
    return (
      <div className="max-w-[60ch]">
        <p className="text-[19px]">No losses at or above your minimum in taxable accounts.</p>
        {summary.taxAdvantagedLotsSkipped > 0 && (
          <p className="mt-2 text-ink-2">{summary.taxAdvantagedLotsSkipped} purchases in IRAs or other tax-advantaged accounts were skipped, because losses there can't be deducted.</p>
        )}
        <Warnings warnings={scan.warnings} />
      </div>
    );
  }

  return (
    <>
      <p className="max-w-[62ch] text-[19px] leading-snug">
        <strong className="font-semibold">{usdRounded(summary.totalHarvestableLoss)}</strong> in losses you could harvest:{' '}
        {usdRounded(summary.shortTermLoss)} short-term and {usdRounded(summary.longTermLoss)} long-term.
        {summary.withWashSaleRisk > 0 && ` ${summary.withWashSaleRisk} ${summary.withWashSaleRisk === 1 ? 'has' : 'have'} a wash-sale risk.`}
      </p>
      {summary.taxAdvantagedLotsSkipped > 0 && (
        <p className="mt-2 text-ink-2">
          {summary.taxAdvantagedLotsSkipped} purchases in IRAs were skipped: losses there can't be deducted.
        </p>
      )}

      <ol className="mt-8 flex flex-col gap-6">
        {scan.opportunities.map((o) => (
          <Opportunity key={`${o.accountId}-${o.ticker}`} o={o} />
        ))}
      </ol>

      <div className="mt-6">
        <Warnings warnings={scan.warnings} />
      </div>
      <p className="mt-6 max-w-[72ch] text-sm text-muted">
        For education only, not tax advice. Keel can't see a spouse's accounts, options, or trades it wasn't told about. The IRS
        hasn't said exactly when two funds are "substantially identical," so substitutes are suggestions. Prices: {scan.priceSource}.
      </p>
    </>
  );
}

function Opportunity({ o }) {
  const risk = o.washSale.status === 'RISK';
  const term =
    o.shortTermLoss > 0 && o.longTermLoss > 0
      ? `${usd(o.shortTermLoss)} short-term, ${usd(o.longTermLoss)} long-term`
      : o.shortTermLoss > 0
        ? 'Short-term'
        : 'Long-term';

  return (
    <li className="rounded-[10px] border border-rule bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-[21px] font-bold tracking-[-0.01em]">
          {o.ticker} <span className="text-[17px] font-normal text-ink-2">in {o.accountName}</span>
        </h2>
        <p className="text-[21px] font-semibold text-loss">{usd(o.harvestableLoss)} loss</p>
      </div>
      <p className="mt-1 text-ink-2">
        {term}. Sell {shares(o.sharesToSell)} shares at about {usd(o.currentPrice)}.
      </p>

      <div className="mt-4">
        {risk ? (
          <Alert tone="error" title="Wash-sale risk: buying it back too soon would cancel this loss">
            <ul className="mt-1 list-disc pl-5">
              {o.washSale.recentBuys.map((b, i) => (
                <li key={i}>
                  {b.type === 'DIVIDEND_REINVEST' ? 'Reinvested a dividend in' : 'Bought'} {b.ticker} in {b.accountName}{' '}
                  {b.daysAgo === 0 ? 'today' : `${b.daysAgo} days ago`}
                  {b.reason === 'SAME_INDEX' && ' (same index, may count as identical)'}.
                </li>
              ))}
            </ul>
          </Alert>
        ) : (
          <Alert tone="info" title="No buys of this fund in the last 30 days">
            Don't buy it, or a fund on the same index, in any account before {date(o.washSale.doNotBuyBackBefore)}.
          </Alert>
        )}
      </div>

      {o.warnings.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-ink-2">
          {o.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {o.substitutes.length > 0 && (
        <p className="mt-4">
          <span className="text-ink-2">To stay invested, consider </span>
          {o.substitutes.map((s, i) => (
            <span key={s.ticker}>
              {i > 0 && ', '}
              <strong className="font-semibold">{s.ticker}</strong> <span className="text-ink-2">({s.trackedIndex})</span>
            </span>
          ))}
          <span className="text-ink-2">, which tracks a different index.</span>
        </p>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer font-semibold text-primary">
          {o.lotsToSell.length === 1 ? 'The purchase to sell' : `The ${o.lotsToSell.length} purchases to sell`}
        </summary>
        <Table caption={`Lots to sell for ${o.ticker}`} className="mt-3">
          <thead>
            <tr>
              <th>Bought on</th>
              <th className="text-right">Shares</th>
              <th className="text-right">Cost per share</th>
              <th>Term</th>
              <th className="text-right">Loss</th>
            </tr>
          </thead>
          <tbody>
            {o.lotsToSell.map((lot) => (
              <tr key={lot.lotId}>
                <td className="num">{date(lot.acquiredOn)}</td>
                <td className="num text-right">{shares(lot.shares)}</td>
                <td className="num text-right">{usd(lot.costPerShare)}</td>
                <td>{TERM[lot.term]}</td>
                <td className="num text-right">{usd(lot.loss)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </details>
    </li>
  );
}
