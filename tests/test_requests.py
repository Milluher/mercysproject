import sqlite3
from datetime import date

import pandas as pd
import pytest

from portfolio import db, seed
from portfolio.metrics import add_derived, latest_snapshot

SEPT = date(2026, 9, 1)


@pytest.fixture
def path(tmp_path):
    p = tmp_path / "t.db"
    db.init_db(p)
    return p


@pytest.fixture
def acme(path):
    return db.add_company("Acme", db_path=path)


def test_create_request_stores_fields_in_catalogue_order(path, acme):
    rid = db.create_request("  Q3 board pack  ", date(2026, 9, 17), ["cash", "revenue"], [acme], db_path=path)
    r = db.get_request(rid, path)
    assert r["title"] == "Q3 board pack"
    assert r["month"] == SEPT
    assert r["fields"] == ["revenue", "cash"]
    assert r["company_ids"] == [acme]
    assert r["responses"] == {}


@pytest.mark.parametrize(
    "title, fields, companies, message",
    [
        ("", ["revenue"], True, "title"),
        ("Update", [], True, "at least one metric"),
        ("Update", ["revenue", "ebitda"], True, "Unknown metric"),
        ("Update", ["revenue"], False, "at least one company"),
    ],
)
def test_create_request_validation(path, acme, title, fields, companies, message):
    with pytest.raises(ValueError, match=message):
        db.create_request(title, SEPT, fields, [acme] if companies else [], db_path=path)


def test_response_requires_every_requested_metric_except_notes(path, acme):
    rid = db.create_request("Cash check", SEPT, ["cash", "burn", "notes"], [acme], db_path=path)
    with pytest.raises(ValueError, match="Net burn"):
        db.submit_request_response(rid, acme, {"cash": 100}, db_path=path)
    db.submit_request_response(rid, acme, {"cash": 100, "burn": 10, "notes": None}, db_path=path)
    assert acme in db.get_request(rid, path)["responses"]


def test_response_from_company_not_asked_is_rejected(path, acme):
    other = db.add_company("Other", db_path=path)
    rid = db.create_request("Cash check", SEPT, ["cash"], [acme], db_path=path)
    with pytest.raises(ValueError, match="not asked"):
        db.submit_request_response(rid, other, {"cash": 1}, db_path=path)


def test_response_only_saves_requested_metrics(path, acme):
    rid = db.create_request("Revenue only", SEPT, ["revenue"], [acme], db_path=path)
    db.submit_request_response(rid, acme, {"revenue": 500, "cash": 999}, db_path=path)
    row = db.load_updates(path).iloc[0]
    assert row["revenue"] == 500
    assert pd.isna(row["cash"])


def test_partial_requests_for_same_month_merge(path, acme):
    r1 = db.create_request("Revenue", SEPT, ["revenue", "notes"], [acme], db_path=path)
    r2 = db.create_request("Cash", SEPT, ["cash", "burn"], [acme], db_path=path)
    db.submit_request_response(r1, acme, {"revenue": 500, "notes": "Good month"}, db_path=path)
    db.submit_request_response(r2, acme, {"cash": 10_000, "burn": 1_000}, db_path=path)

    updates = db.load_updates(path)
    assert len(updates) == 1
    row = updates.iloc[0]
    assert (row["revenue"], row["cash"], row["burn"], row["notes"]) == (500, 10_000, 1_000, "Good month")
    assert add_derived(updates)["runway_months"].iloc[0] == 10


def test_resubmitting_replaces_figures_and_response_date(path, acme):
    rid = db.create_request("Revenue", SEPT, ["revenue"], [acme], db_path=path)
    db.submit_request_response(rid, acme, {"revenue": 500}, submitted_on=date(2026, 10, 2), db_path=path)
    db.submit_request_response(rid, acme, {"revenue": 550}, submitted_on=date(2026, 10, 4), db_path=path)
    assert db.load_updates(path)["revenue"].iloc[0] == 550
    assert db.get_request(rid, path)["responses"] == {acme: date(2026, 10, 4)}


def test_deleting_request_keeps_submitted_figures(path, acme):
    rid = db.create_request("Revenue", SEPT, ["revenue"], [acme], db_path=path)
    db.submit_request_response(rid, acme, {"revenue": 500}, db_path=path)
    db.delete_request(rid, path)
    assert db.get_request(rid, path) is None
    assert len(db.load_updates(path)) == 1


def test_latest_snapshot_carries_forward_missing_figures(path, acme):
    db.upsert_update(acme, date(2026, 8, 1), revenue=400, burn=1_000, cash=12_000, headcount=5, db_path=path)
    db.upsert_update(acme, SEPT, revenue=500, db_path=path)  # a revenue-only request
    snap = latest_snapshot(add_derived(db.load_updates(path))).loc["Acme"]
    assert snap["month"] == pd.Timestamp(SEPT)
    assert snap["revenue"] == 500
    assert snap["cash"] == 12_000
    assert snap["runway_months"] == 12


def test_migrates_database_with_required_metric_columns(tmp_path):
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sector TEXT,
                stage TEXT, invested_on TEXT, amount_invested REAL, ownership_pct REAL);
            CREATE TABLE updates (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, month TEXT NOT NULL,
                revenue REAL NOT NULL, burn REAL NOT NULL, cash REAL NOT NULL, headcount INTEGER NOT NULL,
                customers INTEGER, notes TEXT, submitted_on TEXT NOT NULL, UNIQUE (company_id, month));
            INSERT INTO companies (name) VALUES ('Acme');
            INSERT INTO updates (company_id, month, revenue, burn, cash, headcount, submitted_on)
                VALUES (1, '2026-08-01', 400, 100, 5000, 4, '2026-09-05');
            """
        )
    db.init_db(path)
    db.upsert_update(1, SEPT, revenue=450, db_path=path)  # would violate NOT NULL before migrating
    updates = db.load_updates(path)
    assert list(updates["revenue"]) == [400, 450]
    assert updates["cash"].iloc[0] == 5000


def test_demo_seed_includes_partly_answered_request(tmp_path):
    path = tmp_path / "demo.db"
    seed.build_demo_db(path, today=date(2026, 10, 7))
    requests = {r["title"]: r for r in db.load_requests(path)}
    request = requests["September 2026 monthly update"]
    assert len(request["company_ids"]) == len(seed.DEMO_COMPANIES)
    assert len(request["responses"]) == len(seed.DEMO_COMPANIES) - 1  # the stale company hasn't answered
    assert all(d <= date(2026, 10, 7) for d in request["responses"].values())
    board_pack = requests["Q3 board pack"]
    assert sum(k.startswith("custom:") for k in board_pack["fields"]) == 3
    assert len(board_pack["responses"]) == 5
