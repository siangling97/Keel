import { useState } from 'react';
import { Link } from 'react-router';
import { usePortfolioData } from '../api/session.jsx';
import { AllocationStrip } from '../components/AllocationStrip.jsx';
import { PageHeader, Section, Table, Loading, ErrorAlert, Warnings, Field, Input, Choice, ActionBadge } from '../components/ui.jsx';
import { buildClassPalette, className, sortClasses } from '../lib/assetClasses.js';
import { usd, pct } from '../lib/format.js';
import { useDebounced } from '../lib/useDebounced.js';

const toNumber = (text) => {
  const n = Number(String(text).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function Rebalance() {
  const [cash, setCash] = useState('1000');
  const [mode, setMode] = useState('INFLOW_ONLY');
  const [strategy, setStrategy] = useState('PROPORTIONAL');
  const [minTrade, setMinTrade] = useState('25');

  const options = useDebounced(
    mode === 'INFLOW_ONLY'
      ? { mode, newCash: toNumber(cash), inflowStrategy: strategy }
      : { mode, newCash: toNumber(cash), minTrade: toNumber(minTrade) }
  );
  const { data, error, loading } = usePortfolioData((api) => api.rebalance(options), [JSON.stringify(options)]);

  return (
    <div>
      <PageHeader title="Rebalance">
        Get back to your target mix. Buy-only uses new cash and never sells, so it doesn't create a tax bill. Buy and sell gets you
        all the way to target.
      </PageHeader>

      <form className="flex flex-col gap-6" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-wrap items-start gap-6">
          <Field label="New cash to invest" className="w-48">
            {(p) => <Input {...p} inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />}
          </Field>
          <Choice
            legend="How to rebalance"
            name="mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'INFLOW_ONLY', label: 'Buy only', hint: 'Never sells' },
              { value: 'FULL_REBALANCE', label: 'Buy and sell', hint: 'Hits the target exactly' },
            ]}
          />
        </div>
        {mode === 'INFLOW_ONLY' ? (
          <Choice
            legend="How to split the cash"
            name="strategy"
            value={strategy}
            onChange={setStrategy}
            options={[
              { value: 'PROPORTIONAL', label: 'Spread it out', hint: 'Every underweight class gets some' },
              { value: 'BIGGEST_GAP_FIRST', label: 'Biggest gaps first', hint: 'Gets closest to target' },
            ]}
          />
        ) : (
          <Field label="Skip trades smaller than" hint="Small trades aren't worth the hassle." className="w-48">
            {(p) => <Input {...p} inputMode="decimal" value={minTrade} onChange={(e) => setMinTrade(e.target.value)} />}
          </Field>
        )}
      </form>

      <div className={`mt-10 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        {!data && loading && <Loading label="Planning trades" />}
        {error && (
          <div className="flex flex-col gap-2">
            <ErrorAlert error={error} />
            {/target mix/i.test(error.message) && (
              <Link to="/settings" className="font-semibold text-primary underline-offset-4 hover:underline">
                Set your target mix
              </Link>
            )}
          </div>
        )}
        {data && !error && <Plan plan={data} />}
      </div>
    </div>
  );
}

function Plan({ plan }) {
  const rows = sortClasses(plan.rows.map((r) => r.assetClass)).map((c) => plan.rows.find((r) => r.assetClass === c));
  const palette = buildClassPalette(rows.map((r) => r.assetClass));
  const trades = rows.filter((r) => r.action !== 'HOLD');

  return (
    <>
      <AllocationStrip
        rows={rows}
        palette={palette}
        bars={[
          { label: 'Now', key: 'currentPct' },
          { label: 'After', key: 'projectedPct' },
          { label: 'Target', key: 'targetPct', size: 'thin' },
        ]}
      />

      <Section title={trades.length ? 'Trades' : 'No trades needed'} className="mt-10">
        <p className="mb-4 text-[17px]">
          {trades.length === 0
            ? 'Every class is within your limits.'
            : [
                plan.summary.totalBuy > 0 && `Buy ${usd(plan.summary.totalBuy)}`,
                plan.summary.totalSell > 0 && `sell ${usd(plan.summary.totalSell)}`,
              ]
                .filter(Boolean)
                .join(' and ') + `. ${plan.summary.cashLeftOver > 0.005 ? `${usd(plan.summary.cashLeftOver)} stays as cash.` : 'All cash is used.'}`}
        </p>
        <Table caption="Planned trades">
          <thead>
            <tr>
              <th>Asset class</th>
              <th>Trade</th>
              <th>Ticker</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Now</th>
              <th className="text-right">After</th>
              <th className="text-right">Target</th>
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
                <td>
                  <ActionBadge action={r.action} />
                </td>
                <td className="font-semibold">{r.action === 'HOLD' ? '' : (r.ticker ?? 'Pick a fund')}</td>
                <td className="num text-right">{r.action === 'HOLD' ? '—' : usd(r.tradeAmount)}</td>
                <td className="num text-right">{pct(r.currentPct)}</td>
                <td className="num text-right">{pct(r.projectedPct)}</td>
                <td className="num text-right">{pct(r.targetPct)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <div className="mt-6">
        <Warnings warnings={plan.warnings} />
      </div>
      <p className="mt-6 text-sm text-muted">Prices: {plan.priceSource}. Check live prices before you place a trade.</p>
    </>
  );
}
