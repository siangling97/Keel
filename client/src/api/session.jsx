// Who is using the app (guest, logged-in user, or demo visitor) and which API to use.
// Pages call useSession().api and never care whether it's the real server or the demo.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { httpApi } from './httpApi.js';

const SessionContext = createContext(null);
const DEMO_FLAG = 'keel-demo';

export function SessionProvider({ children, apiOverride }) {
  const [status, setStatus] = useState('loading'); // loading | guest | user | demo
  const [user, setUser] = useState(null);
  const [api, setApi] = useState(apiOverride ?? httpApi);
  // Bumped after every change, so every screen showing portfolio data reloads it.
  const [version, setVersion] = useState(0);
  // A one-time message for the start page, e.g. after deleting an account.
  const [notice, setNotice] = useState(null);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const enterDemo = useCallback(async () => {
    // Loaded only when someone opens the demo, so real users don't download the sample data.
    const { createDemoApi } = await import('./demoApi.js');
    const demo = createDemoApi();
    sessionStorage.setItem(DEMO_FLAG, '1');
    setApi(demo);
    setUser((await demo.me()).user);
    setStatus('demo');
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (apiOverride) {
        const { user: u } = await apiOverride.me();
        if (alive) {
          setUser(u);
          setStatus(apiOverride.isDemo ? 'demo' : 'user');
        }
        return;
      }
      if (sessionStorage.getItem(DEMO_FLAG)) return enterDemo();
      try {
        const { user: u } = await httpApi.me();
        if (alive) {
          setUser(u);
          setStatus('user');
        }
      } catch {
        if (alive) setStatus('guest');
      }
    })();
    return () => {
      alive = false;
    };
  }, [apiOverride, enterDemo]);

  const value = useMemo(
    () => ({
      status,
      user,
      api,
      version,
      refresh,
      enterDemo,
      async login(email, password) {
        const { user: u } = await httpApi.login(email, password);
        setApi(httpApi);
        setUser(u);
        setStatus('user');
      },
      async register(email, password) {
        const { user: u } = await httpApi.register(email, password);
        setApi(httpApi);
        setUser(u);
        setStatus('user');
      },
      async logout() {
        await api.logout().catch(() => {});
        sessionStorage.removeItem(DEMO_FLAG);
        setApi(httpApi);
        setUser(null);
        setStatus('guest');
      },
      async deleteMyAccount(password) {
        // If the password is wrong this throws, and the user stays logged in.
        await api.deleteMyAccount(password);
        setApi(httpApi);
        setUser(null);
        setStatus('guest');
        setNotice('Your account and all your data were deleted.');
      },
      notice,
      clearNotice: () => setNotice(null),
    }),
    [status, user, api, version, refresh, enterDemo, notice]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/**
 * Load data and reload it when the portfolio changes or `deps` change.
 * Keeps the previous data on screen while reloading, so the page doesn't flash empty.
 *
 * const { data, error, loading } = usePortfolioData((api) => api.holdings(), []);
 */
export function usePortfolioData(load, deps = []) {
  const { api, version } = useSession();
  const [state, setState] = useState({ data: undefined, error: null, loading: true });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    load(api).then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState((s) => ({ data: s.data, error, loading: false }))
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, version, ...deps]);

  return state;
}
