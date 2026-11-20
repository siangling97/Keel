import { describe, it, expect } from 'vitest';
import { toCents, fromCents, roundDollars, splitCents } from '../src/engine/money.js';

describe('toCents / fromCents / roundDollars', () => {
  it('converts dollars to whole cents', () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it('rounds negative amounts away from zero, like positive ones', () => {
    expect(toCents(-2.345)).toBe(-235);
    expect(toCents(2.345)).toBe(235);
  });

  it('converts back and rounds to 2 decimals', () => {
    expect(fromCents(1234)).toBe(12.34);
    expect(roundDollars(1846.153846)).toBe(1846.15);
  });
});

describe('splitCents', () => {
  it('splits $100 three ways without losing a cent', () => {
    const parts = splitCents(10000, [1, 1, 1]);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b)).toBe(10000);
  });

  it('follows the weights', () => {
    expect(splitCents(200000, [4800, 400])).toEqual([184615, 15385]);
  });

  it('always adds up exactly, for many random splits', () => {
    const random = seededRandom(42);
    for (let run = 0; run < 500; run++) {
      const total = Math.floor(random() * 10_000_000);
      const weights = Array.from({ length: 1 + Math.floor(random() * 8) }, () => random() * 1000 + 0.001);
      const parts = splitCents(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      parts.forEach((p) => expect(Number.isInteger(p) && p >= 0).toBe(true));
    }
  });

  it('rejects bad input', () => {
    expect(() => splitCents(10.5, [1])).toThrow(RangeError);
    expect(() => splitCents(-1, [1])).toThrow(RangeError);
    expect(() => splitCents(100, [0, 0])).toThrow(RangeError);
    expect(splitCents(100, [])).toEqual([]);
  });
});

/** Same "random" numbers every run, so a failing test can be repeated. */
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
