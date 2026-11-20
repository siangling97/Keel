// The allocation strip: Keel's signature element.
//
// A "tall segmented bar" (one whole split into parts) shows the mix you have now; a thin bar
// under it shows the mix you want. Rules it follows, from our charting guidelines:
//   * 28px tall, 4px corners, a 2px gap of background between parts (no borders)
//   * the share is printed inside a part only when it fits; otherwise hover/focus shows it
//   * a legend lists the parts in order; the exact numbers are always in a table on the page
//   * every part can be focused with the keyboard and has an accessible name

import { useLayoutEffect, useRef, useState } from 'react';
import { className as classLabel, OTHER, OTHER_COLOR } from '../lib/assetClasses.js';
import { pct } from '../lib/format.js';

const GAP = 2;
const MIN_LABEL_WIDTH = 44;

/** Track an element's width, so we know which labels fit. */
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * @param {{ parts: { key: string, label: string, share: number, color: string, ink: string, detail?: string }[],
 *           size?: 'tall' | 'thin', name: string }} props
 */
export function SegmentedBar({ parts, size = 'tall', name }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const visible = parts.filter((p) => p.share > 0.0005);
  const usable = Math.max(width - GAP * (visible.length - 1), 0);
  const tall = size === 'tall';

  return (
    <div className="relative">
      <div
        ref={ref}
        role="group"
        aria-label={name}
        className={`flex w-full gap-[2px] ${tall ? 'h-7' : 'h-2 overflow-hidden rounded-full'}`}
      >
        {visible.map((part) => {
          const showLabel = tall && part.share * usable >= MIN_LABEL_WIDTH;
          return (
            <div
              key={part.key}
              tabIndex={tall ? 0 : -1}
              aria-label={`${part.label}: ${pct(part.share)}${part.detail ? `, ${part.detail}` : ''}`}
              onMouseEnter={() => setActive(part.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(part.key)}
              onBlur={() => setActive(null)}
              className={`flex min-w-[3px] items-center overflow-visible transition-[flex-basis] duration-[900ms] ease-[cubic-bezier(.2,.7,.2,1)] ${
                tall ? 'rounded-[4px] px-2' : ''
              }`}
              style={{ flex: `0 1 ${part.share * 100}%`, background: part.color }}
            >
              {showLabel && (
                <span className="num text-[13px] font-semibold whitespace-nowrap" style={{ color: part.ink }} aria-hidden="true">
                  {Math.round(part.share * 100)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      {tall && active && <Tooltip part={visible.find((p) => p.key === active)} parts={visible} width={usable} />}
    </div>
  );
}

function Tooltip({ part, parts, width }) {
  if (!part) return null;
  let left = 0;
  for (const p of parts) {
    if (p.key === part.key) break;
    left += p.share * width + GAP;
  }
  const center = left + (part.share * width) / 2;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 rounded-[var(--radius-control)] bg-ink px-3 py-2 text-sm whitespace-nowrap text-white shadow-lg"
      style={{ left: Math.min(Math.max(center, 60), width - 60) }}
    >
      <span className="font-semibold">{part.label}</span> {pct(part.share)}
      {part.detail && <span className="text-white/80">, {part.detail}</span>}
    </div>
  );
}

/** Group classes the palette couldn't color into one "Other" part. */
function toParts(rows, palette, shareKey, detail) {
  const parts = [];
  let other = null;
  for (const row of rows) {
    const style = palette.get(row.assetClass);
    const share = row[shareKey] ?? 0;
    if (!style || style.folded) {
      other ??= { key: OTHER, label: classLabel(OTHER), share: 0, color: OTHER_COLOR, ink: '#ffffff' };
      other.share += share;
      continue;
    }
    parts.push({ key: row.assetClass, label: classLabel(row.assetClass), share, color: style.color, ink: style.ink, detail: detail?.(row) });
  }
  if (other) parts.push(other);
  return parts;
}

/**
 * Stacked strips with labels on the left.
 * @param {{ rows: object[], palette: Map, bars: { label: string, key: string, size?: 'tall'|'thin' }[], legend?: boolean }} props
 */
export function AllocationStrip({ rows, palette, bars, legend = true }) {
  const legendParts = toParts(rows, palette, bars[0].key);
  return (
    <div>
      <div className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-2">
        {bars.map((bar) => (
          <div key={bar.label} className="contents">
            <span className="text-sm text-ink-2">{bar.label}</span>
            <SegmentedBar name={`${bar.label} mix`} size={bar.size} parts={toParts(rows, palette, bar.key)} />
          </div>
        ))}
      </div>
      {legend && (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 pl-[5.25rem] text-sm text-ink-2" aria-label="Legend">
          {legendParts.map((p) => (
            <li key={p.key} className="flex items-center gap-2">
              <span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ background: p.color }} />
              {p.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Build strip rows from holdings + target weights. */
export function allocationRows(holdings, targetWeights, sortClasses) {
  const total = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  const valueByClass = new Map();
  for (const h of holdings) valueByClass.set(h.assetClass, (valueByClass.get(h.assetClass) ?? 0) + h.currentValue);
  const classes = sortClasses([...valueByClass.keys(), ...Object.keys(targetWeights)]);
  return classes.map((assetClass) => {
    const value = valueByClass.get(assetClass) ?? 0;
    const currentPct = total > 0 ? value / total : 0;
    const targetPct = targetWeights[assetClass] ?? 0;
    return { assetClass, value, currentPct, targetPct, drift: currentPct - targetPct };
  });
}
