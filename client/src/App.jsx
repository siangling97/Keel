import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router';
import { SessionProvider, useSession } from './api/session.jsx';
import { Layout } from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import { Landing } from './pages/Landing.jsx';
import { Overview } from './pages/Overview.jsx';
import { Holdings } from './pages/Holdings.jsx';
import { Rebalance } from './pages/Rebalance.jsx';
// The chart library is big, so the Dividends page loads only when someone opens it.
const Dividends = lazy(() => import('./pages/Dividends.jsx').then((m) => ({ default: m.Dividends })));
import { TaxLoss } from './pages/TaxLoss.jsx';
import { Import } from './pages/Import.jsx';
import { Settings } from './pages/Settings.jsx';

/** Signed-in pages: send guests to the landing page. */
function RequireSession() {
  const { status } = useSession();
  if (status === 'loading') return <Loading />;
  if (status === 'guest') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** The landing page: send people who are already in to their overview. */
function GuestOnly() {
  const { status } = useSession();
  if (status === 'loading') return <Loading />;
  if (status === 'user' || status === 'demo') return <Navigate to="/overview" replace />;
  return <Landing />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<GuestOnly />} />
      <Route element={<RequireSession />}>
        <Route element={<Layout />}>
          <Route path="/overview" element={<Overview />} />
          <Route path="/holdings" element={<Holdings />} />
          <Route path="/rebalance" element={<Rebalance />} />
          <Route
            path="/dividends"
            element={
              <Suspense fallback={<Loading />}>
                <Dividends />
              </Suspense>
            }
          />
          <Route path="/tax-loss" element={<TaxLoss />} />
          <Route path="/import" element={<Import />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </SessionProvider>
  );
}
