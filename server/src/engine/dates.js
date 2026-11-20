// Date helpers for plain calendar dates like "2026-11-19".
//
// Why not just `new Date("2026-11-19")`? Mixing that with local-time methods causes off-by-one-day bugs
// near midnight and around daylight saving time, depending on the server's time zone. A wash-sale window
// that is one day off could be the difference between a deductible loss and a disallowed one.
// So we treat every date as midnight UTC and only ever compare whole days.

import { ValidationError } from './errors.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse "YYYY-MM-DD" into a day number (days since 1970-01-01). Rejects impossible dates like 2026-02-30.
 * @param {string} isoDate
 * @param {string} [label]  used in the error message
 * @returns {number}
 */
export function toDayNumber(isoDate, label = 'Date') {
  if (typeof isoDate !== 'string' || !ISO_DATE.test(isoDate)) {
    throw new ValidationError(`${label} must look like YYYY-MM-DD. Got: ${isoDate}`);
  }
  const [year, month, day] = isoDate.split('-').map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new ValidationError(`${label} is not a real date: ${isoDate}`);
  }
  return ms / MS_PER_DAY;
}

/**
 * Whole days from `from` to `to`. Positive if `to` is later.
 * daysBetween("2026-11-01", "2026-11-19") === 18
 */
export function daysBetween(from, to) {
  return toDayNumber(to) - toDayNumber(from);
}

/** "2026-11-19" plus 31 days -> "2026-12-20" */
export function addDays(isoDate, days) {
  const ms = (toDayNumber(isoDate) + days) * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Long-term if held MORE than one year: sold after the 1-year anniversary of the purchase.
 * Bought 2025-03-10: selling on 2026-03-10 is still short-term, 2026-03-11 is long-term.
 * (A Feb 29 purchase has no anniversary in most years. Date.UTC rolls it to Mar 1,
 * which keeps the answer on the safe, short-term side for that one extra day.)
 */
export function isLongTerm(acquiredOn, soldOn) {
  toDayNumber(acquiredOn, 'Acquired date'); // validates first
  const [year, month, day] = acquiredOn.split('-').map(Number);
  const anniversary = Date.UTC(year + 1, month - 1, day) / MS_PER_DAY;
  return toDayNumber(soldOn) > anniversary;
}
