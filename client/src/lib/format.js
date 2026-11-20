// Formatting for money, percentages, shares and dates. One place, so the whole app matches.

const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompactFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** $1,234.56 */
export const usd = (n) => usdFormat.format(n ?? 0);

/** $1,235 */
export const usdRounded = (n) => usdWhole.format(n ?? 0);

/** $12.3K: for chart axes */
export const usdCompact = (n) => usdCompactFormat.format(n ?? 0);

/** +$890.00 / −$50.00 (true minus sign) */
export const signedUsd = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${usdFormat.format(Math.abs(n ?? 0))}`;

/** 0.4826 -> "48.3%" */
export const pct = (fraction, digits = 1) => `${((fraction ?? 0) * 100).toFixed(digits)}%`;

/** Percentage points between two fractions: 0.263 vs 0.15 -> "+11.3 pts" */
export const points = (fraction) => {
  const value = (fraction ?? 0) * 100;
  const sign = value > 0.05 ? '+' : value < -0.05 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1)} pts`;
};

/** 15.5 -> "15.5", 112.4864 -> "112.4864" */
export const shares = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n ?? 0);

/** "2026-11-19" -> "Nov 19, 2026" (read as a calendar date, never shifted by time zone) */
export function date(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Today's date where the user is, as "YYYY-MM-DD". */
export function localToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "YYYY-MM-DD" minus some days, in the user's calendar. */
export function daysAgo(days, from = localToday()) {
  const [y, m, d] = from.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}
