import { useState } from 'react';
import { usePortfolioData } from '../api/session.jsx';
import { DividendChart } from '../components/DividendChart.jsx';
import { PageHeader, Section, Table, Loading, ErrorAlert, Warnings, Field, Input, Select } from '../components/ui.jsx';
import { usd, usdRounded } from '../lib/format.js';
import { useDebounced } from '../lib/useDebounced.js';

const toRate = (text, fallback) => {
  const n = Number(text);
  return Number.isFinite(n) ? n / 100 : fallback;
};

export function Dividends() {
  const [years, setYears] = useState(10);
  const [dividendGrowth, setDividendGrowth] = useState('3');
  const [priceGrowth, setPriceGrowth] = useState('6');

  const options = useDebounced({
    years,
    defaultDividendGrowthRate: toRate(dividendGrowth, 0.03),
    defaultPriceGrowthRate: toRate(priceGrowth, 0.06),
  });
  // Both versions at once, so the chart can compare them.
  const { data, error, loading } = usePortfolioData(
    async (api) => {
      const [drip, cash] = await Promise.all([
        api.dividends({ ...options, reinvestDividends: true }),
        api.dividends({ ...options, reinvestDividends: false }),
      ]);
      return { drip, cash };
    },
    [JSON.stringify(options)]
  );

  const chartData = data
    ? data.drip.annualSummary.map((y, i) => ({
        year: y.year,
        drip: y.projectedAnnualIncome,
        cash: data.cash.annualSummary[i].projectedAnnualIncome,
        monthly: y.projectedMonthlyAverage,
        value: y.projectedPortfolioValue,
      }))
    : [];
  const first = chartData[0];
  const last = chartData.at(-1);

  return (
    <div>
      <PageHeader title="Dividends">
        Your expected dividend income, year by year. With DRIP, each dividend buys more shares, so the next one is a little bigger.
      </PageHeader>

      <div className="flex flex-wrap gap-6">
        <Field label="Years" className="w-36">
          {(p) => (
            <Select {...p} value={years} onChange={(e) => setYears(Number(e.target.value))}>
              {[5, 10, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n} years
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Dividends grow each year" hint="Percent. Holdings with their own rate keep it." className="w-60">
          {(p) => <Input {...p} inputMode="decimal" value={dividendGrowth} onChange={(e) => setDividendGrowth(e.target.value)} />}
        </Field>
        <Field label="Prices grow each year" hint="Percent. Higher prices mean DRIP buys fewer shares." className="w-60">
          {(p) => <Input {...p} inputMode="decimal" value={priceGrowth} onChange={(e) => setPriceGrowth(e.target.value)} />}
        </Field>
      </div>

      <div className={`mt-10 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        {!data && loading && <Loading />}
        <ErrorAlert error={error} />
        {data && first && (
          <>
            <p className="max-w-[60ch] text-[19px] leading-snug">
              About <strong className="font-semibold">{usdRounded(first.cash)}</strong> next year. In {last.year}, about{' '}
              <strong className="font-semibold">{usdRounded(last.drip)}</strong> with DRIP, or {usdRounded(last.cash)} if you take it as
              cash.
            </p>
            <div className="mt-8">
              <DividendChart data={chartData} />
            </div>

            <Section title="Year by year" className="mt-10">
              <Table caption="Dividend projection by year">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th className="text-right">With DRIP</th>
                    <th className="text-right">Monthly, with DRIP</th>
                    <th className="text-right">As cash</th>
                    <th className="text-right">Portfolio value with DRIP</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((y) => (
                    <tr key={y.year}>
                      <td className="num">{y.year}</td>
                      <td className="num text-right">{usd(y.drip)}</td>
                      <td className="num text-right">{usd(y.monthly)}</td>
                      <td className="num text-right">{usd(y.cash)}</td>
                      <td className="num text-right">{usd(y.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
            <div className="mt-6">
              <Warnings warnings={data.drip.warnings} />
            </div>
            <p className="mt-6 max-w-[70ch] text-sm text-muted">
              A projection, not a promise: companies can cut dividends and prices can fall. Taxes on dividends in taxable accounts
              aren't included. Prices: {data.drip.priceSource}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
