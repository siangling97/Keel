// Dividend income per year, with DRIP vs. taking dividends as cash.
//
// Charting rules followed: one y-axis (dollars), 2px lines, hairline solid grid, a legend for the
// two series plus a label at each line's end, a crosshair tooltip, and a table view of the same
// numbers. Text stays in ink colors; only the lines and keys carry the series colors.

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { usd, usdCompact } from '../lib/format.js';

export const SERIES = [
  { key: 'drip', name: 'Reinvest dividends (DRIP)', color: 'var(--color-class-1)' },
  { key: 'cash', name: 'Take dividends as cash', color: 'var(--color-class-2)' },
];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[var(--radius-control)] bg-ink px-3 py-2 text-sm text-white shadow-lg">
      <p className="font-semibold">{label}</p>
      {SERIES.map((s) => {
        const point = payload.find((p) => p.dataKey === s.key);
        return (
          <p key={s.key} className="num flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-0.5 w-3" style={{ background: s.color }} />
            {s.name}: {usd(point?.value)}
          </p>
        );
      })}
    </div>
  );
}

/** Value at the end of a line only; never a number on every point. */
function EndLabel({ x, y, index, value, count }) {
  if (index !== count - 1) return null;
  return (
    <text x={x + 10} y={y} dy={4} className="num" fill="var(--color-ink)" fontSize={13} fontWeight={600}>
      {usdCompact(value)}
    </text>
  );
}

export function DividendChart({ data }) {
  const count = data.length;
  return (
    <figure>
      <ul className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-[2px] w-5 rounded" style={{ background: s.color }} />
            {s.name}
          </li>
        ))}
      </ul>
      <div className="h-[320px] w-full" role="img" aria-label="Line chart of yearly dividend income. The same numbers are in the table below.">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 64, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-rule)" />
            <XAxis
              dataKey="year"
              tickLine={false}
              tickMargin={8}
              axisLine={{ stroke: 'var(--color-rule-strong)' }}
              tick={{ fill: 'var(--color-muted)', fontSize: 13 }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={usdCompact}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--color-muted)', fontSize: 13 }}
              width={64}
              domain={[0, 'auto']}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-rule-strong)', strokeWidth: 1 }} />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={(props) =>
                  props.index === count - 1 ? (
                    <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
                  ) : (
                    <g key={props.key} />
                  )
                }
                activeDot={{ r: 5, fill: s.color, stroke: 'var(--color-surface)', strokeWidth: 2 }}
                label={<EndLabel count={count} />}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
