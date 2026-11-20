import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { SessionProvider } from '../api/session.jsx';
import { AppRoutes } from '../App.jsx';
import { AllocationStrip } from '../components/AllocationStrip.jsx';
import { TargetEditor } from '../pages/Settings.jsx';
import { buildClassPalette } from '../lib/assetClasses.js';
import { pct, points, signedUsd, date } from '../lib/format.js';

beforeEach(() => {
  // Not logged in: the API answers 401 to "who am I?"
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Please log in.' } }), { status: 401 })));
});

describe('format', () => {
  it('formats money, percents and dates', () => {
    expect(pct(0.48257)).toBe('48.3%');
    expect(points(0.113)).toBe('+11.3 pts');
    expect(points(-0.067)).toBe('−6.7 pts');
    expect(signedUsd(-50)).toBe('−$50.00');
    expect(date('2026-11-19')).toBe('Nov 19, 2026');
  });
});

describe('asset class colors', () => {
  it('follow the class, not its position', () => {
    const a = buildClassPalette(['BONDS', 'US_EQUITY']);
    const b = buildClassPalette(['US_EQUITY', 'INTL_EQUITY', 'BONDS']);
    expect(a.get('BONDS').color).toBe(b.get('BONDS').color);
    expect(a.get('US_EQUITY').color).toBe('var(--color-class-1)');
  });

  it('give other classes the free slots, and group the fifth and later as "Other"', () => {
    const palette = buildClassPalette(['US_EQUITY', 'BONDS', 'CASH', 'GOLD', 'CRYPTO']);
    // INTL_EQUITY (slot 2) and REIT (slot 4) aren't used, so CASH and CRYPTO take them, in alphabetical order.
    expect(palette.get('CASH').color).toBe('var(--color-class-2)');
    expect(palette.get('CRYPTO').color).toBe('var(--color-class-4)');
    expect(palette.get('GOLD').folded).toBe(true);
  });
});

describe('AllocationStrip', () => {
  const rows = [
    { assetClass: 'US_EQUITY', currentPct: 0.6, targetPct: 0.5 },
    { assetClass: 'BONDS', currentPct: 0.4, targetPct: 0.5 },
  ];

  it('names every part for screen readers and keyboard users, and shows a legend', () => {
    render(<AllocationStrip rows={rows} palette={buildClassPalette(['US_EQUITY', 'BONDS'])} bars={[{ label: 'Now', key: 'currentPct' }]} />);
    const bar = screen.getByRole('group', { name: 'Now mix' });
    expect(within(bar).getByLabelText('US stocks: 60.0%')).toHaveAttribute('tabindex', '0');
    expect(within(bar).getByLabelText('Bonds: 40.0%')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'US stocks',
      'Bonds',
    ]);
  });

  it('shows a tooltip on hover', async () => {
    render(<AllocationStrip rows={rows} palette={buildClassPalette(['US_EQUITY', 'BONDS'])} bars={[{ label: 'Now', key: 'currentPct' }]} />);
    await userEvent.hover(screen.getByLabelText('Bonds: 40.0%'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Bonds 40.0%');
  });
});

describe('TargetEditor', () => {
  it('only lets you save when the percents add up to 100, and saves them as decimals', async () => {
    const saveTargets = vi.fn(async () => ({ targetWeights: {}, preferredTickers: {} }));
    const api = {
      isDemo: true,
      me: async () => ({ user: { id: 1, email: 'x' } }),
      getTargets: async () => ({ targetWeights: { US_EQUITY: 0.6, BONDS: 0.4 }, preferredTickers: {} }),
      saveTargets,
    };
    render(
      <SessionProvider apiOverride={api}>
        <TargetEditor />
      </SessionProvider>
    );
    const user = userEvent.setup();
    const bonds = await screen.findByLabelText('Percent for Bonds');
    const save = screen.getByRole('button', { name: 'Save target mix' });

    await user.clear(bonds);
    await user.type(bonds, '30');
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('Add 10 points to reach 100%.')).toBeInTheDocument();
    expect(save).toBeDisabled();

    await user.clear(bonds);
    await user.type(bonds, '40');
    expect(save).toBeEnabled();
    await user.click(save);
    expect(saveTargets).toHaveBeenCalledWith([
      { assetClass: 'US_EQUITY', weight: 0.6 },
      { assetClass: 'BONDS', weight: 0.4 },
    ]);
  });
});

