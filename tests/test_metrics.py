import math
from datetime import date

import pandas as pd
import pytest

from portfolio import db, seed
from portfolio.metrics import (
    Thresholds,
    add_derived,
    company_flags,
    health_status,
    latest_snapshot,
    portfolio_flags,
    runway_months,
)

TODAY = date(2026, 10, 7)


def history(company="Acme", revenue=(100, 110, 121), burn=(50, 50, 50), cash=(1000, 950, 900), start="2026-07-01"):
    months = pd.date_range(start, periods=len(revenue), freq="MS")
    return pd.DataFrame(
        {"company": company, "month": months, "revenue": revenue, "burn": burn, "cash": cash, "headcount": 5}
    )


def flags_for(df, today=TODAY, **thresholds):
    derived = add_derived(df)
    return {(f.metric, f.severity) for f in company_flags(derived, today, Thresholds(**thresholds))}


def test_runway_months():
    assert runway_months(1200, 100) == 12
    assert runway_months(1200, 0) == math.inf
    assert runway_months(1200, -50) == math.inf
    assert runway_months(-10, 100) == 0


def test_derived_columns():
    d = add_derived(history())
    assert d["revenue_growth"].iloc[1] == pytest.approx(0.10)
    assert pd.isna(d["revenue_growth"].iloc[0])
    assert d["runway_months"].iloc[-1] == 18
    assert d["arr"].iloc[0] == 1200


def test_growth_is_computed_per_company():
    df = pd.concat([history("A", revenue=(100, 200, 300)), history("B", revenue=(50, 50, 50))])
    d = add_derived(df)
    assert pd.isna(d[d.company == "B"]["revenue_growth"].iloc[0])  # does not compare against company A


def test_burn_multiple():
    df = history(revenue=(100, 100, 100, 200), burn=(50, 60, 70, 80), cash=(5000,) * 4, start="2026-06-01")
    d = add_derived(df)
    # trailing 3-month burn 210 / net new ARR (200 - 100) * 12 = 1200
    assert d["burn_multiple"].iloc[-1] == pytest.approx(210 / 1200)


def test_burn_multiple_undefined_without_growth_or_when_profitable():
    flat = add_derived(history(revenue=(100,) * 4, cash=(5000,) * 4, burn=(50,) * 4, start="2026-06-01"))
    assert pd.isna(flat["burn_multiple"].iloc[-1])
    profitable = add_derived(history(revenue=(100, 120, 140, 160), burn=(-10,) * 4, cash=(5000,) * 4, start="2026-06-01"))
    assert pd.isna(profitable["burn_multiple"].iloc[-1])


def test_healthy_company_has_no_flags():
    assert flags_for(history(cash=(5000, 4950, 4900))) == set()


@pytest.mark.parametrize(
    "cash, expected",
    [(250, ("Runway", "critical")), (500, ("Runway", "serious")), (0, ("Runway", "critical"))],
)
def test_runway_flags(cash, expected):
    assert expected in flags_for(history(cash=(5000, 5000, cash)))


def test_profitable_company_has_no_runway_flag():
    assert flags_for(history(burn=(-10, -10, -10), cash=(100, 110, 120))) == set()


def test_two_month_revenue_decline_is_serious():
    assert ("Revenue", "serious") in flags_for(history(revenue=(100, 95, 90), cash=(5000,) * 3))


def test_single_sharp_revenue_drop_is_warning():
    assert ("Revenue", "warning") in flags_for(history(revenue=(100, 110, 95), cash=(5000,) * 3))


def test_small_single_dip_is_not_flagged():
    assert flags_for(history(revenue=(100, 110, 105), cash=(5000,) * 3)) == set()


def test_burn_spike():
    assert ("Burn", "warning") in flags_for(history(burn=(50, 50, 70), cash=(5000,) * 3))


def test_stale_reporting():
    df = history(cash=(5000,) * 3)  # latest report is September
    assert ("Reporting", "warning") not in flags_for(df, today=date(2026, 10, 7))  # Sept is current
    assert ("Reporting", "warning") not in flags_for(df, today=date(2026, 11, 7))  # one missed
    assert ("Reporting", "warning") in flags_for(df, today=date(2026, 12, 7))  # two missed


def test_portfolio_flags_sorted_and_health_status():
    df = pd.concat([
        history("Healthy", cash=(5000,) * 3),
        history("Burning", burn=(50, 50, 70), cash=(5000,) * 3),
        history("Broke", cash=(500, 300, 100)),
    ])
    flags = portfolio_flags(add_derived(df), TODAY)
    assert flags["severity"].iloc[0] == "critical"
    status = health_status(flags, ["Healthy", "Burning", "Broke"])
    assert status.to_dict() == {"Healthy": "good", "Burning": "warning", "Broke": "critical"}


def test_demo_seed_round_trip(tmp_path):
    path = tmp_path / "demo.db"
    seed.build_demo_db(path, today=TODAY)
    updates = db.load_updates(path)
    snapshot = latest_snapshot(add_derived(updates))
    assert len(snapshot) == len(seed.DEMO_COMPANIES)
    flags = portfolio_flags(add_derived(updates), TODAY)
    # The demo is built to show each kind of warning sign.
    assert {"Runway", "Revenue", "Burn", "Efficiency", "Reporting"} <= set(flags["metric"])
    assert "Quanta Ledger" not in set(flags["company"])


def test_upsert_replaces_same_month(tmp_path):
    path = tmp_path / "t.db"
    db.init_db(path)
    cid = db.add_company("Acme", db_path=path)
    db.upsert_update(cid, date(2026, 9, 15), revenue=1, burn=1, cash=1, headcount=1, db_path=path)
    db.upsert_update(cid, date(2026, 9, 1), revenue=2, burn=1, cash=1, headcount=1, db_path=path)
    updates = db.load_updates(path)
    assert len(updates) == 1
    assert updates["revenue"].iloc[0] == 2
    assert updates["month"].iloc[0] == pd.Timestamp("2026-09-01")
