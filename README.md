# Keel

Keep your portfolio on course. Import holdings from several brokers, see how far they've drifted from your target mix, plan tax-smart rebalancing trades, project dividend income, and find tax-loss harvesting chances.

**Live app:** https://keel-delta-two.vercel.app (click **Try the demo** to explore with sample data, no account needed)

> For education only. This is not financial or tax advice.

**Stack:** React 19 + Tailwind CSS (Vite) · Express · PostgreSQL · Vitest
**Hosting:** one Vercel project (React app on Vercel's CDN, Express API as a Vercel Function) and PostgreSQL on Supabase.

## Run the app

Two terminals:

```bash
# 1. API (no database install needed: it uses PGlite)
cd server && npm install && npm run dev      # http://localhost:3001/api

# 2. Web app
cd client && npm install && npm run dev      # open http://localhost:5173
```

Click **Try the demo** to use the app with sample data and no account, or create an account to save your own portfolio.

## Deployment

```
Browser ──HTTPS──▶ Vercel (one project, root: server/)
                    ├─ /assets, /index.html ... React app, served from Vercel's CDN (server/public)
                    └─ /api/* ................. Express app (server/api/index.js) as one Vercel Function
                                   │
                                   └──TLS, verified──▶ Supabase PostgreSQL (transaction pooler, port 6543)
```

- **One domain for site and API**, so the httpOnly login cookie works without any cross-site setup, and rate limiting sees each visitor's real IP.
- **Build:** `npm run build` in `server/` builds the React app into `server/public`. `vercel.json` sets the build up (framework preset "Other", output folder `public`): Vercel serves real files from its CDN first, rewrites `/api/*` to the Express function (Express still sees the original path), sends page URLs like `/overview` to `index.html` for client-side routing, sends a missing `/assets/*` file to Express for a real 404 (not HTML in place of JavaScript), and adds security headers (Content-Security-Policy, X-Frame-Options and others).
  - Why not Vercel's Express preset? It collects `public/` before the build command runs, so a website built during deploy never reached the CDN.
- **API answers are never cached** (`Cache-Control: no-store`), since they hold personal financial data.
- **Database user with limited rights:** the app connects as `keel_app`, not as the admin. It can read and write rows in Keel's tables, and can't create tables or manage roles (`db/supabase/app-role.sql`).
- **Row Level Security on every table** (migration 004). Supabase automatically puts a public web API in front of tables; with RLS on and no policies, that API can't read a row. The roles it uses also have every privilege revoked.
- **Encrypted and verified database connection:** `DATABASE_CA_CERT` holds Supabase's public root certificates (`db/certs/`), so the server only talks to a database with a certificate Supabase signed. TLS verification is never turned off.
- **Serverless-friendly:** the Supabase transaction pooler (port 6543) handles many short-lived function connections, and PGlite (dev only) is never loaded in production.

### Environment variables (Vercel)

| Name | Value |
|---|---|
| `DATABASE_URL` | `postgres://keel_app.<project-ref>:<password>@<pooler-host>:6543/postgres` (marked Sensitive) |
| `DATABASE_CA_CERT` | contents of `server/db/certs/supabase-ca-bundle.pem` |
| `DATABASE_SSL_MODE` | `verify-full`, or `verify-ca` if the pooler's certificate doesn't list its hostname |

`NODE_ENV` isn't needed: on Vercel (`VERCEL=1`) the app turns on production settings: secure cookies, trusting Vercel's proxy, and requiring `DATABASE_URL`.

### Database changes

New migrations go in `server/db/migrations/` (numbered). Run them against Supabase with `DATABASE_URL=<admin connection string> npm run db:migrate`; the `schema_migrations` table records which have run.

## Server commands

```bash
cd server
npm install
npm run dev                    # API at http://localhost:3001/api — no database install needed (uses PGlite)
npm test                       # run all tests (database tests run on PGlite, no Postgres install needed)
npm run demo:rebalance         # see the rebalancer on sample data
npm run demo:rebalance -- 5000 # same, investing $5,000
npm run demo:dividends         # 10-year dividend projection, DRIP off vs on
npm run demo:dividends -- 20   # same, 20 years
npm run demo:tax-loss          # tax-loss harvesting scan on sample accounts
npm run demo:import            # whole pipeline: CSV -> holdings -> rebalance, dividends, tax-loss
npm run demo:import -- my.csv  # same, with your own file
```

## Running the API locally

`npm run dev` starts the API and creates the database tables. Without a `DATABASE_URL`, it uses **PGlite** (real Postgres compiled to WebAssembly) and saves data in `server/.pglite/`. To use your own Postgres instead, copy `.env.example` to `.env` and set `DATABASE_URL`.

Try it with curl (`-c`/`-b` keep the login cookie):

```bash
curl -c c.txt -H 'Content-Type: application/json' -d '{"email":"me@example.com","password":"a long password"}' localhost:3001/api/auth/register
curl -b c.txt localhost:3001/api/portfolio/holdings
```

### API

All write requests must send JSON (`Content-Type: application/json`). Everything except `/api/health` and `/api/auth/*` needs you to be logged in.

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/register` | `{ email, password }` → create user and log in |
| POST | `/api/auth/login` | `{ email, password }` → log in |
| POST | `/api/auth/logout` | end the session |
| GET | `/api/auth/me` | who is logged in |
| DELETE | `/api/auth/me` | `{ password }` → delete your account and all your data |
| GET / POST | `/api/accounts` | list / create `{ name, accountType, broker?, dripEnabled? }` |
| PATCH / DELETE | `/api/accounts/:id` | change (e.g. `{ dripEnabled: true }`) / delete with its lots |
| GET / POST | `/api/lots` | list / add one lot by hand |
| DELETE | `/api/lots/:id` | delete a lot |
| PUT | `/api/asset-classes` | `{ "VTI": "US_EQUITY" }` classify tickers |
| GET | `/api/import/formats` | supported file layouts |
| POST | `/api/import` | `{ files: [{ name, text }], dryRun? }` → preview, or save (all or nothing) |
| GET / PUT | `/api/targets` | target mix `{ targets: [{ assetClass, weight, preferredTicker? }] }` |
| GET | `/api/portfolio/holdings` | merged holdings with prices |
| POST | `/api/portfolio/rebalance` | `{ mode, newCash?, inflowStrategy?, minTrade? }` |
| POST | `/api/portfolio/dividends` | `{ years?, reinvestDividends?, ...growth rates }` |
| GET | `/api/portfolio/tax-loss?asOfDate=YYYY-MM-DD` | tax-loss scan |

Errors always look like `{ "error": { "message": "...", "details": [{ "field": "...", "message": "..." }] } }`.

## Importing your holdings

Fill in `server/src/sample-data/import-template.csv` (one row per purchase, called a "lot"):

| Account | Account Type | Ticker | Shares | Cost Per Share | Acquired On | Asset Class |
|---|---|---|---|---|---|---|
| My Brokerage | Taxable | VTI | 10 | 250.00 | 2025-01-15 | US_EQUITY |

- **Account Type:** Taxable (or Brokerage / Individual), Traditional IRA, Roth IRA, 401(k), HSA
- **Cost:** `Cost Per Share` or `Total Cost`. `$1,234.56` style is fine.
- **Dates:** `2025-01-15` or `01/15/2025`
- **Headers are flexible:** `Symbol`, `Quantity`, `Cost Basis Total` and `Date Acquired` also work, so many broker "lot details" downloads import without editing.

## Project layout

```
server/
  api/index.js       Production entry: Vercel runs this as the API function
  db/migrations/     PostgreSQL schema as numbered migrations (run once each, in order)
  src/app.js         Builds the Express app (database and settings are passed in)
  src/auth/          Register, login, logout, sessions
  src/routes/        API endpoints (thin: validate input, call the repository and engines)
  src/repositories/  All SQL, always scoped to the logged-in user
  src/db/            Database layer (pg or PGlite) and the migration runner
  src/market/        Price providers (sample prices now, live prices in step 7)
  src/import/        CSV import: parsing, cleaning, adapters
    importCsv.js     Reads files, collects row errors with line numbers
    normalize.js     Tickers, money, dates, account types
    adapters/        One adapter per file layout (template now; broker formats later)
  src/engine/        Pure business logic: no database, no HTTP. Easy to test.
    holdings.js      Lots + prices -> one holding per ticker
    rebalance.js     Rebalancing engine (inflow-only and full rebalance)
    dividends.js     Dividend projection + DRIP simulator
    taxLoss.js       Tax-loss harvesting scanner with wash-sale checks
    dates.js         Time-zone-safe calendar date helpers
    money.js         Cent-exact money helpers
    errors.js        ValidationError, which the API will turn into a 400 response
  src/sample-data/   Made-up portfolios for testing (not real prices)
  scripts/           Dev server and small demo scripts
  test/              Vitest tests
client/
  src/api/           httpApi (real server), demoApi (runs in the browser), session (who's using the app)
  src/components/    Layout, AllocationStrip, DividendChart, small UI pieces
  src/pages/         One file per screen
  src/lib/           Formatting, asset-class names and colors
  src/test/          Vitest + Testing Library tests
```

## Roadmap

| Step | What | Status |
|---|---|---|
| 1 | Rebalancing engine + tests | ✅ Done |
| 2 | Dividend projection + DRIP simulator | ✅ Done |
| 3 | Database design (accounts, lots, transactions) + tax-loss harvesting scanner | ✅ Done |
| 4 | CSV import (app template, flexible headers) + holdings builder | ✅ Done |
| 5 | Express API + PostgreSQL + login | ✅ Done |
| 6 | React front end, with a demo mode on sample data | ✅ Done |
| 7 | Live market data with a price cache | Next |
| 8 | Deploy to Vercel + Supabase | ✅ Done |
| Later | Broker-specific adapters (Fidelity, Vanguard, Webull) once we have real exports | |

## Design decisions (interview notes)

### Rebalancer
- **Engine is pure functions.** Business logic doesn't know about Express or Postgres, so it's tested quickly and reused anywhere, including in the browser for demo mode.
- **Money math in cents.** In inflow-only mode, the buys add up to exactly the new cash. Splitting $100 three ways gives $33.34 + $33.33 + $33.33, not $99.99, using the largest remainder method.
- **Inflow-only never overshoots a target.** All the dollar deltas add up to the new cash, so the underweight deltas add up to at least the new cash. Each class's proportional share is never more than its own delta. A random-portfolio test checks this over 300 cases.
- **The user picks how inflow cash is split:**
  - `PROPORTIONAL` (default): every underweight class gets a share sized by its gap. Simple, but a class with a small gap can still fall further behind in %, because the whole portfolio grows.
  - `BIGGEST_GAP_FIRST`: fill the biggest gap until it's level with the next one, then fill both together ("water-filling"). It ends as close to target as possible with the cash available. A random-portfolio test checks that it's never further from target than proportional.
- **Edge cases handled:** a new user with $0 invested (no divide by zero), inflow-only with $0 cash, target weights that don't add up to 100%, asset classes with no target, a holding with a missing price, and a class with no ticker to buy.

### Dividends
- **DRIP compounds on every payment.** A quarterly payer reinvests 4 times a year and a monthly payer 12 times, at that day's projected price, instead of once a year. A hand-checked test: $1/share per quarter on 100 shares gives $406.04 in year 1, not $400.
- **`??` instead of `||` for defaults.** `rate || 0.03` turns a real 0% growth rate into 3%, because 0 is "falsy" in JavaScript. `rate ?? 0.03` only fills in null or undefined. A test breaks if anyone switches it back.
- **Assumptions are inputs, not hidden constants.** Dividend growth (3%) and price growth (6%) can be set for the whole portfolio or per holding, and the result echoes them so the UI can show them next to the chart.

### Database
- **Accounts and lots, not one row per ticker.** Account type decides whether a loss can be harvested, and each lot has its own cost and date. The merged views (`account_holdings`, `user_holdings`) are built from lots, so there's one source of truth.
- **NUMERIC for money and shares, never FLOAT.** A test shows `0.1 + 0.2` is exactly `0.3` as NUMERIC and isn't as FLOAT.
- **The database enforces rules too:** shares > 0, weights between 0 and 1, known account types, upper-case tickers, a BUY must have shares and a price, and case-insensitive unique emails. Deleting a user cascades to their data.
- **Postgres price cache instead of Redis** for v1: one less service to run.
- **Schema tests run on PGlite** (real Postgres compiled to WebAssembly), so `npm test` needs no database server. Each test runs in a transaction that is rolled back, and bad-data tests use a SAVEPOINT so a failed insert doesn't break the rest of the test.

### Tax-loss scanner
- **Lot-level.** It finds a losing lot even when the whole position is up, and tells the user to use specific lot identification so the broker doesn't sell the wrong shares.
- **Only taxable accounts are scanned,** but **buys in every account count** for the wash-sale check, including IRAs (IRS Rev. Rul. 2008-5) and reinvested dividends.
- **Same-index funds are flagged** (for example VOO and IVV both track the S&P 500), and suggested substitutes track a different index. Two indexes can still be very similar (BND and AGG, for example), so suggestions are shown as "consider," not "safe."
- **Honest status:** `NO_RECENT_BUYS_FOUND`, not "safe." The app can only see the past 30 days, so it also gives a `doNotBuyBackBefore` date 31 days out and warns when DRIP is on.
- **Dates are handled as whole UTC days,** so daylight saving time and server time zones can't shift a 30-day window by one day.
- **Not covered yet:** a spouse's accounts, options, and splitting a partial wash sale by share count.

### Import
- **Adapter pattern.** Each file layout is one adapter with `detect`, `mapHeaders` and `parseRow`. Adding a broker format means adding one file; nothing else changes. v1 ships the app's own template, with loose header matching.
- **Bad rows don't stop the import.** Good rows are kept, and every problem in a bad row is reported at once with its line number ("Line 4: Shares: "abc" is not a number. Acquired On: "02/30/2025" is not a real date.").
- **Messy input is cleaned:** `$1,234.56`, accounting negatives `(12.50)`, `BRK.B` / `BRK/B` -> `BRK-B`, Fidelity's `SPAXX**`, Excel's invisible BOM, Windows line endings, and friendly account types ("Roth IRA" -> `ROTH_IRA`). Two-digit years are rejected because `1/2/24` is ambiguous.
- **Consistency checks:** one account name can't have two account types, a future purchase date is rejected, possible duplicate rows get a warning, and there's a 5,000-row limit per file.
- **papaparse** runs in Node and in the browser, so demo mode can import a file without uploading it.
- **Missing prices don't poison totals.** A ticker with no price is left out with a warning instead of turning every total into `NaN`.

### API and login
- **Login built from scratch:** bcrypt password hashes (cost 12), and a random 256-bit session token in an **httpOnly, SameSite=Lax** cookie. JavaScript in the page can't read the token, unlike a JWT in localStorage.
- **Sessions live in Postgres, stored as SHA-256 hashes.** Logout really ends the session (a test replays a copied cookie after logout and gets 401), and a leaked database backup can't be used to log in.
- **No account guessing:** a wrong password and an unknown email return the same message, and an unknown email still runs bcrypt against a dummy hash so the response takes the same time.
- **Passwords:** 10+ characters and at most 72 bytes, because bcrypt silently ignores anything after 72 bytes.
- **CSRF:** SameSite cookies, plus every write must be `application/json`, which a plain HTML form on another site can't send.
- **IDOR protection:** every SQL query is scoped to the logged-in user. Another user's id returns 404, the same as an id that doesn't exist. Tests prove user B can't read, change or delete user A's data, and fail if the user filter is removed.
- **Delete my account:** the password is asked again even though the user is logged in (re-authentication), so a computer left logged in can't be used to wipe the account. One `DELETE FROM users` removes everything through the schema's `ON DELETE CASCADE` rules: sessions, brokerage accounts, lots, transactions, target mix and asset classes, all in one statement. Tests check every table is empty for that user, a wrong password deletes nothing, a copied cookie stops working, other users are untouched, and the email can sign up again.
- **Mass assignment protection:** request bodies use `z.strictObject`, so extra fields like `userId` are rejected.
- **Rate limit** on login and register (20 tries per IP per 15 minutes). On serverless each instance counts separately, so a shared store would be the next step.
- **Errors:** a 500 never sends the real error to the browser (it's logged on the server). Validation errors from zod and from the engines become 400s with readable messages.
- **Import is all or nothing**, in one transaction. A file with any bad row saves nothing, and re-uploading the same file skips lots that already exist. Lots are inserted with one `INSERT ... SELECT unnest(...)` instead of thousands of single inserts, which matters on serverless time limits.
- **The browser sends "today"** for the tax-loss scan, because a UTC server is already on tomorrow's date for a user in Kansas City in the evening.
- **One database interface, two engines:** `pg` in production and PGlite in dev and tests, both set to return the same types. DATE comes back as `"YYYY-MM-DD"`, because by default `pg` turns it into a JavaScript Date at local midnight, which can shift it by a day.
- **TLS stays verified.** The code never sets `rejectUnauthorized: false`. A provider certificate can be supplied in `DATABASE_CA_CERT`.
- **Testable app factory:** `createApp({ db, config, marketData })` doesn't open ports or databases itself, so 57 HTTP tests run against the real app on an in-memory Postgres in a few seconds.

### Front end
- **Demo mode with no server.** `demoApi` has the same methods and answers as `httpApi`, so no page knows which one it's using. It runs the server's own engine code (imported from `server/src` through a Vite alias), so demo numbers match the API exactly. A test checks the same figures as the server tests.
- **Shared analysis code.** `engine/analysis.js` is the single place that turns data into results, used by both the Express routes and the browser demo.
- **The demo stays true on any date.** The sample Roth purchase is always dated "14 days ago", so the wash-sale warning appears whenever someone opens the demo.
- **The allocation strip** is a segmented bar built from plain divs. Shares are printed only when they fit. Every part is keyboard-focusable with an accessible name, and there's a tooltip on hover or focus, a legend, and a table with the same numbers.
- **Colors checked with a color-vision validator.** The four asset-class colors stay distinguishable for common color blindness when combined with the strip's gaps and labels. Colors follow the class (bonds are always the same color) and never its position. A fifth class or more is grouped as "Other".
- **All text meets WCAG AA contrast** (4.5:1 or more). Gains and losses use a sign (+ or −) as well as color, and alerts have icons.
- **Dividend chart:** one y-axis, 2px lines, solid hairline grid, a legend plus a label at each line's end, a crosshair tooltip, and a table view. The chart library is lazy-loaded, which cut the main bundle from 737 KB to 323 KB.
- **No flicker:** while a page reloads, the old numbers stay on screen (dimmed) instead of flashing a spinner, and inputs are debounced so typing doesn't send a request per keystroke.
- **Accessibility:** a skip link, labels on every input, focus outlines, radio groups for choices, a real checkbox behind each switch, and reduced-motion support.
- **Tests:** 19 client tests, including a full run through the app (try the demo → overview → rebalance with "biggest gaps first" → leave), plus checks in real headless Chrome at desktop and phone widths.

### Before real users (not built yet)
- Password reset by email, and email verification at sign-up
- A rate limit shared across server instances (for example in Postgres or Redis)
- "Download my data" (export) next to "Delete my account"

### Everywhere
- **Bad input throws `ValidationError`** with a message a user can read, so the API can return a 400 instead of crashing.
- **Tests are checked by breaking the code on purpose.** Each fix was reverted once to confirm a test fails.
