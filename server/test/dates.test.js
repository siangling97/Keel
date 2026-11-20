import { describe, it, expect } from 'vitest';
import { daysBetween, addDays, isLongTerm, toDayNumber } from '../src/engine/dates.js';
import { ValidationError } from '../src/engine/errors.js';

describe('date helpers', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-11-01', '2026-11-19')).toBe(18);
    expect(daysBetween('2026-11-19', '2026-11-01')).toBe(-18);
  });

  it('is not fooled by daylight saving time (US clocks change on 2026-03-08 and 2026-11-01)', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-11-19', 31)).toBe('2026-12-20');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
  });

  it('long-term means held MORE than one year', () => {
    expect(isLongTerm('2025-03-10', '2026-03-10')).toBe(false); // exactly 1 year: still short-term
    expect(isLongTerm('2025-03-10', '2026-03-11')).toBe(true);
    expect(isLongTerm('2025-12-01', '2026-11-19')).toBe(false);
  });

  it('rejects dates that are badly formatted or impossible', () => {
    expect(() => toDayNumber('11/19/2026')).toThrow(ValidationError);
    expect(() => toDayNumber('2026-02-30')).toThrow(/not a real date/);
    expect(() => toDayNumber(undefined)).toThrow(ValidationError);
  });
});
