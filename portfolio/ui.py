"""Shared Streamlit helpers: data loading, formatting and chart styling."""

from __future__ import annotations

import math
from datetime import date

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from portfolio import db, metrics, seed

SERIES_COLOR = "#2a78d6"
REFERENCE_COLOR = "#898781"

STATUS_LABELS = {
    "critical": "🔴 Critical",
    "serious": "🟠 Serious",
    "warning": "🟡 Warning",
    "good": "🟢 Healthy",
}


def ensure_db() -> None:
    """Create the database on first run, filled with the demo portfolio."""
    if not db.DEFAULT_DB_PATH.exists():
        seed.build_demo_db()


@st.cache_data(ttl=60)
def load_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Companies and derived per-month updates. Call reload_data() after a write."""
    ensure_db()
    return db.load_companies(), metrics.add_derived(db.load_updates())


def reload_data() -> None:
    load_data.clear()


def money(value: float) -> str:
    if value is None or pd.isna(value):
        return "–"
    sign = "-" if value < 0 else ""
    value = abs(value)
    for threshold, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if value >= threshold:
            return f"{sign}${value / threshold:.1f}".removesuffix(".0") + suffix
    return f"{sign}${value:,.0f}"


def pct(value: float) -> str:
    return "–" if value is None or pd.isna(value) else f"{value:+.1%}"


def runway(value: float) -> str:
    if value is None or pd.isna(value):
        return "–"
    return "Profitable" if math.isinf(value) else f"{value:.1f} mo"


def multiple(value: float) -> str:
    return "–" if value is None or pd.isna(value) else f"{value:.1f}x"


def today() -> date:
    return date.today()


def style_figure(fig: go.Figure, height: int = 280, y_format: str | None = None) -> go.Figure:
    fig.update_layout(
        height=height,
        margin=dict(l=8, r=8, t=8, b=8),
        showlegend=False,
        hovermode="x unified",
    )
    fig.update_xaxes(showgrid=False)
    fig.update_yaxes(tickformat=y_format, rangemode="tozero")
    return fig


def line_chart(df: pd.DataFrame, column: str, label: str, y_format: str | None = "$~s") -> go.Figure:
    """Single-series monthly line chart: one measure per chart, never two y-axes."""
    hover_fmt = ":$,.0f" if y_format and y_format.startswith("$") else ":,.0f"
    fig = go.Figure(
        go.Scatter(
            x=df["month"],
            y=df[column],
            mode="lines+markers",
            line=dict(color=SERIES_COLOR, width=2),
            marker=dict(size=8, color=SERIES_COLOR),
            name=label,
            hovertemplate=f"%{{y{hover_fmt}}}<extra>{label}</extra>",
        )
    )
    return style_figure(fig, y_format=y_format)
