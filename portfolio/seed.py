"""Generate a fictional demo portfolio so the dashboard has data on first run.

Run directly to (re)build the demo database:  python -m portfolio.seed
Or to start an empty database for real data:  python -m portfolio.seed --empty
"""

from __future__ import annotations

import random
from datetime import date
from pathlib import Path

import pandas as pd

from portfolio import auth, db
from portfolio.fields import DEFAULT_FIELDS

MONTHS_OF_HISTORY = 15

# Each scenario is chosen to exercise a different warning sign on the dashboard.
DEMO_COMPANIES = [
    # Cash is solved backwards so each company ends on `end_runway` months of runway
    # (or `end_cash` for a cash-flow positive company).
    dict(name="Lumen Health", sector="Healthtech", stage="Series A", invested=3_000_000, ownership=12.0,
         mrr=60_000, growth=0.09, end_runway=20, burn=260_000, burn_growth=0.02, headcount=24),
    dict(name="Cargoline", sector="Logistics", stage="Seed", invested=1_200_000, ownership=15.0,
         mrr=18_000, growth=0.05, end_runway=4.5, burn=170_000, burn_growth=0.03, headcount=11),  # runway running out
    dict(name="Fernly", sector="Consumer", stage="Seed", invested=800_000, ownership=10.0,
         mrr=45_000, growth=0.04, end_runway=10, burn=95_000, burn_growth=0.0, headcount=9,
         decline_last=3),  # revenue falling
    dict(name="Quanta Ledger", sector="Fintech", stage="Series B", invested=5_000_000, ownership=8.0,
         mrr=420_000, growth=0.06, end_cash=14_000_000, burn=-20_000, burn_growth=0.0, headcount=68),  # profitable
    dict(name="Atlas Robotics", sector="Deep tech", stage="Series A", invested=4_000_000, ownership=11.0,
         mrr=25_000, growth=0.07, end_runway=22, burn=380_000, burn_growth=0.01, headcount=31,
         burn_spike=True),  # burn jumps last month
    dict(name="Nimbus Learning", sector="Edtech", stage="Seed", invested=1_000_000, ownership=14.0,
         mrr=30_000, growth=0.05, end_runway=14, burn=110_000, burn_growth=0.02, headcount=13,
         stale_months=4),  # stopped reporting
    dict(name="Verdant Grid", sector="Climate", stage="Series A", invested=3_500_000, ownership=9.5,
         mrr=95_000, growth=0.08, end_runway=24, burn=300_000, burn_growth=0.02, headcount=27),
    dict(name="Pathwise", sector="HR tech", stage="Pre-seed", invested=400_000, ownership=18.0,
         mrr=6_000, growth=0.12, end_runway=16, burn=55_000, burn_growth=0.03, headcount=5),
]


