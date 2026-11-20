// The first screen. Its one moving moment: the sample portfolio's mix slides from where it
// has drifted to its target, which is exactly what Keel helps you do.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../api/session.jsx';
import { Wordmark } from '../components/Layout.jsx';
import { SegmentedBar } from '../components/AllocationStrip.jsx';
import { Button, Field, Input, ErrorAlert, Alert } from '../components/ui.jsx';
import { buildClassPalette, className } from '../lib/assetClasses.js';

// The sample portfolio from the demo (npm run demo:import): where it is now and its target.
const SAMPLE = [
  { assetClass: 'US_EQUITY', now: 0.4826, target: 0.55 },
  { assetClass: 'INTL_EQUITY', now: 0.1340, target: 0.2 },
  { assetClass: 'BONDS', now: 0.2627, target: 0.15 },
  { assetClass: 'REIT', now: 0.1206, target: 0.1 },
];

function RebalanceMoment() {
  const palette = buildClassPalette(SAMPLE.map((s) => s.assetClass));
  const [rebalanced, setRebalanced] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRebalanced(true), 700);
    return () => clearTimeout(timer);
  }, []);

  const parts = (key) =>
    SAMPLE.map((s) => ({
      key: s.assetClass,
      label: className(s.assetClass),
      share: s[key],
      color: palette.get(s.assetClass).color,
      ink: palette.get(s.assetClass).ink,
    }));

  return (
    <figure className="mt-12 max-w-[560px]">
      <div className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-3">
        <span className="text-sm text-ink-2">Drifted</span>
        <SegmentedBar name="Sample portfolio now" parts={parts('now')} />
        <span className="text-sm text-ink-2">{rebalanced ? 'Rebalanced' : 'Rebalancing'}</span>
        <SegmentedBar name="Sample portfolio after rebalancing" parts={parts(rebalanced ? 'target' : 'now')} />
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 pl-[7.25rem] text-sm text-ink-2" aria-label="Legend">
        {SAMPLE.map((s) => (
          <li key={s.assetClass} className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ background: palette.get(s.assetClass).color }} />
            {className(s.assetClass)}
          </li>
        ))}
      </ul>
      <figcaption className="mt-4 pl-[7.25rem] text-sm text-muted">
        The demo portfolio: bonds have grown to 26% against a 15% target.
      </figcaption>
    </figure>
  );
}

function AuthForm() {
  const { login, register } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isSignup = mode === 'signup';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (isSignup ? register(email, password) : login(email, password));
      navigate('/overview');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (field) => error?.details?.find((d) => d.field === field)?.message;

  return (
    <div className="rounded-[10px] border border-rule bg-surface p-6 sm:p-8">
      <h2 className="text-[21px] font-bold tracking-[-0.01em]">{isSignup ? 'Create your account' : 'Sign in'}</h2>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="Email" error={fieldError('email')}>
          {(props) => <Input {...props} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Field label="Password" hint={isSignup ? 'At least 10 characters.' : undefined} error={fieldError('password')}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        {error && !error.details?.length && <ErrorAlert error={error} />}
        <Button type="submit" disabled={busy}>
          {busy ? 'One moment…' : isSignup ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-5 text-sm text-ink-2">
        {isSignup ? 'Already have an account? ' : 'New to Keel? '}
        <button
          type="button"
          className="font-semibold text-primary underline-offset-4 hover:underline"
          onClick={() => {
            setMode(isSignup ? 'signin' : 'signup');
            setError(null);
          }}
        >
          {isSignup ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </div>
  );
}

export function Landing() {
  const { enterDemo, notice } = useSession();
  const navigate = useNavigate();

  async function tryDemo() {
    await enterDemo();
    navigate('/overview');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1120px] items-center px-5 sm:px-8">
        <Wordmark />
      </header>
      <main className="mx-auto grid w-full max-w-[1120px] flex-1 items-start gap-12 px-5 pt-10 pb-16 sm:px-8 lg:grid-cols-[1fr_380px] lg:pt-20">
        <div>
          {notice && (
            <div className="mb-8 max-w-[56ch]">
              <Alert tone="info" title={notice} />
            </div>
          )}
          <h1 className="max-w-[16ch] text-[40px] leading-[1.05] font-extrabold tracking-[-0.035em] sm:text-[56px]">
            Your mix drifts. Keel shows what to buy to bring it back.
          </h1>
          <p className="mt-6 max-w-[56ch] text-[18px] leading-relaxed text-ink-2">
            Import your holdings from any broker and set the mix you want. Keel plans the trades, including a buy-only plan that
            never sells at a gain. It also projects your dividends and finds losses you could harvest at tax time.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Button onClick={tryDemo} className="h-11! px-5! text-base">
              Try the demo
            </Button>
            <p className="text-sm text-muted">No account needed. Sample data, runs in your browser.</p>
          </div>
          <RebalanceMoment />
        </div>
        <AuthForm />
      </main>
      <footer className="border-t border-rule">
        <p className="mx-auto max-w-[1120px] px-5 py-6 text-sm text-muted sm:px-8">
          For education only. Keel doesn't give financial or tax advice; check with a professional before you trade.
        </p>
      </footer>
    </div>
  );
}
