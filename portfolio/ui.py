"""Shared Streamlit helpers: data loading, formatting and chart styling."""

from __future__ import annotations

import math
from datetime import date
from urllib.parse import urlencode, urlsplit

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from portfolio import db, metrics, seed
from portfolio.fields import NUMERIC_KINDS, MetricField

SERIES_COLOR = "#2a78d6"
REFERENCE_COLOR = "#898781"

STATUS_LABELS = {
    "critical": "🔴 Critical",
    "serious": "🟠 Serious",
    "warning": "🟡 Warning",
    "good": "🟢 Healthy",
}


@st.cache_resource
def ensure_db() -> bool:
    """Once per server process: create the demo database on first run, or bring an existing
    database's tables up to date (new tables added by later versions of the app)."""
    if db.DEFAULT_DB_PATH.exists():
        db.init_db()
    else:
        seed.build_demo_db()
    return True


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


def format_value(field: MetricField, value) -> str:
    """Display any metric value according to its type."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return "–"
    if field.kind == "text":
        return str(value)
    if field.kind == "money":
        return money(value)
    if field.kind == "percent":
        return f"{value:.1f}%"
    if field.kind == "integer":
        return f"{value:,.0f}"
    return f"{value:,.2f}".rstrip("0").rstrip(".")


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


def line_chart(
    df: pd.DataFrame,
    column: str,
    label: str,
    y_format: str | None = "$~s",
    hover_format: str | None = None,
    suffix: str = "",
) -> go.Figure:
    """Single-series monthly line chart: one measure per chart, never two y-axes."""
    if hover_format is None:
        hover_format = "$,.0f" if y_format and y_format.startswith("$") else ",.0f"
    fig = go.Figure(
        go.Scatter(
            x=df["month"],
            y=df[column],
            mode="lines+markers",
            line=dict(color=SERIES_COLOR, width=2),
            marker=dict(size=8, color=SERIES_COLOR),
            name=label,
            hovertemplate=f"%{{y:{hover_format}}}{suffix}<extra>{label}</extra>",
        )
    )
    style_figure(fig, y_format=y_format)
    fig.update_yaxes(ticksuffix=suffix)
    # Month labels; with only a few months, one tick per month so Plotly doesn't invent in-between dates.
    fig.update_xaxes(tickformat="%b %Y", dtick="M1" if len(df) <= 6 else None)
    return fig


# Chart settings per metric type: (axis tick format, hover format, unit suffix).
CHART_FORMATS = {
    "money": ("$~s", "$,.0f", ""),
    "integer": (",d", ",.0f", ""),
    "number": ("~s", ",.2~f", ""),
    "percent": (None, ".1f", "%"),
}


def metric_chart(df: pd.DataFrame, field: MetricField, column: str = "value") -> go.Figure:
    y_format, hover_format, suffix = CHART_FORMATS[field.kind]
    return line_chart(df, column, field.label, y_format=y_format, hover_format=hover_format, suffix=suffix)


def last_month() -> date:
    return (today().replace(day=1) - date.resolution).replace(day=1)


# Number input settings per metric type: (step, display format). Integers use int steps.
INPUT_FORMATS = {
    "money": (1_000.0, "%.0f"),
    "integer": (1, "%d"),
    "number": (1.0, "%.2f"),
    "percent": (0.5, "%.1f"),
}


def metric_inputs(fields: list[MetricField], key_prefix: str = "", optional: bool = False) -> dict:
    """Render one input per metric inside a form, keyed by metric key. Blank inputs come back as None.

    Numeric metrics go in two columns; text metrics follow as full-width text areas.
    """
    values = {}
    numeric = [f for f in fields if f.kind in NUMERIC_KINDS]
    cols = st.columns(2)
    for i, field in enumerate(numeric):
        step, fmt = INPUT_FORMATS[field.kind]
        values[field.key] = cols[i % 2].number_input(
            field.label,
            value=None,
            min_value=None if field.allow_negative else type(step)(0),
            step=step,
            format=fmt,
            help=field.help or None,
            placeholder="Optional" if optional or not field.required else "Required",
            key=f"{key_prefix}{field.key}",
        )
    for field in (f for f in fields if f.kind == "text"):
        text = st.text_area(
            field.label,
            help=field.help or None,
            placeholder=(
                "Key wins, risks, and where the fund can help" if field.key == "notes"
                else "Optional" if optional or not field.required else "Required"
            ),
            key=f"{key_prefix}{field.key}",
        )
        values[field.key] = text.strip() or None
    return values


def app_link(path: str = "", **params) -> str:
    """Absolute link into this app, based on the URL it is being viewed at."""
    try:
        parts = urlsplit(st.context.url)
        base = f"{parts.scheme}://{parts.netloc}"
    except Exception:  # not running in a browser session (e.g. tests)
        base = ""
    query = f"?{urlencode(params)}" if params else ""
    return f"{base}/{path}{query}"


def form_link(request_id: int) -> str:
    """Link to a request's form. Each founder signs in and sees it for their own company."""
    return app_link("submit", request=request_id)


def invite_link(token: str) -> str:
    return app_link(invite=token)


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
