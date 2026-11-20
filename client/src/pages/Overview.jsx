import { Link } from 'react-router';
import { usePortfolioData } from '../api/session.jsx';
import { allocationRows } from '../components/AllocationStrip.jsx';
import { Loading, ErrorAlert, Warnings, Table, GainLoss } from '../components/ui.jsx';
import { buildClassPalette, className, sortClasses } from '../lib/assetClasses.js';
import { usd, usdRounded, signedUsd, pct, points, localToday } from '../lib/format.js';

export function Overview() {
  const { data, error, loading } = usePortfolioData(async (api) => {
    const [holdings, targets] = await Promise.all([api.holdings(), api.getTargets()]);
    if (holdings.holdings.length === 0) return { holdings, targets };
    const [dividends, taxLoss] = await Promise.all([
      api.dividends({ years: 1, reinvestDividends: false }),
      api.taxLoss({ asOfDate: localToday() }),
    ]);
    return { holdings, targets, dividends, taxLoss };
  });

  if (!data && loading) return <Loading />;
  if (!data) return <ErrorAlert error={error} />;
  if (data.holdings.holdings.length === 0) return <EmptyPortfolio />;

  const { holdings, targets, dividends, taxLoss } = data;
  const rows = allocationRows(holdings.holdings, targets.targetWeights, sortClasses);
  const palette = buildClassPalette(rows.map((r) => r.assetClass));
  const hasTargets = Object.keys(targets.targetWeights).length > 0;
  const biggest = hasTargets ? [...rows].sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0] : null;
  const income = dividends.annualSummary[0].projectedAnnualIncome;

  return (
    <div>
      <h1 className="sr-only">Overview</h1>
      <ErrorAlert error={error} />

      <div className="flex flex-wrap items-end gap-x-10 gap-y-2">
        <div>
          <p className="text-ink-2">Total value</p>
          <p className="text-[56px] leading-none font-bold tracking-[-0.03em]">{usd(holdings.totals.currentValue)}</p>
        </div>
        <p className="pb-1 text-[17px] text-ink-2">
          <GainLoss value={holdings.totals.unrealizedGain}>{signedUsd(holdings.totals.unrealizedGain)}</GainLoss> on{' '}
          {usd(holdings.totals.totalCostBasis)} invested
        </p>
      </div>
      <p className="mt-2 text-sm text-muted">Prices: {holdings.priceSource}</p>

      <div className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-rule bg-rule md:grid-cols-3">
        <Next
          title="Mix"
          to={hasTargets ? '/rebalance' : '/settings'}
          action={hasTargets ? 'Plan a rebalance' : 'Set your target mix'}
        >
          {hasTargets ? (
            <>
              <strong className="font-semibold">{className(biggest.assetClass)}</strong> is{' '}
              {Math.abs(biggest.drift * 100).toFixed(1)} points {biggest.drift > 0 ? 'over' : 'under'} target, your biggest drift.
            </>
          ) : (
            'Tell Keel the mix you want, and it will show how far you are from it.'
          )}
        </Next>
        <Next title="Dividends" to="/dividends" action="See the 10-year projection">
          About <strong className="font-semibold">{usdRounded(income)}</strong> in the next year, or {usdRounded(income / 12)} a month on
          average.
        </Next>
        <Next title="Tax-loss harvesting" to="/tax-loss" action="Review losses">
          {taxLoss.summary.count === 0 ? (
            'No losses big enough to harvest right now.'
          ) : (
            <>
              <strong className="font-semibold">{usdRounded(taxLoss.summary.totalHarvestableLoss)}</strong> in losses across{' '}
              {taxLoss.summary.count} {taxLoss.summary.count === 1 ? 'position' : 'positions'}
              {taxLoss.summary.withWashSaleRisk > 0 && `, ${taxLoss.summary.withWashSaleRisk} with a wash-sale risk`}.
            </>
          )}
        </Next>
      </div>

      <section className="mt-12">
        <h2 className="mb-4 text-[21px] font-bold tracking-[-0.01em]">Your mix</h2>
        <Table caption="Your mix by asset class">
          <thead>
            <tr>
              <th>Asset class</th>
              <th className="text-right">Value</th>
              <th className="text-right">Now</th>
              <th className="text-right">Target</th>
              <th className="text-right">Drift</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.assetClass}>
                <td>
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ background: palette.get(r.assetClass).color }} />
                    {className(r.assetClass)}
                  </span>
                </td>
                <td className="num text-right">{usd(r.value)}</td>
                <td className="num text-right">{pct(r.currentPct)}</td>
                <td className="num text-right">{hasTargets ? pct(r.targetPct) : '—'}</td>
                <td className="num text-right">{hasTargets ? points(r.drift) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <div className="mt-8">
        <Warnings warnings={holdings.warnings} />
      </div>
    </div>
  );
}

function Next({ title, children, to, action }) {
  return (
    <div className="flex flex-col bg-surface p-6">
      <h2 className="text-sm font-semibold text-ink-2">{title}</h2>
      <p className="mt-2 flex-1 text-[17px] leading-snug">{children}</p>
      <Link to={to} className="mt-4 text-[15px] font-semibold text-primary underline-offset-4 hover:underline">
        {action}
      </Link>
    </div>
  );
}

function EmptyPortfolio() {
  return (
    <div className="max-w-[60ch] py-10">
      <h1 className="text-[28px] font-bold tracking-[-0.015em]">Add your holdings to get started</h1>
      <p className="mt-3 text-ink-2">
        Upload a CSV with one row per purchase, or add purchases one at a time. Keel needs the ticker, the number of shares, what
        you paid, and the date.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/import" className="rounded-[var(--radius-control)] bg-primary px-4 py-2 font-semibold text-white hover:bg-primary-hover">
          Import a CSV
        </Link>
        <Link to="/holdings" className="rounded-[var(--radius-control)] border border-rule-strong bg-surface px-4 py-2 font-semibold hover:border-ink-2">
          Add a purchase by hand
        </Link>
      </div>
    </div>
  );
}
