// Names and colors for asset classes.
//
// Color follows the class, never its position: US stocks are always slot 1, international
// slot 2, bonds slot 3, real estate slot 4. Any other class takes a free slot (alphabetical),
// and past four the strip groups the rest as "Other". Only four colors because those four were
// validated as a set: any two can end up side by side in the strip.

const KNOWN_ORDER = ['US_EQUITY', 'INTL_EQUITY', 'BONDS', 'REIT'];
const SLOTS = ['var(--color-class-1)', 'var(--color-class-2)', 'var(--color-class-3)', 'var(--color-class-4)'];
export const OTHER_COLOR = 'var(--color-class-other)';
export const OTHER = 'OTHER';

/** Labels drawn inside a colored block: white, except near-black ink on the ochre slot. */
const INK_ON_SLOT = ['#ffffff', '#ffffff', '#1f2d29', '#ffffff'];

const NAMES = {
  US_EQUITY: 'US stocks',
  INTL_EQUITY: 'International stocks',
  BONDS: 'Bonds',
  REIT: 'Real estate',
  CASH: 'Cash',
  UNCLASSIFIED: 'Not classified',
  OTHER: 'Other',
};

/** "US_EQUITY" -> "US stocks", "EMERGING_MARKETS" -> "Emerging markets" */
export function className(code) {
  if (NAMES[code]) return NAMES[code];
  const words = code.toLowerCase().split('_');
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(' ');
}

/** Suggestions for the class picker. Users can also type their own. */
export const COMMON_CLASSES = ['US_EQUITY', 'INTL_EQUITY', 'BONDS', 'REIT', 'CASH'];

/**
 * Give every class a color slot.
 * @param {string[]} classes  all classes in view (held + targeted)
 * @returns {Map<string, { color: string, ink: string, folded: boolean }>}
 */
export function buildClassPalette(classes) {
  const unique = [...new Set(classes)];
  const palette = new Map();
  const used = new Set();

  for (const code of unique) {
    const slot = KNOWN_ORDER.indexOf(code);
    if (slot !== -1) {
      palette.set(code, { color: SLOTS[slot], ink: INK_ON_SLOT[slot], folded: false });
      used.add(slot);
    }
  }
  const free = [0, 1, 2, 3].filter((s) => !used.has(s));
  for (const code of unique.filter((c) => !palette.has(c)).sort()) {
    const slot = code === 'UNCLASSIFIED' ? undefined : free.shift();
    palette.set(
      code,
      slot === undefined
        ? { color: OTHER_COLOR, ink: '#ffffff', folded: true }
        : { color: SLOTS[slot], ink: INK_ON_SLOT[slot], folded: false }
    );
  }
  return palette;
}

/** Order classes for display: the known four first, then alphabetical. */
export function sortClasses(classes) {
  const rank = (c) => (KNOWN_ORDER.includes(c) ? KNOWN_ORDER.indexOf(c) : c === 'UNCLASSIFIED' ? 99 : 10);
  return [...new Set(classes)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
