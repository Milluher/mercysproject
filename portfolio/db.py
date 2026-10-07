"""SQLite storage for portfolio companies and their monthly KPI updates."""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import pandas as pd

DEFAULT_DB_PATH = Path(os.environ.get("PORTFOLIO_DB", Path(__file__).resolve().parent.parent / "data" / "portfolio.db"))

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
    revenue      REAL NOT NULL,          -- monthly recurring revenue
    burn         REAL NOT NULL,          -- net monthly cash burn (positive = cash out)
    cash         REAL NOT NULL,          -- cash in the bank at month end
    headcount    INTEGER NOT NULL,
    customers    INTEGER,
    notes        TEXT,
    submitted_on TEXT NOT NULL,
    UNIQUE (company_id, month)
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


def init_db(db_path: Path | str = DEFAULT_DB_PATH) -> None:
    with connect(db_path) as conn:
        conn.executescript(SCHEMA)


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
    revenue: float,
    burn: float,
    cash: float,
    headcount: int,
    customers: int | None = None,
    notes: str = "",
    submitted_on: date | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> None:
    """Insert a monthly update, replacing any existing update for the same company and month."""
    month = month.replace(day=1)
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO updates (company_id, month, revenue, burn, cash, headcount, customers, notes, submitted_on)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (company_id, month) DO UPDATE SET
                revenue = excluded.revenue, burn = excluded.burn, cash = excluded.cash,
                headcount = excluded.headcount, customers = excluded.customers,
                notes = excluded.notes, submitted_on = excluded.submitted_on
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
    return df
