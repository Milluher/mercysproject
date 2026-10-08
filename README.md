# Portfolio KPI dashboard

A web app for a VC fund to collect monthly KPIs from portfolio companies and catch warning signs early. Built with Next.js and Postgres, ready to deploy on Vercel.

- **Overview** (fund team): portfolio ARR, companies needing attention, median runway, ranked warning signs, every company at a glance, and runway by company.
- **Company detail**: a company's revenue, burn, cash and headcount trends, custom metrics and founder notes.
- **Update requests** (fund team): ask companies for specific metrics. Each request has a **title** (which becomes the title of the founders' form), a reporting month, the **metrics to request** (built-in or custom), the companies to ask and an optional due date. Tracks who has responded and shows their answers.
- **Submit update**: founders answer the requests sent to their company. The fund team can answer for any company or enter a general update.
- **People** (fund team): founder and fund-team accounts, invite links and deactivation.

Everyone signs in. **Founders only see their own company** (its forms and figures, without the fund's warning signs or investment details). The **fund team** (admins) sees everything.

## Deploy on Vercel

You need a Vercel account and access to this GitHub repository.

1. **Import the project.** In Vercel, choose **Add New → Project**, pick this repository and click **Deploy**. Vercel detects Next.js; no settings to change. (This first deploy shows an error page until step 2 is done.)
2. **Add a database.** In the project, open **Storage → Create Database**, choose **Neon** (Postgres; the free plan is plenty) and connect it to the project. This adds `DATABASE_URL` for you. The app creates its tables on first use.
3. **Add settings** under **Settings → Environment Variables**:
   - `SETUP_TOKEN`: a long random value (at least 12 characters). It's the one-time code for creating the first admin.
   - `SEED_DEMO` = `true` *(optional)*: fills an empty database with the fictional demo portfolio and demo accounts. Only for trying it out: the demo passwords are public. Leave it out for real use.
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the new settings take effect.
5. **Create the first admin.** Open `https://<your-project>.vercel.app/setup`, enter the `SETUP_TOKEN` and your details. You're signed in. Add everyone else from **People**. Once the admin exists the setup page closes itself, and you can delete `SETUP_TOKEN`.

**Which branch is live.** Vercel's production address serves the repository's default branch (usually `main`). Other branches get preview addresses, which Vercel protects with a Vercel sign-in by default, so founders can't open them. Either merge this work into `main`, or point production at this branch under **Settings → Environments → Production → Branch Tracking**.

Optional: set `APP_URL` (e.g. `https://kpis.yourfund.com`) if you add a custom domain, so invite and request links use it.

## Demo accounts

Only exist when `SEED_DEMO=true` (and locally by default):

| Sign in as | Email | Password |
|---|---|---|
| Fund admin | `admin@demo.fund` | `demo-admin-password` |
| Founder of Cargoline (other demo founders work the same way) | `ravi@cargoline.example` | `demo-founder-password` |

## Run it on your computer

Requires Node.js 20 or newer.

```bash
npm install
SEED_DEMO=true SETUP_TOKEN=local-setup-code npm run dev
```

Open http://localhost:3000. Without `DATABASE_URL`, the app uses a built-in Postgres (PGlite) stored in `.data/`, so there's nothing else to install. Delete `.data/` to start again.

## Accounts and security

- **Founders are invited, never given passwords.** On **People**, enter a founder's name, email and company; the app gives you a single-use invite link (expires in 14 days) to send them. They choose their own password. **Reset link** makes a new link for a forgotten password; **Deactivate** removes access immediately, ending any open sessions.
- **Access is enforced on the server.** A founder's company comes from their account, never from a link or form, and every page and form action checks the person's role. Founders get "page not found" for anything that isn't theirs.
- **Passwords** are hashed with scrypt and a random salt. After 5 wrong passwords an account locks for 15 minutes, and sign-in errors don't reveal which emails have accounts.
- **Sessions** last 30 days in a secure, httpOnly cookie. Only hashes of session and invite tokens are stored, so a leaked database doesn't contain working links or sign-ins. Changing your password signs out your other devices.
- **First admin** is created at `/setup`, which needs the `SETUP_TOKEN` and closes once an admin exists.

## Update requests and custom metrics

1. On **Update requests**, enter a title (e.g. "Q3 board pack"), the reporting month and the metrics you need, then choose the companies.
2. Copy the request's link and send it to founders. Each founder signs in and lands on the form for their own company. The **Founder access** column shows companies with nobody who can sign in yet.
3. The request shows who has responded, their answers, and who is still pending (marked overdue after the due date).

Requests can ask for just some metrics. Answers for the same month are combined, so a "cash and burn" request and a later "revenue" request add up to one complete month. Where a month is missing a figure, the dashboard uses the most recent month that has it.

**Custom metrics** (under *Custom metrics* on the Update requests page): give a name, a type (number, whole number, percentage, money or text) and an optional note for founders. They can be requested like built-in metrics; answers appear in the request's table and on the company page. Custom metrics don't feed the warning signs. A metric can only be deleted while no request uses it.

## Metrics and warning signs

| Metric | Definition |
|---|---|
| MRR / ARR | Monthly recurring revenue as reported; ARR = MRR × 12 |
| Net burn | Cash out minus cash in for the month (negative = cash-flow positive) |
| Runway | Cash ÷ net burn, in months. "Profitable" when burn ≤ 0 |
| Burn multiple | Net burn ÷ net new ARR over the trailing 3 months; blank when ARR didn't grow |

| Severity | Trigger |
|---|---|
| 🔴 Critical | Runway under 6 months, or out of cash |
| 🟠 Serious | Runway under 12 months; revenue fell two months in a row |
| 🟡 Warning | Revenue down 10%+ in a month; burn up 30%+; burn multiple above 3x; 2+ monthly reports missed |

Thresholds are in `DEFAULT_THRESHOLDS` in `src/lib/metrics.ts`.

## Project layout

```
src/app/                 Pages (App Router) and server actions (actions.ts)
src/app/(app)/           Signed-in pages: overview, company, requests, submit, people, account
src/components/          Forms, charts and other UI pieces
src/lib/db.ts            Database access and schema (Postgres via DATABASE_URL, or local PGlite)
src/lib/data.ts          Companies, updates, custom metrics, requests
src/lib/auth.ts          Accounts, passwords, invites, sessions
src/lib/session.ts       Session cookie and the access guards pages and actions use
src/lib/metrics.ts       KPI calculations and warning-sign rules
src/lib/seed.ts          Demo portfolio
src/proxy.ts             Passes the requested path along and sets security headers
tests/                   Unit and integration tests (Vitest)
e2e/                     Browser tests (Playwright)
```

## Tests

```bash
npm test                 # unit + integration tests on an in-memory database
npm run test:e2e         # builds the app and runs browser tests against it
TEST_DATABASE_URL=postgres://... npm test   # the same tests against a real Postgres (its public schema is wiped!)
```

## Not done yet

- **Emails**: the app makes invite and request links but doesn't send them; you send them yourself for now. Emailing invites and reminders for pending requests is a natural next step.
- **Backups**: Neon keeps point-in-time history on its paid plans; on the free plan, take occasional exports.
