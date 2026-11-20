// Talks to the Express API. The login cookie is httpOnly, so this code never sees it:
// the browser attaches it to every same-origin request by itself.

export class ApiError extends Error {
  constructor(status, message, details = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      // Writes are always JSON. The server rejects anything else (part of its CSRF defense).
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error?.message ?? `Request failed (${res.status}).`, data.error?.details ?? []);
  }
  return data;
}

const query = (params) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};

/** Every method here also exists in demoApi.js, with the same inputs and outputs. */
export const httpApi = {
  isDemo: false,

  me: () => request('GET', '/auth/me'),
  register: (email, password) => request('POST', '/auth/register', { email, password }),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  logout: () => request('POST', '/auth/logout', {}),
  /** Permanently delete the logged-in user and all their data. Needs their password again. */
  deleteMyAccount: (password) => request('DELETE', '/auth/me', { password }),

  listAccounts: () => request('GET', '/accounts'),
  createAccount: (account) => request('POST', '/accounts', account),
  updateAccount: (id, changes) => request('PATCH', `/accounts/${id}`, changes),
  deleteAccount: (id) => request('DELETE', `/accounts/${id}`),

  listLots: () => request('GET', '/lots'),
  createLot: (lot) => request('POST', '/lots', lot),
  deleteLot: (id) => request('DELETE', `/lots/${id}`),
  setAssetClasses: (classes) => request('PUT', '/asset-classes', classes),

  importFiles: ({ files, dryRun }) => request('POST', '/import', { files, dryRun }),

  getTargets: () => request('GET', '/targets'),
  saveTargets: (targets) => request('PUT', '/targets', { targets }),

  holdings: () => request('GET', '/portfolio/holdings'),
  rebalance: (options) => request('POST', '/portfolio/rebalance', options),
  dividends: (options) => request('POST', '/portfolio/dividends', options),
  taxLoss: ({ asOfDate, minLoss }) => request('GET', `/portfolio/tax-loss${query({ asOfDate, minLoss })}`),
};
