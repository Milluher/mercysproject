# Portfolio KPI dashboard

A simple internal tool for a VC fund to track portfolio companies' monthly KPIs and catch warning signs early.

- **Overview**: headline numbers (portfolio ARR, companies needing attention, median runway), a ranked list of warning signs, a table of every company, and runway by company.
- **Company detail**: one company's revenue, burn, cash and headcount trends, the latest numbers, its warning signs and the founders' notes.
- **Submit update**: a monthly form for founders (or an analyst entering numbers for them). It flags new warning signs as soon as an update is saved.

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
views/                  The three pages
portfolio/db.py         SQLite storage
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

- **Authentication**: right now anyone with the link can see every company and submit for any company. Give each founder a login, or a private link that only covers their own company.
- **Hosting with backups**: SQLite on one machine is fine for a small team; move to a hosted database (e.g. Postgres) when several people need it.
- **Reminders**: an email nudge to founders who have missed a report.
