# Portfolio KPI dashboard

A simple internal tool for a VC fund to track portfolio companies' monthly KPIs and catch warning signs early.

- **Overview**: headline numbers (portfolio ARR, companies needing attention, median runway), a ranked list of warning signs, a table of every company, and runway by company.
- **Company detail**: one company's revenue, burn, cash and headcount trends, the latest numbers, its warning signs and the founders' notes.
- **Update requests** (fund admin): ask companies for specific metrics. Each request has a **title** (which becomes the title of the founders' form), a reporting month, the **metrics to request** (built-in or custom), the companies to ask and an optional due date. The page tracks who has responded, shows their answers, and gives each company its own form link.
- **Submit update**: the form founders fill in. Opened from a request link, it shows the request's title and only the requested metrics, all required. Without a link, founders pick from the requests sent to their company; the fund team can answer for any company or enter a general update.
- **People** (fund admin): founder and fund-team accounts, invite links and deactivation.

Everyone signs in. **Founders only see their own company**: its form and its figures, without the fund's warning signs or investment details. The **fund team** (admins) sees everything.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Open http://localhost:8501. On first run the app creates `data/portfolio.db` filled with a **fictional demo portfolio** of 8 companies, with demo accounts:

| Sign in as | Email | Password |
|---|---|---|
| Fund admin | `admin@demo.fund` | `demo-admin-password` |
| Founder of Cargoline (any demo founder works the same way) | `ravi@cargoline.example` | `demo-founder-password` |

These passwords are public, so only use them with the demo data.

- Reset the demo data: `python -m portfolio.seed`
- Start with an empty database for real companies: `python -m portfolio.seed --empty`, then create your own admin account (below) and add companies on the **Update requests** page

Set `PORTFOLIO_DB=/path/to/file.db` to store the database somewhere else.

## Accounts and sign-in

**Create the first admin from a terminal** (there's deliberately no sign-up page, so nobody who finds the app online can make themselves an admin):

```bash
python -m portfolio.auth add-admin
```

**Add founders and colleagues on the People page.** Enter their name and email (plus the company, for founders) and the app gives you an invite link to send them. They open it, choose their own password and are signed in. The fund never sets or sees founders' passwords.

- Invite links work once and expire after 14 days. Only a hash of each link is stored, so a link can't be shown again; click **New invite** to make a fresh one (older links stop working).
- **Forgotten passwords**: click **Reset link** next to the person and send them the new link.
- **Deactivate** removes access immediately, even for someone signed in right now. The last admin can't be deactivated.
- Anyone can change their own password on the **Account** page.

**How access is enforced.** A founder's company comes from their account, never from the link, so changing a link can't reveal another company. Pages a founder isn't allowed to use aren't registered for them at all, and the fund pages also check the role themselves.

**Security details.** Passwords are hashed with scrypt and a random salt. After 5 wrong passwords an account is locked for 15 minutes, and sign-in errors don't reveal which emails have accounts. Sessions are kept on the server and end when the browser tab is closed or **reloaded**, so people sign in again after a refresh.

## Update requests

1. On **Update requests**, enter a title (e.g. "Q3 board pack"), the reporting month and the metrics you need, then choose the companies.
2. Send founders the request's link. Each founder signs in and lands on the form for their own company. The **Founder access** column shows which companies have no founder account yet.
3. Founders submit; the request shows who has responded and who is still pending (marked overdue after the due date).

Requests can ask for just some metrics. Answers to several requests for the same month are combined, so a "cash and burn" request and a later "revenue" request add up to one complete month. A company can submit again to correct its figures. Where a month is missing a figure, the dashboard uses the most recent month that has it.

### Custom metrics

Besides the six built-in metrics, the admin can define their own under **Custom metrics** on the Update requests page: a name, a type, and an optional note shown to founders under the field.

| Type | Use for | Example |
|---|---|---|
| Number | Any figure, decimals allowed | Monthly active users |
| Whole number | Counts and scores | Net promoter score |
| Percentage | Rates, entered as e.g. 62.5 | Gross margin |
| Money | Dollar amounts | Pipeline value |
| Text | Short written answers | Biggest risk next quarter |

Custom metrics can then be picked in any request alongside the built-in ones. Answers appear in the request's table and on the company's detail page: a chart for numeric metrics with two or more months of answers, and a dated list for text answers. Custom metrics don't feed the warning signs, which use the built-in metrics only. A metric can be deleted only while no request uses it.

The built-in metrics are listed in `portfolio/fields.py`.

## Metrics

| Metric | Definition |
|---|---|
| MRR / ARR | Monthly recurring revenue as reported; ARR = MRR × 12 |
| Net burn | Cash out minus cash in for the month (negative = cash-flow positive) |
| Runway | Cash ÷ net burn, in months. "Profitable" when burn ≤ 0 |
| MoM growth | Change in MRR from the previous reported month |
| Burn multiple | Net burn ÷ net new ARR over the trailing 3 months. Below 1.5x is excellent; above 3x means growth is costly |

## Warning signs

| Severity | Trigger |
|---|---|
| 🔴 Critical | Runway under 6 months, or out of cash |
| 🟠 Serious | Runway under 12 months (should be fundraising); revenue fell two months in a row |
| 🟡 Warning | Revenue fell 10%+ in one month; burn up 30%+ month over month; burn multiple above 3x; 2+ monthly reports missed |

All thresholds are in `Thresholds` in `portfolio/metrics.py`.

## Project layout

```
app.py                  Streamlit entry point and navigation
views/                  The pages
portfolio/db.py         SQLite storage: companies, KPIs, custom metrics, requests, responses, accounts
portfolio/auth.py       Accounts, password hashing, lockout and invite links
portfolio/session.py    Who is signed in, and the sign-in and invite screens
portfolio/fields.py     Built-in metrics and custom metric types
portfolio/metrics.py    KPI calculations and warning-sign rules (pure pandas)
portfolio/seed.py       Demo portfolio generator
portfolio/ui.py         Shared formatting and chart helpers
tests/                  pytest suite
```

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

## Before using with real founders

- **Serve it over HTTPS.** Passwords and invite links travel in each request, so the app must sit behind HTTPS (most hosts, including Streamlit Community Cloud, do this for you). Never share invite links over plain HTTP.
- **Start from an empty database** (`python -m portfolio.seed --empty`) so the public demo accounts don't exist.
- **Back up `data/portfolio.db`.** SQLite on one machine is fine for a small team; move to a hosted database (e.g. Postgres) when several people need it.
- **Sending emails is up to you for now.** The app makes invite and request links but doesn't email them. Adding email (and reminders for pending requests) is a natural next step.
- **Signing in again after a refresh** is the price of keeping sessions on the server without extra infrastructure. "Remember me" would need a signed cookie and a secret key.
