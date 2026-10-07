"""KPI calculations and warning-sign detection for portfolio companies.

Everything here is pure pandas so it can be unit tested without a database or UI.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

import pandas as pd

# Severity levels, ordered from least to most urgent.
SEVERITIES = ["good", "warning", "serious", "critical"]


@dataclass(frozen=True)
class Thresholds:
    runway_critical_months: float = 6.0     # below this: needs cash now
    runway_serious_months: float = 12.0     # below this: should be raising
    revenue_drop_pct: float = -0.10         # single-month MRR drop that triggers a warning
    burn_spike_pct: float = 0.30            # MoM burn increase that triggers a warning
    burn_multiple_high: float = 3.0         # cash burned per $1 of net new ARR
    stale_after_months: int = 2             # monthly reports missed before we chase


DEFAULT_THRESHOLDS = Thresholds()


@dataclass(frozen=True)
class Flag:
    company: str
    severity: str
    metric: str
    message: str


def runway_months(cash: float, burn: float) -> float:
    """Months of cash left at the current burn. Infinite when the company is cash-flow positive.

    NaN when either figure wasn't reported for the month.
    """
    if pd.isna(cash) or pd.isna(burn):
        return math.nan
    if burn <= 0:
        return math.inf
    return max(cash, 0) / burn


def add_derived(updates: pd.DataFrame) -> pd.DataFrame:
    """Add runway, month-over-month growth and burn multiple columns to a per-month updates table."""
    df = updates.sort_values(["company", "month"]).copy()
    g = df.groupby("company", sort=False)

    df["runway_months"] = [runway_months(c, b) for c, b in zip(df["cash"], df["burn"])]
    df["revenue_growth"] = g["revenue"].pct_change(fill_method=None)
    df["burn_change"] = g["burn"].pct_change(fill_method=None)
    df["arr"] = df["revenue"] * 12

    # Burn multiple over a trailing 3-month window: net burn / net new ARR.
    # Undefined (NaN) when ARR did not grow or the company is cash-flow positive.
    burn_3m = g["burn"].transform(lambda s: s.rolling(3, min_periods=3).sum())
    new_arr_3m = g["arr"].transform(lambda s: s - s.shift(3))
    df["burn_multiple"] = (burn_3m / new_arr_3m).where((new_arr_3m > 0) & (burn_3m > 0))
    return df


# Figures that stay meaningful when carried forward from an earlier month. Month-over-month
# changes (growth, burn change) are not carried: they describe one specific month.
CARRY_FORWARD = ["revenue", "arr", "burn", "cash", "headcount", "customers", "runway_months", "burn_multiple"]


def with_last_known(history: pd.DataFrame) -> pd.DataFrame:
    """Fill gaps left by partial update requests with the company's most recent known figure."""
    history = history.sort_values("month").copy()
    cols = [c for c in CARRY_FORWARD if c in history.columns]
    history[cols] = history[cols].ffill()
    return history


def latest_snapshot(derived: pd.DataFrame) -> pd.DataFrame:
    """One row per company: its most recent month, with any figure missing that month taken from the last month that had it."""
    rows = [with_last_known(hist).iloc[-1] for _, hist in derived.groupby("company")]
    return pd.DataFrame(rows).set_index("company").sort_index()


def _months_between(earlier: pd.Timestamp, later: date) -> int:
    return (later.year - earlier.year) * 12 + (later.month - earlier.month)


def company_flags(history: pd.DataFrame, today: date, t: Thresholds = DEFAULT_THRESHOLDS) -> list[Flag]:
    """Warning signs for one company, given its derived month-by-month history."""
    history = with_last_known(history)
    latest = history.iloc[-1]
    name = latest["company"]
    flags: list[Flag] = []

    runway = latest["runway_months"]
    if latest["cash"] <= 0 and latest["burn"] > 0:
        flags.append(Flag(name, "critical", "Runway", "Out of cash"))
    elif runway < t.runway_critical_months:
        flags.append(Flag(name, "critical", "Runway", f"Only {runway:.1f} months of cash left"))
    elif runway < t.runway_serious_months:
        flags.append(Flag(name, "serious", "Runway", f"{runway:.1f} months of runway: should be fundraising"))

    growth = history["revenue_growth"].dropna()
    if len(growth) >= 2 and (growth.iloc[-2:] < 0).all():
        flags.append(Flag(name, "serious", "Revenue", "Revenue fell two months in a row"))
    elif len(growth) >= 1 and growth.iloc[-1] <= t.revenue_drop_pct:
        flags.append(Flag(name, "warning", "Revenue", f"Revenue down {abs(growth.iloc[-1]):.0%} last month"))

    burn_change = latest["burn_change"]
    if pd.notna(burn_change) and burn_change >= t.burn_spike_pct and latest["burn"] > 0:
        flags.append(Flag(name, "warning", "Burn", f"Burn up {burn_change:.0%} month over month"))

    burn_multiple = latest["burn_multiple"]
    if pd.notna(burn_multiple) and burn_multiple > t.burn_multiple_high:
        flags.append(Flag(name, "warning", "Efficiency", f"Burn multiple of {burn_multiple:.1f}x"))

    # Last month's report is the newest one we can expect, so anything older counts as missed.
    missed = _months_between(latest["month"], today) - 1
    if missed >= t.stale_after_months:
        flags.append(
            Flag(name, "warning", "Reporting", f"No update since {latest['month']:%b %Y} ({missed} reports missed)")
        )

    return flags


def portfolio_flags(derived: pd.DataFrame, today: date, t: Thresholds = DEFAULT_THRESHOLDS) -> pd.DataFrame:
    """All flags across the portfolio, most urgent first."""
    flags = [f for _, hist in derived.groupby("company") for f in company_flags(hist, today, t)]
    df = pd.DataFrame(flags, columns=["company", "severity", "metric", "message"])
    df["rank"] = df["severity"].map(SEVERITIES.index)
    return df.sort_values(["rank", "company"], ascending=[False, True]).drop(columns="rank").reset_index(drop=True)


def health_status(flags: pd.DataFrame, companies: list[str]) -> pd.Series:
    """Worst flag severity per company; 'good' when a company has no flags."""
    worst = {c: "good" for c in companies}
    for company, severity in zip(flags["company"], flags["severity"]):
        if SEVERITIES.index(severity) > SEVERITIES.index(worst.get(company, "good")):
            worst[company] = severity
    return pd.Series(worst, name="status")
