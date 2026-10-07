"""SQLite storage for portfolio companies, their monthly KPI updates, and update requests."""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import pandas as pd

from portfolio.fields import METRIC_FIELDS, validate_fields

DEFAULT_DB_PATH = Path(os.environ.get("PORTFOLIO_DB", Path(__file__).resolve().parent.parent / "data" / "portfolio.db"))

# Metric columns are nullable: an update request may ask for only some of them,
# and later requests for the same month fill in the rest.
SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    sector        TEXT,
    stage         TEXT,
    invested_on   TEXT,
    amount_invested REAL,
    ownership_pct REAL
);

CREATE TABLE IF NOT EXISTS updates (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    month        TEXT NOT NULL,          -- first day of the reporting month, ISO format
    revenue      REAL,                   -- monthly recurring revenue
    burn         REAL,                   -- net monthly cash burn (positive = cash out)
    cash         REAL,                   -- cash in the bank at month end
    headcount    INTEGER,
    customers    INTEGER,
    notes        TEXT,
    submitted_on TEXT NOT NULL,
    UNIQUE (company_id, month)
);

CREATE TABLE IF NOT EXISTS update_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,          -- shown to founders as the form title
    month        TEXT NOT NULL,          -- reporting month being requested
    fields       TEXT NOT NULL,          -- JSON list of metric keys
    company_ids  TEXT NOT NULL,          -- JSON list of company ids asked to respond
    due_on       TEXT,
    created_on   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_responses (
    request_id   INTEGER NOT NULL REFERENCES update_requests(id) ON DELETE CASCADE,
    company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    submitted_on TEXT NOT NULL,
    PRIMARY KEY (request_id, company_id)
);
"""


@contextmanager
def connect(db_path: Path | str = DEFAULT_DB_PATH):
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _migrate(conn: sqlite3.Connection) -> None:
    """Relax NOT NULL on metric columns in databases created before update requests existed."""
    columns = {row[1]: row[3] for row in conn.execute("PRAGMA table_info(updates)")}
    if not columns.get("revenue"):
        return
    conn.execute("ALTER TABLE updates RENAME TO updates_old")
    conn.executescript(SCHEMA)  # recreates `updates` with nullable metric columns
    conn.execute(
        "INSERT INTO updates (id, company_id, month, revenue, burn, cash, headcount, customers, notes, submitted_on)"
        " SELECT id, company_id, month, revenue, burn, cash, headcount, customers, notes, submitted_on FROM updates_old"
    )
    conn.execute("DROP TABLE updates_old")


def init_db(db_path: Path | str = DEFAULT_DB_PATH) -> None:
    with connect(db_path) as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)


def add_company(
    name: str,
    sector: str = "",
    stage: str = "",
    invested_on: date | None = None,
    amount_invested: float | None = None,
    ownership_pct: float | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> int:
    with connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO companies (name, sector, stage, invested_on, amount_invested, ownership_pct)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (name, sector, stage, invested_on.isoformat() if invested_on else None, amount_invested, ownership_pct),
        )
        return cur.lastrowid


def upsert_update(
    company_id: int,
    month: date,
    revenue: float | None = None,
    burn: float | None = None,
    cash: float | None = None,
    headcount: int | None = None,
    customers: int | None = None,
    notes: str | None = None,
    submitted_on: date | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> None:
    """Save a company's figures for a month.

    Values passed as None leave any figure already stored for that month untouched,
    so several partial requests for the same month add up to one complete update.
    """
    month = month.replace(day=1)
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO updates (company_id, month, revenue, burn, cash, headcount, customers, notes, submitted_on)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (company_id, month) DO UPDATE SET
                revenue   = COALESCE(excluded.revenue, revenue),
                burn      = COALESCE(excluded.burn, burn),
                cash      = COALESCE(excluded.cash, cash),
                headcount = COALESCE(excluded.headcount, headcount),
                customers = COALESCE(excluded.customers, customers),
                notes     = COALESCE(excluded.notes, notes),
                submitted_on = excluded.submitted_on
            """,
            (
                company_id, month.isoformat(), revenue, burn, cash, headcount, customers, notes,
                (submitted_on or date.today()).isoformat(),
            ),
        )