describe('the whole app in demo mode', () => {
  it('a visitor tries the demo, sees the sample portfolio, and can leave', async () => {
    const user = userEvent.setup();
    render(
      <SessionProvider>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
    );

    await user.click(await screen.findByRole('button', { name: 'Try the demo' }));
    expect(await screen.findByText('$37,300.00')).toBeInTheDocument();
    expect(screen.getByText(/sample data and made-up prices/)).toBeInTheDocument();
    expect(await screen.findByText(/is 11.3 points over target/)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Rebalance' }));
    await user.click(await screen.findByText('Biggest gaps first'));
    await waitFor(() => expect(screen.getByText('$702.50')).toBeInTheDocument(), { timeout: 2000 });

    await user.click(screen.getByRole('button', { name: 'Leave demo' }));
    expect(await screen.findByRole('button', { name: 'Try the demo' })).toBeInTheDocument();
  });

  it('a guest who opens a signed-in page is sent to the start page', async () => {
    render(
      <SessionProvider>
        <MemoryRouter initialEntries={['/holdings']}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
    );
    expect(await screen.findByRole('heading', { name: /Your mix drifts/ })).toBeInTheDocument();
  });
});

describe('delete my account', () => {
  function fakeApi(deleteMyAccount) {
    return {
      isDemo: false,
      me: async () => ({ user: { id: 7, email: 'siang@example.com' } }),
      holdings: async () => ({ holdings: [], totals: { currentValue: 0, totalCostBasis: 0, unrealizedGain: 0 }, warnings: [] }),
      getTargets: async () => ({ targetWeights: { US_EQUITY: 1 }, preferredTickers: {} }),
      listAccounts: async () => ({ accounts: [] }),
      deleteMyAccount,
    };
  }

  function renderSettings(api) {
    render(
      <SessionProvider apiOverride={api}>
        <MemoryRouter initialEntries={['/settings']}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
    );
  }

  it('asks for the password, keeps the account on a wrong one, and returns to the start page when done', async () => {
    const { ApiError } = await import('../api/httpApi.js');
    const deleteMyAccount = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(403, 'That password is wrong. Your account was not deleted.'))
      .mockResolvedValueOnce(null);
    renderSettings(fakeApi(deleteMyAccount));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const confirm = screen.getByRole('button', { name: 'Permanently delete my account' });
    expect(confirm).toBeDisabled(); // nothing happens without a password

    await user.type(screen.getByLabelText('Enter your password to confirm'), 'wrong one');
    await user.click(confirm);
    expect(await screen.findByText('That password is wrong. Your account was not deleted.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument(); // still here, still logged in

    const field = screen.getByLabelText('Enter your password to confirm');
    await user.clear(field);
    await user.type(field, 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Permanently delete my account' }));

    expect(deleteMyAccount).toHaveBeenLastCalledWith('correct horse battery');
    expect(await screen.findByText('Your account and all your data were deleted.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try the demo' })).toBeInTheDocument();
  });

  it('"Keep my account" closes the confirmation without deleting', async () => {
    const deleteMyAccount = vi.fn();
    renderSettings(fakeApi(deleteMyAccount));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    await user.click(screen.getByRole('button', { name: 'Keep my account' }));
    expect(screen.queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument();
    expect(deleteMyAccount).not.toHaveBeenCalled();
  });

  it("isn't shown in demo mode (there's no account to delete)", async () => {
    render(
      <SessionProvider apiOverride={{ ...fakeApi(vi.fn()), isDemo: true }}>
        <MemoryRouter initialEntries={['/settings']}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
    );
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument();
  });
});
