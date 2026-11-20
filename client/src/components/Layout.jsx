// The frame around every signed-in page: header, navigation, demo notice, and the
// allocation strip that stays visible on every page.

import { NavLink, Link, Outlet, useNavigate, useLocation } from 'react-router';
import { useSession, usePortfolioData } from '../api/session.jsx';
import { AllocationStrip, allocationRows } from './AllocationStrip.jsx';
import { buildClassPalette, sortClasses } from '../lib/assetClasses.js';
import { usdRounded } from '../lib/format.js';
import { Button } from './ui.jsx';

const NAV = [
  ['/overview', 'Overview'],
  ['/holdings', 'Holdings'],
  ['/rebalance', 'Rebalance'],
  ['/dividends', 'Dividends'],
  ['/tax-loss', 'Tax-loss'],
  ['/import', 'Import'],
  ['/settings', 'Settings'],
];

export function Wordmark({ to = '/' }) {
  return (
    <Link to={to} className="flex items-center gap-2 text-[22px] font-extrabold tracking-[-0.03em] text-ink">
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="6" fill="var(--color-primary)" />
        <rect x="6" y="18" width="9" height="6" rx="1.5" fill="#fff" />
        <rect x="17" y="18" width="9" height="6" rx="1.5" fill="var(--color-primary-soft)" />
        <rect x="15" y="7" width="2" height="12" rx="1" fill="#fff" />
      </svg>
      Keel
    </Link>
  );
}

export function Layout() {
  const { user, status, logout } = useSession();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-8 px-5 sm:px-8">
          <div className="flex h-14 items-center">
            <Wordmark to="/overview" />
          </div>
          <nav aria-label="Main" className="order-3 -mx-5 flex w-[calc(100%+2.5rem)] overflow-x-auto px-5 sm:order-none sm:mx-0 sm:w-auto sm:px-0">
            {NAV.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `border-b-2 px-3 py-4 text-[15px] whitespace-nowrap first:pl-0 ${
                    isActive ? 'border-primary font-semibold text-ink' : 'border-transparent text-ink-2 hover:text-ink'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex h-14 items-center gap-4 text-sm">
            <span className="hidden text-ink-2 md:inline">{status === 'demo' ? 'Demo' : user?.email}</span>
            <Button variant="quiet" onClick={handleLogout}>
              {status === 'demo' ? 'Leave demo' : 'Log out'}
            </Button>
          </div>
        </div>
      </header>

      {status === 'demo' && (
        <div className="border-b border-rule bg-primary-soft">
          <p className="mx-auto max-w-[1120px] px-5 py-2 text-sm text-primary sm:px-8">
            You're trying Keel with sample data and made-up prices. It runs in your browser, and changes last until you close this tab.{' '}
            <Link to="/" onClick={handleLogout} className="font-semibold underline underline-offset-4">
              Create an account
            </Link>{' '}
            to keep your own portfolio.
          </p>
        </div>
      )}

      <StripBand />

      <main id="main" className="mx-auto w-full max-w-[1120px] flex-1 px-5 py-10 sm:px-8">
        <Outlet />
      </main>

      <footer className="border-t border-rule">
        <p className="mx-auto max-w-[1120px] px-5 py-6 text-sm text-muted sm:px-8">
          For education only. Keel doesn't give financial or tax advice; check with a professional before you trade.
        </p>
      </footer>
    </div>
  );
}

/** Portfolio value and the allocation strip, on every page. */
function StripBand() {
  // The overview page leads with the total itself, so the band shows only the strip there.
  const onOverview = useLocation().pathname === '/overview';
  const { data } = usePortfolioData(async (api) => {
    const [h, t] = await Promise.all([api.holdings(), api.getTargets()]);
    return { ...h, targetWeights: t.targetWeights };
  });
  if (!data || data.holdings.length === 0) return null;

  const rows = allocationRows(data.holdings, data.targetWeights, sortClasses);
  const palette = buildClassPalette(rows.map((r) => r.assetClass));
  const hasTargets = Object.keys(data.targetWeights).length > 0;

  return (
    <section aria-label="Your mix" className="border-b border-rule bg-surface">
      <div className={`mx-auto grid max-w-[1120px] items-center gap-x-10 gap-y-3 px-5 py-5 sm:px-8 ${onOverview ? '' : 'md:grid-cols-[auto_1fr]'}`}>
        {!onOverview && (
          <div>
            <p className="text-sm text-ink-2">Portfolio</p>
            <p className="text-[28px] leading-tight font-bold tracking-[-0.02em]">{usdRounded(data.totals.currentValue)}</p>
          </div>
        )}
        <AllocationStrip
          rows={rows}
          palette={palette}
          bars={hasTargets ? [{ label: 'Now', key: 'currentPct' }, { label: 'Target', key: 'targetPct', size: 'thin' }] : [{ label: 'Now', key: 'currentPct' }]}
        />
      </div>
    </section>
  );
}
