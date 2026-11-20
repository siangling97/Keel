// Small helpers for working with dollar amounts.
//
// Why cents? JavaScript numbers are floating point, so 0.1 + 0.2 === 0.30000000000000004.
// When money has to add up exactly (for example, "these buys must use exactly $2,000"),
// we do the math in whole cents (integers) and convert back to dollars at the end.

/**
 * Convert dollars to whole cents. Rounds half away from zero, so -2.345 -> -235.
 * @param {number} dollars
 * @returns {number} integer cents
 */
export function toCents(dollars) {
  return Math.sign(dollars) * Math.round(Math.abs(dollars) * 100);
}

/**
 * Convert whole cents back to dollars.
 * @param {number} cents
 * @returns {number}
 */
export function fromCents(cents) {
  return cents / 100;
}

/**
 * Round a dollar amount to 2 decimal places.
 * @param {number} dollars
 * @returns {number}
 */
export function roundDollars(dollars) {
  return fromCents(toCents(dollars));
}

/**
 * Split a whole number of cents into parts that match the given weights.
 * The parts always add up to exactly `totalCents`.
 *
 * Uses the "largest remainder" method: give every part its rounded-down share,
 * then hand the leftover cents, one each, to the parts that lost the most in rounding.
 *
 * Example: splitCents(10000, [1, 1, 1]) -> [3334, 3333, 3333]   ($100 split three ways)
 *
 * @param {number} totalCents  whole cents to split (>= 0)
 * @param {number[]} weights   positive numbers, any scale
 * @returns {number[]} integer cents, same order as `weights`
 */
export function splitCents(totalCents, weights) {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new RangeError(`totalCents must be a whole number >= 0, got ${totalCents}`);
  }
  if (weights.length === 0) return [];

  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (!(weightSum > 0)) {
    throw new RangeError('splitCents needs at least one positive weight');
  }

  const exactShares = weights.map((w) => (totalCents * w) / weightSum);
  const parts = exactShares.map((share) => Math.floor(share));

  let leftover = totalCents - parts.reduce((sum, p) => sum + p, 0);

  // Biggest rounding loss gets the next cent. Ties go to the earlier item so results are stable.
  const byRemainder = exactShares
    .map((share, index) => ({ index, remainder: share - parts[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (let k = 0; leftover > 0; k++, leftover--) {
    parts[byRemainder[k].index] += 1;
  }

  return parts;
}