def load_companies(db_path: Path | str = DEFAULT_DB_PATH) -> pd.DataFrame:
    with connect(db_path) as conn:
        df = pd.read_sql_query("SELECT * FROM companies ORDER BY name", conn)
    df["invested_on"] = pd.to_datetime(df["invested_on"])
    return df


def load_updates(db_path: Path | str = DEFAULT_DB_PATH) -> pd.DataFrame:
    """All updates joined with the company name, sorted by company then month."""
    with connect(db_path) as conn:
        df = pd.read_sql_query(
            """
            SELECT u.*, c.name AS company
            FROM updates u JOIN companies c ON c.id = u.company_id
            ORDER BY c.name, u.month
            """,
            conn,
        )
    df["month"] = pd.to_datetime(df["month"])
    df["submitted_on"] = pd.to_datetime(df["submitted_on"])
    for key, field in METRIC_FIELDS.items():
        if field.kind != "text":
            df[key] = df[key].astype(float)  # missing figures become NaN rather than None
    return df


# --- Update requests ----------------------------------------------------------


def create_request(
    title: str,
    month: date,
    fields: list[str],
    company_ids: list[int],
    due_on: date | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> int:
    title = title.strip()
    if not title:
        raise ValueError("A request needs a title")
    if not company_ids:
        raise ValueError("Select at least one company")
    fields = validate_fields(fields)
    with connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO update_requests (title, month, fields, company_ids, due_on, created_on)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                title, month.replace(day=1).isoformat(), json.dumps(fields), json.dumps(sorted(set(company_ids))),
                due_on.isoformat() if due_on else None, date.today().isoformat(),
            ),
        )
        return cur.lastrowid


def delete_request(request_id: int, db_path: Path | str = DEFAULT_DB_PATH) -> None:
    """Remove a request and its response log. Figures already submitted are kept."""
    with connect(db_path) as conn:
        conn.execute("DELETE FROM update_requests WHERE id = ?", (request_id,))


def _request_from_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "month": date.fromisoformat(row["month"]),
        "fields": json.loads(row["fields"]),
        "company_ids": json.loads(row["company_ids"]),
        "due_on": date.fromisoformat(row["due_on"]) if row["due_on"] else None,
        "created_on": date.fromisoformat(row["created_on"]),
    }


def load_requests(db_path: Path | str = DEFAULT_DB_PATH) -> list[dict]:
    """All requests, newest first, each with the ids of companies that have responded."""
    with connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        requests = [_request_from_row(r) for r in conn.execute("SELECT * FROM update_requests ORDER BY id DESC")]
        responses = conn.execute("SELECT request_id, company_id, submitted_on FROM request_responses").fetchall()
    for r in requests:
        r["responses"] = {
            c: date.fromisoformat(s) for rid, c, s in responses if rid == r["id"]
        }
    return requests


def get_request(request_id: int, db_path: Path | str = DEFAULT_DB_PATH) -> dict | None:
    return next((r for r in load_requests(db_path) if r["id"] == request_id), None)


def submit_request_response(
    request_id: int,
    company_id: int,
    values: dict,
    submitted_on: date | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> None:
    """Save a company's answers to a request and mark the request as answered for that company."""
    request = get_request(request_id, db_path)
    if request is None:
        raise ValueError(f"Update request {request_id} does not exist")
    if company_id not in request["company_ids"]:
        raise ValueError("This company was not asked for this update")
    missing = [k for k in request["fields"] if k != "notes" and values.get(k) is None]
    if missing:
        raise ValueError(f"Missing values for: {', '.join(METRIC_FIELDS[k].label for k in missing)}")

    submitted_on = submitted_on or date.today()
    figures = {k: values.get(k) for k in request["fields"]}
    upsert_update(company_id, request["month"], **figures, submitted_on=submitted_on, db_path=db_path)
    with connect(db_path) as conn:
        conn.execute(
            "INSERT INTO request_responses (request_id, company_id, submitted_on) VALUES (?, ?, ?)"
            " ON CONFLICT (request_id, company_id) DO UPDATE SET submitted_on = excluded.submitted_on",
            (request_id, company_id, submitted_on.isoformat()),
        )