def _add_months(d: date, n: int) -> date:
    total = d.year * 12 + (d.month - 1) + n
    return date(total // 12, total % 12 + 1, 1)


def build_demo_db(db_path: Path | str = db.DEFAULT_DB_PATH, today: date | None = None, seed: int = 7) -> None:
    rng = random.Random(seed)
    today = today or date.today()
    last_month = _add_months(today.replace(day=1), -1)
    first_month = _add_months(last_month, -(MONTHS_OF_HISTORY - 1))

    db_path = Path(db_path)
    if db_path.exists():
        db_path.unlink()
    db.init_db(db_path)

    for spec in DEMO_COMPANIES:
        company_id = db.add_company(
            spec["name"], spec["sector"], spec["stage"], invested_on=_add_months(first_month, -3),
            amount_invested=spec["invested"], ownership_pct=spec["ownership"], db_path=db_path,
        )
        mrr, burn, headcount = spec["mrr"], spec["burn"], spec["headcount"]
        months = MONTHS_OF_HISTORY - spec.get("stale_months", 0)

        rows = []
        for i in range(months):
            months_left = months - i
            if i > 0:
                growth = spec["growth"] + rng.uniform(-0.02, 0.02)
                if months_left <= spec.get("decline_last", 0):
                    growth = -rng.uniform(0.06, 0.12)
                mrr *= 1 + growth
                burn *= 1 + spec["burn_growth"] + rng.uniform(-0.02, 0.02)
                if spec.get("burn_spike") and months_left == 1:
                    burn *= 1.45
                if rng.random() < 0.25:
                    headcount += 1
            rows.append((_add_months(first_month, i), mrr, burn, headcount))

        cash = spec["end_cash"] if "end_runway" not in spec else spec["end_runway"] * rows[-1][2]
        for month, mrr, burn, headcount in reversed(rows):
            db.upsert_update(
                company_id, month,
                revenue=round(mrr), burn=round(burn), cash=round(cash), headcount=headcount,
                customers=max(1, round(mrr / rng.uniform(900, 1100))),
                submitted_on=min(_add_months(month, 1).replace(day=rng.randint(3, 12)), today),
                db_path=db_path,
            )
            cash += burn  # cash at the end of the previous month

    add_demo_request(db_path, today, last_month)
    add_demo_board_pack(db_path, today, last_month, rng)
    add_demo_users(db_path)


def add_demo_request(db_path: Path | str, today: date, last_month: date) -> None:
    """A monthly update request that every company except the stale one has answered."""
    companies = db.load_companies(db_path)
    request_id = db.create_request(
        f"{last_month:%B %Y} monthly update", last_month, list(DEFAULT_FIELDS), list(companies["id"]),
        due_on=today.replace(day=15), db_path=db_path,
    )
    updates = db.load_updates(db_path)
    answered = updates[updates["month"] == pd.Timestamp(last_month)]
    with db.connect(db_path) as conn:
        conn.executemany(
            "INSERT INTO request_responses (request_id, company_id, submitted_on) VALUES (?, ?, ?)",
            [(request_id, int(r.company_id), r.submitted_on.date().isoformat()) for r in answered.itertuples()],
        )


# Answers to the demo board pack's free-text question.
DEMO_RISKS = {
    "Lumen Health": "Hospital procurement cycles slipping into next year",
    "Fernly": "Churn among customers acquired through the spring promotion",
    "Quanta Ledger": "New banking regulation could delay two enterprise launches",
    "Atlas Robotics": "Supplier lead times for actuators are now 20 weeks",
    "Verdant Grid": "Grid-connection approvals in two pilot regions",
}


def add_demo_board_pack(db_path: Path | str, today: date, last_month: date, rng: random.Random) -> None:
    """Custom metrics and a quarterly request using them, answered by five of the eight companies."""
    margin = db.add_custom_metric(
        "Gross margin", "percent", "Revenue minus cost of goods sold, as a percentage of revenue", db_path=db_path
    )
    nps = db.add_custom_metric("Net promoter score", "integer", "From -100 to 100", db_path=db_path)
    risk = db.add_custom_metric("Biggest risk next quarter", "text", db_path=db_path)

    companies = db.load_companies(db_path).set_index("name")
    cash = db.load_updates(db_path).set_index(["company", "month"])["cash"]

    # Six months of gross margin history for the responding companies, so the company page has a trend.
    latest_margin = {}
    for name in DEMO_RISKS:
        level = rng.uniform(45, 78)
        for i in range(-5, 1):
            month = _add_months(last_month, i)
            level += rng.uniform(-1.5, 2.0)
            db.save_values(
                int(companies.loc[name, "id"]), month, {f"custom:{margin}": round(level, 1)},
                submitted_on=min(_add_months(month, 1).replace(day=8), today), db_path=db_path,
            )
        latest_margin[name] = round(level, 1)

    request_id = db.create_request(
        "Q3 board pack", last_month,
        [f"custom:{margin}", f"custom:{nps}", f"custom:{risk}", "cash"], list(companies["id"]),
        due_on=today.replace(day=28), db_path=db_path,
    )
    for name, risk_text in DEMO_RISKS.items():
        company_id = int(companies.loc[name, "id"])
        db.submit_request_response(
            request_id, company_id,
            {
                f"custom:{margin}": latest_margin[name],
                f"custom:{nps}": rng.randint(20, 65),
                f"custom:{risk}": risk_text,
                "cash": cash[(name, pd.Timestamp(last_month))],
            },
            submitted_on=today, db_path=db_path,
        )


# Demo sign-ins, printed in the README. Only for the fictional demo database.
DEMO_ADMIN = ("Demo Admin", "admin@demo.fund", "demo-admin-password")
DEMO_FOUNDER_PASSWORD = "demo-founder-password"
DEMO_FOUNDERS = {
    "Lumen Health": ("Ada Okafor", "ada@lumenhealth.example"),
    "Cargoline": ("Ravi Menon", "ravi@cargoline.example"),
    "Fernly": ("Sofia Lindqvist", "sofia@fernly.example"),
    "Quanta Ledger": ("Tomás Rivera", "tomas@quantaledger.example"),
    "Atlas Robotics": ("Mei Chen", "mei@atlasrobotics.example"),
    "Nimbus Learning": ("Kwame Asante", "kwame@nimbuslearning.example"),  # invited, hasn't signed in yet
    "Verdant Grid": ("Lena Fischer", "lena@verdantgrid.example"),
    "Pathwise": ("Noor Haddad", "noor@pathwise.example"),
}


def add_demo_users(db_path: Path | str) -> None:
    name, email, password = DEMO_ADMIN
    auth.create_user(email, name, "admin", password=password, db_path=db_path)
    companies = db.load_companies(db_path).set_index("name")["id"]
    for company, (name, email) in DEMO_FOUNDERS.items():
        password = None if company == "Nimbus Learning" else DEMO_FOUNDER_PASSWORD
        user = auth.create_user(email, name, "founder", int(companies[company]), password=password, db_path=db_path)
        if password is None:
            auth.create_invite(user.id, db_path)


if __name__ == "__main__":
    import sys

    if "--empty" in sys.argv:
        db.DEFAULT_DB_PATH.unlink(missing_ok=True)
        db.init_db()
        print(f"Empty database created at {db.DEFAULT_DB_PATH}")
    else:
        build_demo_db()
        print(f"Demo portfolio written to {db.DEFAULT_DB_PATH}")
