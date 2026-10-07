"""Shared Streamlit helpers: data loading, formatting and chart styling."""

from __future__ import annotations

import math
from datetime import date
from urllib.parse import urlencode, urlsplit

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from portfolio import db, metrics, seed
from portfolio.fields import METRIC_FIELDS

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


def md(text: str) -> str:
    """Escape text for Streamlit markdown, where a pair of $ signs would otherwise render as maths."""
    return text.replace("$", "\\$")


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


def last_month() -> date:
    return (today().replace(day=1) - date.resolution).replace(day=1)


def metric_inputs(field_keys: list[str], key_prefix: str = "") -> dict:
    """Render one input per requested metric inside a form. Blank inputs come back as None."""
    values = {}
    numeric = [k for k in field_keys if METRIC_FIELDS[k].kind != "text"]
    cols = st.columns(2)
    for i, key in enumerate(numeric):
        field = METRIC_FIELDS[key]
        is_money = field.kind == "money"
        values[key] = cols[i % 2].number_input(
            field.label,
            value=None,
            min_value=None if field.allow_negative else 0.0 if is_money else 0,
            step=1_000.0 if is_money else 1,
            format="%.0f" if is_money else "%d",
            help=field.help or None,
            placeholder="Required",
            key=f"{key_prefix}{key}",
        )
    if "notes" in field_keys:
        notes = st.text_area(
            METRIC_FIELDS["notes"].label,
            placeholder="Key wins, risks, and where the fund can help",
            key=f"{key_prefix}notes",
        )
        values["notes"] = notes.strip() or None
    return values


def form_link(request_id: int, company_id: int | None = None) -> str:
    """Absolute link to the founder form for a request, based on the URL this app is being viewed at."""
    params = {"request": request_id}
    if company_id is not None:
        params["company"] = company_id
    try:
        parts = urlsplit(st.context.url)
        base = f"{parts.scheme}://{parts.netloc}"
    except Exception:  # not running in a browser session (e.g. tests)
        base = ""
    return f"{base}/submit?{urlencode(params)}"


def show_new_flags(company: str) -> None:
    """After a save, tell the person submitting what warning signs their numbers raise."""
    _, derived = load_data()
    history = derived[derived["company"] == company]
    if history.empty:
        return
    flags = metrics.company_flags(history, today())
    if flags:
        st.markdown("**These figures raise the following warning signs:**")
        for f in flags:
            st.warning(f"{STATUS_LABELS[f.severity]} — {f.metric}: {f.message}")
