# Portfolio KPI dashboard

A simple internal tool for a VC fund to track portfolio companies' monthly KPIs and catch warning signs early.

- **Overview**: headline numbers (portfolio ARR, companies needing attention, median runway), a ranked list of warning signs, a table of every company, and runway by company.
- **Company detail**: one company's revenue, burn, cash and headcount trends, the latest numbers, its warning signs and the founders' notes.
- **Update requests** (fund admin): ask companies for specific metrics. Each request has a **title** (which becomes the title of the founders' form), a reporting month, the **metrics to request** (built-in or custom), the companies to ask and an optional due date. The page tracks who has responded, shows their answers, and gives each company its own form link.
- **Submit update**: the form founders fill in. Opened from a request link, it shows the request's title and only the requested metrics, all required. Without a link, the team can pick a request or enter a general update with every metric.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Open http://localhost:8501. On first run the app creates `data/portfolio.db` filled with a **fictional demo portfolio** of 8 companies.

- Reset the demo data: `python -m portfolio.seed`
- Start with an empty database for real companies: `python -m portfolio.seed --empty`, then add companies on the **Submit update** page

Set `PORTFOLIO_DB=/path/to/file.db` to store the database somewhere else.

## Update requests

1. On **Update requests**, enter a title (e.g. "Q3 board pack"), the reporting month and the metrics you need, then choose the companies.
2. Send each founder the form link from their row in the request's table. It opens the form for their company, without the fund's other pages in the sidebar.
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
portfolio/db.py         SQLite storage: companies, KPIs, custom metrics, requests and responses
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

This is a starting point for internal use. Before sharing the submit form with founders outside the fund, add:

- **Authentication**: right now anyone who can reach the app can see every company and submit for any company. Hiding the sidebar on founder links is presentation only. Request links contain plain request and company numbers, so they are easy to guess. Give each founder a login, or private links with unguessable tokens that only cover their own company.
- **Hosting with backups**: SQLite on one machine is fine for a small team; move to a hosted database (e.g. Postgres) when several people need it.
- **Reminders**: email founders their request link, and nudge those still pending near the due date.
