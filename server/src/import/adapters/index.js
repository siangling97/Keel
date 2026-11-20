// Adapter registry (the pseudocode's getBrokerAdapter).
//
// Each adapter knows how to read one file layout. To support a new broker export later:
//   1. Create adapters/fidelity.js with { id, label, detect(headerRow), mapHeaders(headerRow), parseRow(...) }
//   2. Add it to ADAPTERS below, before the template (more specific layouts first).
//   3. Add a real (anonymized) export to test/fixtures and write tests for it.
// Nothing else in the app changes. That's the point of the adapter pattern.

import { templateAdapter } from './template.js';

const ADAPTERS = [templateAdapter];

/** Get an adapter by id, e.g. "TEMPLATE". */
export function getBrokerAdapter(id) {
  return ADAPTERS.find((a) => a.id === id) ?? null;
}

/** Pick the first adapter that recognizes these headers, or null. */
export function detectAdapter(headerRow) {
  return ADAPTERS.find((a) => a.detect(headerRow)) ?? null;
}

export function listAdapters() {
  return ADAPTERS.map(({ id, label }) => ({ id, label }));
}
